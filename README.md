# 音藏 · MusicBin

> 本地播放 · 单曲下载

一个跨平台的桌面音乐搜索、试听与下载工具。聚合多个音源，喜欢的歌一键下载到本地，自动嵌入封面、标题、歌手和歌词。

![音藏程序截图](docs/screenshot.png)

## 功能特性

### 搜索与播放
- **多源搜索**：内置源（歌曲宝）+ 可扩展的插件源（如 bilibili），同一关键词聚合返回结果
- **在线试听**：完整播放控制（上一首/暂停/下一首、进度、音量、播放队列）
- **歌词面板**：随播放展示歌词，支持切换显示
- **深色/浅色主题**：一键切换，界面以橙色点缀的现代暗色设计为主

### 下载与元数据
- **单曲下载**：自选目录，下载进度实时展示，下载记录可查
- **智能容器识别**：按文件头魔数自动纠正扩展名（m4a / mp3 / flac / ogg / wav），不会出现"后缀与内容不符"
- **元数据内嵌**：
  - MP3 → ID3v2.3 标签（标题 / 歌手 / 封面）
  - M4A / MP4 → 标准 ilst 标签（含 `covr` 封面），写入前经临时文件 + 原子校验，绝不损坏分片式 fMP4
  - FLAC / OGG → 标题、歌手 + 同名封面图
- **歌词文件**：自动保存同名 `.lrc`（UTF-8 BOM）
- **封面防盗链**：图床 403 时自动按多策略（插件头 → 站点 Referer → 直连）重试，并校验图片魔数，杜绝把错误页嵌进文件

### 插件系统
- 兼容 **MusicFree 插件** 格式，从插件市场一键安装
- 插件在 **JS 沙箱** 中运行，`platform` / `version` 校验通过才可安装
- 支持搜索、取流、歌词、封面等完整能力接入

### 其他
- **自动更新**：基于 Tauri Updater + minisign 签名校验
- **F12 开发者工具**：release 包同样可用，方便排查问题

## 下载安装

前往 [Releases](https://github.com/WuMortal/MusicBin/releases) 页面下载对应平台安装包：

| 平台 | 文件 |
| --- | --- |
| Windows | `*.msi` / `*.exe` |
| macOS (Intel) | `*x64.dmg` |

> 下载安装后，应用会在后台检查更新，新版本发布后可直接升级。

## 本地开发

环境要求：Node.js ≥ 18、Yarn、Rust stable（含 Tauri 2 依赖）。

```bash
# 安装依赖
yarn install

# 启动开发模式（Vite + Tauri 热更新）
yarn tauri:dev

# 类型检查
yarn typecheck

# 打包正式版（Windows 下生成 msi/exe）
yarn tauri:build
```

### 项目结构

```
music-vault/
├── src/                    # 前端（Vue 3 + TypeScript）
│   ├── pages/              #   搜索页 / 下载记录 / 设置页
│   ├── components/          #   插件市场、进度、确认框等通用组件
│   ├── lib/source/          #   音源抽象：内置源 + 插件源
│   ├── lib/sandbox/         #   插件 JS 沙箱宿主
│   └── shells/              #   桌面外壳布局
├── src-tauri/               # 后端（Rust + Tauri 2）
│   └── src/
│       ├── music.rs         #   内置源抓取、下载收尾、标签嵌入
│       └── plugin.rs        #   插件取流、插件下载
├── docs/                    # 文档与截图
└── .github/workflows/       # CI：推送 release 分支自动构建多平台产物
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 · TypeScript · Vite · vue-router · lucide-vue-next |
| 桌面框架 | Tauri 2（WebView，非 Electron） |
| 后端 | Rust · reqwest · id3（MP3 标签）· lofty（MP4 标签）|
| 更新 | tauri-plugin-updater · minisign 签名 |
| 构建 | GitHub Actions（Windows / macOS x86_64） |

## 发布流程

1. 更新 `package.json` 与 `src-tauri/tauri.conf.json` 中的版本号
2. 推送到 `release` 分支，CI 自动构建 Windows / macOS 安装包与更新产物
3. 在 GitHub Releases 页完善更新说明并发布，客户端即可收到更新

## 说明

本项目仅供学习交流使用，请勿将下载内容用于商业用途，支持正版音乐。
