//! 音藏的网络与下载命令层。
//!
//! 设计要点（参考 linglong-vault 的 lcsc.rs）：
//! - 所有联网逻辑放在 Rust 侧，前端只做 invoke；这样不受 webview 跨域限制。
//! - 请求带完整浏览器头；下载音频时**不能带 Referer**，否则酷我 CDN 返回 403。
//! - 下载域名做白名单，文件名做清洗，避免路径穿越。

use futures_util::StreamExt;
use id3::frame::{Lyrics, Picture, PictureType};
use id3::{Tag, TagLike, Version};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

const BASE: &str = "https://www.gequbao.com";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    pub author: String,
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayResult {
    pub url: String,
    #[serde(default)]
    pub is_white_url: bool,
    #[serde(default)]
    pub ut: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub path: String,
    pub size: u64,
}

pub(crate) fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn clean_text(s: &str) -> String {
    decode_entities(s).trim().to_string()
}

/// 搜索页：服务端渲染，正则提取每条结果的 /music/ID 与 title="歌曲 - 歌手"
#[tauri::command]
pub async fn search_music(keyword: String) -> Result<Vec<Track>, String> {
    let kw = keyword.trim();
    if kw.is_empty() {
        return Ok(Vec::new());
    }
    let encoded = utf8_percent_encode(kw, NON_ALPHANUMERIC).to_string();
    let url = format!("{}/s/{}", BASE, encoded);
    let cli = client()?;
    let html = cli
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("搜索请求失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取搜索结果失败: {}", e))?;

    let re = Regex::new(r#"(?s)<a href="/music/(\d+)" class="hover-zoom[^"]*"\s+title="([^"]*)""#)
        .map_err(|e| e.to_string())?;
    let mut out: Vec<Track> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for cap in re.captures_iter(&html) {
        let id = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        let raw = clean_text(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        let (title, author) = match raw.split_once(" - ") {
            Some((t, a)) => (t.trim().to_string(), a.trim().to_string()),
            None => (raw.clone(), String::new()),
        };
        out.push(Track {
            id,
            title,
            author,
            source: "gequbao".into(),
        });
    }
    Ok(out)
}

/// 猜你想找：搜索页的辅助接口
#[tauri::command]
pub async fn guess_musics(keyword: String) -> Result<Vec<Track>, String> {
    let kw = keyword.trim();
    if kw.is_empty() {
        return Ok(Vec::new());
    }
    let cli = client()?;
    let resp = cli
        .post(format!("{}/api/guess-musics", BASE))
        .form(&[("keyword", kw)])
        .send()
        .await
        .map_err(|e| format!("猜你想找请求失败: {}", e))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析猜你想找失败: {}", e))?;
    let mut out = Vec::new();
    if json.get("code").and_then(|v| v.as_i64()) != Some(1) {
        return Ok(out);
    }
    if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
        for item in arr {
            let id = item
                .get("business_key")
                .and_then(|v| v.as_str())
                .or_else(|| item.get("id").and_then(|v| v.as_str()))
                .map(|s| s.to_string())
                .unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            out.push(Track {
                id,
                title: clean_text(item.get("title").and_then(|v| v.as_str()).unwrap_or("")),
                author: clean_text(item.get("author").and_then(|v| v.as_str()).unwrap_or("")),
                source: "guess".into(),
            });
        }
    }
    Ok(out)
}

/// 从播放页 HTML 中提取 appData.play_id
fn extract_play_id(html: &str) -> Result<String, String> {
    // 页面注入形式： play_id\u0022:\u0022BASE64\u0022
    let re = Regex::new(r#"play_id\\u0022:\\u0022([A-Za-z0-9+/=]+)"#).map_err(|e| e.to_string())?;
    if let Some(cap) = re.captures(html) {
        return Ok(cap.get(1).unwrap().as_str().to_string());
    }
    // 回退：解出整个 JSON.parse('...') 再解析
    let wrapper =
        Regex::new(r"window\.appData = JSON\.parse\('(.*?)'\);").map_err(|e| e.to_string())?;
    let raw = wrapper
        .captures(html)
        .and_then(|c| c.get(1).map(|m| m.as_str()))
        .ok_or_else(|| "播放页结构已变化，未找到 play_id".to_string())?;
    let unescaped = raw
        .replace("\\u0022", "\"")
        .replace("\\/", "/")
        .replace("\\\\u", "\\u");
    let val: serde_json::Value =
        serde_json::from_str(&unescaped).map_err(|e| format!("解析播放页 appData 失败: {}", e))?;
    val.get("play_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "播放页数据中没有 play_id".to_string())
}

/// 若上游返回 kuwo 的 antiserver 地址，用 convert_url3 换取真实直链
async fn convert_kw_url(cli: &reqwest::Client, raw: &str) -> Result<String, String> {
    if !raw.contains("antiserver.kuwo.cn") {
        return Ok(raw.to_string());
    }
    let parsed = url::Url::parse(raw).map_err(|e| format!("无效的音源地址: {}", e))?;

    // 必须替换已有的 type=convert_url，不能 append：
    // 服务端按第一个 type 取值，追加会让请求仍走 302 而不是返回 JSON。
    // 不带 callback 时接口直接返回纯 JSON；带 callback 时是 JSONP，下面的正则两者都兼容。
    let pairs: Vec<(String, String)> = parsed
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let mut converted = parsed;
    converted.set_query(None);
    let mut has_type = false;
    {
        let mut qp = converted.query_pairs_mut();
        for (k, v) in pairs {
            if k == "type" {
                qp.append_pair("type", "convert_url3");
                has_type = true;
            } else {
                qp.append_pair(&k, &v);
            }
        }
        if !has_type {
            qp.append_pair("type", "convert_url3");
        }
    }

    let body = cli
        .get(converted)
        .send()
        .await
        .map_err(|e| format!("音源转换失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取音源转换结果失败: {}", e))?;
    let re = Regex::new(r#""url"\s*:\s*"([^"]+)""#).map_err(|e| e.to_string())?;
    let found = re
        .captures(&body)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().replace("\\/", "/"))
        .ok_or_else(|| {
            format!(
                "音源转换未返回直链: {}",
                body.chars().take(120).collect::<String>()
            )
        })?;
    Ok(found)
}

/// 用 play_id 换取播放直链。
/// get_play_url 与 download_track_with_meta 共用：后者已经抓过播放页 HTML，
/// 复用 play_id 就不必二次打开播放页、不会多消耗一次每日解析配额。
async fn play_url_for(cli: &reqwest::Client, play_id: &str) -> Result<PlayResult, String> {
    let resp = cli
        .post(format!("{}/member/common-play-url", BASE))
        .header("X-Requested-With", "XMLHttpRequest")
        .form(&[("id", play_id), ("purpose", "play")])
        .send()
        .await
        .map_err(|e| format!("获取播放链接失败: {}", e))?;
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析播放接口响应失败: {}", e))?;

    let code = json.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
    if code != 1 {
        let reason = json
            .get("data")
            .and_then(|d| d.get("reason"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let msg = json
            .get("msg")
            .and_then(|v| v.as_str())
            .unwrap_or("获取播放链接失败");
        return Err(match reason {
            "parse_quota_exhausted" => "今日免费次数已用完，请稍后重试".into(),
            "parse_busy" => "解析繁忙，请稍后重试".into(),
            "api_no_result" => "上游暂无音源".into(),
            _ if code == 2 || code == 3 => "触发了站点验证，请在网页端完成后重试".into(),
            _ => msg.to_string(),
        });
    }
    let raw_url = json
        .get("data")
        .and_then(|d| d.get("url"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "播放接口未返回音频地址".to_string())?;
    Ok(PlayResult {
        url: convert_kw_url(&cli, raw_url).await?,
        is_white_url: json
            .get("data")
            .and_then(|d| d.get("is_white_url"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        ut: json
            .get("data")
            .and_then(|d| d.get("ut"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

/// 取播放直链：GET 播放页拿 play_id → POST common-play-url
#[tauri::command]
pub async fn get_play_url(id: String) -> Result<PlayResult, String> {
    let cli = client()?;
    let page = format!("{}/music/{}", BASE, id);
    let html = cli
        .get(&page)
        .send()
        .await
        .map_err(|e| format!("打开播放页失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取播放页失败: {}", e))?;
    let play_id = extract_play_id(&html)?;
    play_url_for(&cli, &play_id).await
}

fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let base = cleaned.trim().trim_matches('.');
    if base.is_empty() {
        "未命名歌曲".to_string()
    } else {
        base.to_string()
    }
}

#[tauri::command]
pub async fn default_download_dir(app: AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("获取下载目录失败: {}", e))?;
    Ok(dir.join("音藏").to_string_lossy().to_string())
}

/// 流式下载音频到指定目录，边下边发进度事件。
/// 内置源与插件源共用；headers 为 None 时请求不带 Referer 等额外头（酷我 CDN 带 Referer 直接 403）。
pub(crate) async fn download_stream(
    app: &AppHandle,
    cli: &reqwest::Client,
    url: &str,
    file_base: &str,
    dir: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
) -> Result<DownloadResult, String> {
    if dir.trim().is_empty() {
        return Err("请先设置下载目录".into());
    }
    let target_dir = std::path::PathBuf::from(dir);
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("创建下载目录失败: {}", e))?;
    let file = format!("{}.mp3", safe_file_name(file_base));
    let full = target_dir.join(&file);

    let mut req = cli.get(url);
    if let Some(hs) = headers {
        for (k, v) in hs {
            req = req.header(k.as_str(), v.as_str());
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败，HTTP {}", resp.status().as_u16()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut out = tokio::fs::File::create(&full)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;
    let mut downloaded: u64 = 0;
    let mut last_emit = 0u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
        out.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += chunk.len() as u64;
        if downloaded.saturating_sub(last_emit) >= 256 * 1024 || total == 0 {
            last_emit = downloaded;
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "file": file,
                    "downloaded": downloaded,
                    "total": total,
                }),
            );
        }
    }
    out.flush()
        .await
        .map_err(|e| format!("刷新文件失败: {}", e))?;
    let _ = app.emit(
        "download-progress",
        serde_json::json!({ "file": file, "downloaded": downloaded, "total": total, "done": true }),
    );

    Ok(DownloadResult {
        path: full.to_string_lossy().to_string(),
        size: downloaded,
    })
}

/// 下载音频到用户指定目录（内置源入口，域名白名单在此层）
#[tauri::command]
pub async fn download_track(
    app: AppHandle,
    url: String,
    file_name: String,
    dir: String,
) -> Result<DownloadResult, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "无效的音频地址".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    if !host.ends_with("kuwo.cn") {
        return Err(format!("非支持的音源域名: {}", host));
    }
    let cli = client()?;
    download_stream(&app, &cli, &url, &file_name, &dir, None).await
}

// ---------------------------------------------------------------------------
// 歌词 / 封面 → ID3 标签
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMeta {
    pub title: String,
    pub author: String,
    pub cover: String,
    pub lrc: String,
}

/// 还原播放页注入的 appData（与 extract_play_id 的回退逻辑同源，独立实现以免影响既有命令）
fn parse_app_data(html: &str) -> Result<serde_json::Value, String> {
    let wrapper =
        Regex::new(r"window\.appData = JSON\.parse\('(.*?)'\);").map_err(|e| e.to_string())?;
    let raw = wrapper
        .captures(html)
        .and_then(|c| c.get(1).map(|m| m.as_str()))
        .ok_or_else(|| "播放页未找到 appData".to_string())?;
    let mut unescaped = raw.replace("\\u0022", "\"");
    // 页面里的 URL 是双重转义（https:\\\/\\\/img1...），需要替换到没有 `\/` 为止
    while unescaped.contains("\\/") {
        unescaped = unescaped.replace("\\/", "/");
    }
    let unescaped = unescaped.replace("\\\\u", "\\u");
    serde_json::from_str(&unescaped).map_err(|e| format!("解析 appData 失败: {}", e))
}

/// 页面歌词是 `<div id="content-lrc">[00:00]...<br />[00:03]...</div>`
fn parse_lrc(html: &str) -> String {
    let re = Regex::new(r#"(?s)<div class="content-lrc[^"]*" id="content-lrc">(.*?)</div>"#)
        .map_err(|e| e.to_string());
    let re = match re {
        Ok(v) => v,
        Err(_) => return String::new(),
    };
    let raw = match re.captures(html).and_then(|c| c.get(1)) {
        Some(m) => m.as_str(),
        None => return String::new(),
    };
    raw.split("<br")
        .map(|seg| {
            let text = seg.split('>').nth(1).unwrap_or(seg);
            decode_entities(text.trim())
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// 播放页返回的封面是 http 地址；Tauri 窗口以 https 为源，
/// 直接加载会触发混合内容拦截（表现为封面空白），统一升级为 https。
fn upgrade_https(url: &str) -> String {
    match url.strip_prefix("http://") {
        Some(rest) => format!("https://{}", rest),
        None => url.to_string(),
    }
}

#[tauri::command]
pub async fn get_track_meta(id: String) -> Result<TrackMeta, String> {
    let html = client()?
        .get(format!("{}/music/{}", BASE, id))
        .send()
        .await
        .map_err(|e| format!("打开播放页失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取播放页失败: {}", e))?;
    let app = parse_app_data(&html)?;
    Ok(TrackMeta {
        title: clean_text(app.get("mp3_title").and_then(|v| v.as_str()).unwrap_or("")),
        author: clean_text(app.get("mp3_author").and_then(|v| v.as_str()).unwrap_or("")),
        cover: upgrade_https(app.get("mp3_cover").and_then(|v| v.as_str()).unwrap_or("")),
        lrc: parse_lrc(&html),
    })
}

/// 写入 ID3v2.3：封面放 APIC，LRC 放 USLT。
/// 必须用 v2.3 而不是 v2.4：Windows 资源管理器 / 系统媒体库只解析 ID3v2.3，
/// v2.4 写入的封面和歌词在 Explorer 与多数播放器里不可见（表现为"没效果"）。
fn embed_id3(
    path: &std::path::Path,
    title: &str,
    author: &str,
    cover: Option<(String, Vec<u8>)>,
    lrc: &str,
) -> Result<(), String> {
    let mut tag = Tag::read_from_path(path).unwrap_or_else(|_| Tag::new());
    tag.set_title(title);
    tag.set_artist(author);

    tag.remove("APIC");
    if let Some((mime_type, data)) = cover {
        tag.add_frame(Picture {
            mime_type: normalize_image_mime(&data, &mime_type),
            picture_type: PictureType::CoverFront,
            description: String::new(),
            data,
        });
    }

    tag.remove("USLT");
    if !lrc.trim().is_empty() {
        tag.add_frame(Lyrics {
            lang: "zho".to_string(),
            description: String::new(),
            text: lrc.to_string(),
        });
    }

    tag.write_to_path(path, Version::Id3v23)
        .map_err(|e| format!("写入 ID3 标签失败: {}", e))
}

/// 规范封面 MIME：按图片魔数判定。服务器返回的 image/jpg 等非标准值
/// Windows 资源管理器不认，会导致封面不显示。
fn normalize_image_mime(data: &[u8], declared: &str) -> String {
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg".to_string()
    } else if data.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png".to_string()
    } else if data.starts_with(b"GIF8") {
        "image/gif".to_string()
    } else if declared == "image/png" || declared == "image/gif" || declared == "image/bmp" {
        declared.to_string()
    } else {
        "image/jpeg".to_string()
    }
}

/// 一步完成：抓元数据 → 取直链 → 下载 MP3 → 嵌入封面与歌词
#[tauri::command]
pub async fn download_track_with_meta(
    app: AppHandle,
    id: String,
    dir: String,
) -> Result<DownloadResult, String> {
    let cli = client()?;
    let html = cli
        .get(format!("{}/music/{}", BASE, id))
        .send()
        .await
        .map_err(|e| format!("打开播放页失败: {}", e))?
        .text()
        .await
        .map_err(|e| format!("读取播放页失败: {}", e))?;
    let meta_data = parse_app_data(&html)?;
    let title = clean_text(
        meta_data
            .get("mp3_title")
            .and_then(|v| v.as_str())
            .unwrap_or(""),
    );
    let author = clean_text(
        meta_data
            .get("mp3_author")
            .and_then(|v| v.as_str())
            .unwrap_or(""),
    );
    let cover_url = upgrade_https(
        meta_data
            .get("mp3_cover")
            .and_then(|v| v.as_str())
            .unwrap_or(""),
    );
    let lrc = parse_lrc(&html);

    let file_base = format!("{} - {}", title, author).trim().to_string();
    // 复用已抓取的播放页 HTML 提取 play_id，避免二次打开播放页多消耗一次解析配额
    let play = play_url_for(&cli, &extract_play_id(&html)?).await?;
    let saved = download_stream(&app, &cli, &play.url, &file_base, &dir, None).await?;
    finish_download(
        &app,
        &cli,
        &saved.path,
        &file_base,
        &title,
        &author,
        &cover_url,
        &lrc,
        None,
    )
    .await?;

    Ok(saved)
}

/// 下载封面 → 嵌入 ID3v2.3 → 写同名 .lrc（UTF-8 BOM）。
/// 内置源与插件源共用；插件源通过 headers 传防盗链头（Referer/Cookie）。
pub(crate) async fn finish_download(
    app: &AppHandle,
    cli: &reqwest::Client,
    path: &str,
    file_base: &str,
    title: &str,
    author: &str,
    cover_url: &str,
    lrc: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    let cover = if cover_url.is_empty() {
        None
    } else {
        let mut req = cli.get(cover_url);
        if let Some(hs) = headers {
            for (k, v) in hs {
                req = req.header(k.as_str(), v.as_str());
            }
        }
        match req.send().await {
            Ok(resp) => {
                let mime = resp
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("image/jpeg")
                    .split(';')
                    .next()
                    .unwrap_or("image/jpeg")
                    .to_string();
                match resp.bytes().await {
                    Ok(b) => Some((mime, b.to_vec())),
                    Err(_) => None,
                }
            }
            Err(_) => None,
        }
    };

    let mp3_path = std::path::PathBuf::from(path);
    let _ = app.emit(
        "download-progress",
        serde_json::json!({ "file": file_base, "downloaded": 0, "total": 0, "embeding": true }),
    );
    embed_id3(&mp3_path, title, author, cover, lrc)?;

    // USLT 内嵌歌词在 Windows 上几乎不可见（Explorer / WMP / 多数国产播放器都不读），
    // 同名 .lrc 是同步歌词的通用载体，洛雪 / foobar2000 / 手机播放器均支持。
    if !lrc.trim().is_empty() {
        let lrc_path = mp3_path.with_extension("lrc");
        let mut content: Vec<u8> = Vec::with_capacity(lrc.len() + 3);
        content.extend_from_slice("\u{FEFF}".as_bytes()); // UTF-8 BOM，防止被当作 ANSI 乱码
        content.extend_from_slice(lrc.as_bytes());
        std::fs::write(&lrc_path, &content)
            .map_err(|e| format!("写入歌词文件失败: {}", e))?;
    }
    Ok(())
}
