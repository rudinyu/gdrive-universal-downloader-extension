# GDrive Universal Downloader — Chrome Extension

[English](#english) | [中文](#中文)

---

## English

A Chrome Extension that auto-detects Google Drive file types and downloads them with one click — no Console needed.

> ⚠️ **Legal Notice**: This extension is intended only for files you own or have been authorized to access. Please comply with copyright laws and Google's Terms of Service.

### ✨ Features

- **One-click download** — click the extension icon, hit Download
- **Auto file-type detection** — badge shows what type was found
- **No Console required** — all controls are in the popup UI
- **YouTube recording** — ⏹ Stop & Download button replaces any console commands
- **PDF quality controls** — Scale and Quality sliders for view-only PDFs

### 📦 Supported Formats

| Type | Detection | Output |
|------|-----------|--------|
| 📄 View-Only PDF (download disabled) | `blob:https://drive.google.com/` images | `.pdf` |
| 📝 Google Docs | URL contains `/document/` | `.docx` |
| 📊 Google Sheets | URL contains `/spreadsheets/` | `.xlsx` |
| 📑 Google Slides | URL contains `/presentation/` | `.pptx` |
| 📋 Google Forms | URL contains `/forms/` | `.csv` |
| 🎨 Google Drawings | URL contains `/drawings/` | `.svg` |
| 🖼️ Image files | DOM `img` element | Original format |
| 🎬 Video (Drive + YouTube) | XHR/Fetch intercept + MediaRecorder | `.mp4` / `.webm` |
| 🎵 Audio files | DOM `<audio>` element | Original format |
| 📁 Other files (PDF, Office, zip…) | `drive.google.com/file/d/` URL | Original format |

### 🚀 Installation

#### Method 1 — Load Unpacked (Development)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **"Load unpacked"** and select the project folder
5. The extension icon appears in your toolbar

#### Method 2 — From Release ZIP

1. Download the latest `.zip` from [Releases](../../releases)
2. Unzip it
3. Follow steps 2–5 above

### 🎯 Usage

#### All file types (except View-Only PDF and YouTube video)

1. Open the Google Drive file preview
2. Click the 📥 extension icon
3. The file type is auto-detected — click **Download**

#### View-Only PDF

1. Open the PDF link in Chrome
2. Click the three-dot menu → **"Open in new window"**
3. Click the extension icon
4. Adjust **Scale** and **Quality** sliders if needed
5. Click **Download** — the extension auto-scrolls and builds the PDF

#### YouTube / Drive Video

1. Open the video page (let it start loading)
2. Click the extension icon → **Download**
3. Recording starts automatically via `MediaRecorder`
4. When done: video ends → auto-download, **or** click **⏹ Stop & Download** in the popup

### ⚙️ PDF Settings

| Setting | Value | Effect |
|---------|-------|--------|
| **Scale** | `1.0` | Screen size — smallest file *(recommended)* |
| **Scale** | `1.5` | 1.5× screen size |
| **Scale** | `2.0` | Full retina resolution |
| **Quality** | `0.95` | Near-lossless JPEG |
| **Quality** | `0.82` | Balanced *(default)* |
| **Quality** | `0.70` | Smaller file |

**Tip:** You can also control PDF quality via browser zoom (75% = smaller, 150% = sharper).

### 🗂️ Project Structure

```
├── manifest.json        # Extension manifest (MV3)
├── content-hooks.js     # XHR/fetch hooks injected at document_start
├── downloader.js        # Main download logic (injected on demand)
├── popup.html           # Extension popup UI
├── popup.js             # Popup logic + log polling
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### ⚠️ Limitations

| Situation | Result |
|-----------|--------|
| Owner disabled downloads (Docs/Sheets/Slides) | Export API blocked by Google |
| Video with DRM (Widevine) | `captureStream()` returns empty frames |
| YouTube video | Recorded via MediaRecorder — quality matches current stream (360p–720p) |

### 🙏 Credits

- [zeltox/Google-Drive-PDF-Downloader](https://github.com/zeltox/Google-Drive-PDF-Downloader) — auto-scroll & browser zoom tip
- [zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader](https://github.com/zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader) — blob image capture
- [mhsohan/How-to-download-protected-view-only-files-from-google-drive-](https://github.com/mhsohan/How-to-download-protected-view-only-files-from-google-drive-) — display-size optimization

### 📄 License

[MIT](LICENSE)

---

## 中文

一個 Chrome Extension，自動偵測 Google Drive 檔案類型並一鍵下載，完全不需要開啟開發者 Console。

> ⚠️ **合法使用提醒**：本擴充功能僅供用於您本人擁有或已獲授權存取的文件。請遵守著作權及 Google 服務條款。

### ✨ 功能特色

- **一鍵下載** — 點擊擴充功能圖示，按 Download 即可
- **自動偵測檔案類型** — badge 顯示偵測到的檔案類型
- **不需 Console** — 所有操作都在 Popup UI 內完成
- **YouTube 錄製** — ⏹ Stop & Download 按鈕取代所有 Console 指令
- **PDF 品質設定** — View-Only PDF 提供 Scale 和 Quality 調整滑桿

### 📦 支援格式

| 類型 | 偵測方式 | 下載格式 |
|------|----------|----------|
| 📄 View-Only PDF（禁止下載） | `blob:https://drive.google.com/` 圖片 | `.pdf` |
| 📝 Google Docs | URL 含 `/document/` | `.docx` |
| 📊 Google Sheets | URL 含 `/spreadsheets/` | `.xlsx` |
| 📑 Google Slides | URL 含 `/presentation/` | `.pptx` |
| 📋 Google Forms | URL 含 `/forms/` | `.csv` |
| 🎨 Google Drawings | URL 含 `/drawings/` | `.svg` |
| 🖼️ 圖片 | DOM `img` 元素 | 原始格式 |
| 🎬 影片（Drive + YouTube） | XHR/Fetch 攔截 + MediaRecorder | `.mp4` / `.webm` |
| 🎵 音訊 | DOM `<audio>` 元素 | 原始格式 |
| 📁 其他檔案（PDF、Office、zip…） | `drive.google.com/file/d/` URL | 原始格式 |

### 🚀 安裝方式

#### 方式一 — 載入未封裝項目（開發者模式）

1. 下載或 clone 此 repository
2. 開啟 Chrome，網址列輸入 `chrome://extensions/`
3. 右上角打開「**開發人員模式**」
4. 點「**載入未封裝項目**」→ 選擇專案資料夾
5. 擴充功能圖示出現在工具列中

#### 方式二 — 從 Release ZIP 安裝

1. 從 [Releases](../../releases) 下載最新 `.zip`
2. 解壓縮
3. 依照上方步驟 2–5 操作

### 🎯 使用方式

#### 一般格式（除了 View-Only PDF 和 YouTube 影片）

1. 在 Google Drive 開啟檔案預覽頁面
2. 點擊 📥 擴充功能圖示
3. 自動偵測檔案類型 → 點 **Download**

#### View-Only PDF

1. 用 Chrome 開啟 Google Drive PDF 連結
2. 點右上角三點選單 → **「在新視窗開啟」**
3. 點擊擴充功能圖示
4. 視需要調整 **Scale**（縮放）和 **Quality**（品質）滑桿
5. 點 **Download** — 擴充功能自動捲動頁面並建立 PDF

#### YouTube / Drive 影片

1. 開啟影片頁面（讓影片開始載入）
2. 點擊擴充功能圖示 → **Download**
3. 自動透過 `MediaRecorder` 開始錄製
4. 結束方式：影片播完自動下載，**或**在 Popup 點 **⏹ Stop & Download**

### ⚙️ PDF 設定說明

| 參數 | 值 | 效果 |
|------|----|------|
| **Scale** | `1.0` | 螢幕尺寸，最小檔案 *（推薦）* |
| **Scale** | `1.5` | 1.5 倍螢幕尺寸 |
| **Scale** | `2.0` | 完整 Retina 解析度 |
| **Quality** | `0.95` | 接近無損 JPEG |
| **Quality** | `0.82` | 平衡 *（預設）* |
| **Quality** | `0.70` | 較小檔案 |

**小技巧：** 也可以透過瀏覽器縮放控制 PDF 品質（75% = 較小、150% = 較清晰）。

### 🗂️ 專案結構

```
├── manifest.json        # Extension manifest (MV3)
├── content-hooks.js     # 於 document_start 注入的 XHR/fetch 攔截器
├── downloader.js        # 主要下載邏輯（按需注入）
├── popup.html           # Popup UI
├── popup.js             # Popup 邏輯 + Log polling
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### ⚠️ 限制說明

| 情況 | 結果 |
|------|------|
| 擁有者關閉下載（Docs/Sheets/Slides） | Export API 被 Google 封鎖 |
| 影片有 DRM（Widevine）保護 | `captureStream()` 只錄到空白畫面 |
| YouTube 影片 | 透過 MediaRecorder 即時錄製，品質取決於當前串流（360p–720p） |

### 🙏 致謝

- [zeltox/Google-Drive-PDF-Downloader](https://github.com/zeltox/Google-Drive-PDF-Downloader) — 自動捲動 & 瀏覽器縮放技巧
- [zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader](https://github.com/zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader) — blob 圖片擷取
- [mhsohan/How-to-download-protected-view-only-files-from-google-drive-](https://github.com/mhsohan/How-to-download-protected-view-only-files-from-google-drive-) — 螢幕尺寸優化

### 📄 授權

[MIT](LICENSE)
