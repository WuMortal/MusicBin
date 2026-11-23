//! 插件源支持层：通用网络代理与插件音源下载。
//!
//! MusicFree 协议插件运行在前端 iframe 沙箱，沙箱内 fetch 受 webview CORS 限制
//! （useHttpsScheme 下页面源为 https://tauri.localhost），因此插件的全部网络请求
//! 经 postMessage 转发到宿主，再由这里的命令用 reqwest 执行。
//!
//! - `fetch_text`：拉取插件市场 plugins.json 与插件 JS 全文（安装时全文入库，离线可用）。
//! - `plugin_fetch`：插件网络代理，支持自定义 method/headers/body，headers 用于防盗链。
//! - `plugin_download_track`：插件音源下载，复用 music.rs 的流式下载与 ID3/.lrc 收尾。

use serde::Serialize;
use std::collections::HashMap;
use tauri::AppHandle;

use crate::music::{client, download_stream, finish_download, DownloadResult};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub status: u16,
    /// 小写键名的响应头
    pub headers: HashMap<String, String>,
    /// binary=false 为文本（非法 UTF-8 有损转换）；binary=true 为 base64
    pub body: String,
}

/// 仅允许 http/https，防 file://、ftp:// 等绕过
fn check_scheme(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| format!("无效的 URL: {}", url))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        s => Err(format!("仅支持 http/https 请求: {}", s)),
    }
}

/// 拉取远端文本（插件市场列表 / 插件 JS 源码）
#[tauri::command]
pub async fn fetch_text(url: String) -> Result<String, String> {
    check_scheme(&url)?;
    let resp = client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

/// 插件网络代理：沙箱内 fetch/axios 的实际执行通道。
/// headers 整体覆盖默认 UA 之外的额外头（Referer/Cookie/Content-Type 等）。
#[tauri::command]
pub async fn plugin_fetch(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    binary: Option<bool>,
) -> Result<FetchResult, String> {
    check_scheme(&url)?;
    let method = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("无效的请求方法: {}", method))?;

    let cli = client()?;
    let mut req = cli.request(m, &url);
    if let Some(hs) = &headers {
        for (k, v) in hs {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status().as_u16();
    let mut out_headers: HashMap<String, String> = HashMap::new();
    for (k, v) in resp.headers() {
        // 多值头（Set-Cookie 等）后者覆盖前者，音乐源场景够用
        out_headers.insert(k.as_str().to_string(), v.to_str().unwrap_or("").to_string());
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    let body_out = if binary.unwrap_or(false) {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };
    Ok(FetchResult {
        status,
        headers: out_headers,
        body: body_out,
    })
}

/// 插件音源下载：无域名白名单（URL 由已安装插件的 getMediaSource 产生），
/// 下载完成做与内置源一致的收尾：封面 → ID3v2.3 → UTF-8 BOM .lrc。
#[tauri::command]
pub async fn plugin_download_track(
    app: AppHandle,
    url: String,
    file_name: String,
    dir: String,
    title: String,
    author: String,
    cover_url: String,
    lrc: String,
    headers: Option<HashMap<String, String>>,
) -> Result<DownloadResult, String> {
    check_scheme(&url)?;
    let cli = client()?;
    let saved = download_stream(&app, &cli, &url, &file_name, &dir, headers.as_ref()).await?;
    finish_download(
        &app,
        &cli,
        &saved.path,
        &file_name,
        &title,
        &author,
        &cover_url,
        &lrc,
        headers.as_ref(),
    )
    .await?;
    Ok(saved)
}
