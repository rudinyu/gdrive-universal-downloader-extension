# GDrive Universal Downloader — Chrome & Firefox Extension

[English](#english) | [中文](#中文)

---

## English

A Chrome & Firefox Extension that auto-detects downloadable content on **any webpage** and downloads it with one click — no Console needed.

> ⚠️ **Legal Notice**: This extension is intended only for files you own or have been authorized to access. Please comply with copyright laws and Google's Terms of Service.

### ✨ Features

- **Chrome & Firefox support** — works on both browsers (Firefox 128+, Chrome MV3)
- **Universal downloader** — works on any webpage, not just Google Drive and YouTube
- **Resource picker** — scans the page and shows a selectable list of images, videos, and PDFs with checkboxes
- **YouTube quality picker** — choose resolution (Auto / 360p / 480p / 720p / 1080p / …) before recording; the player switches to the selected quality so MediaRecorder captures it with full audio
- **One-click download** — click the extension icon, hit Download
- **Auto file-type detection** — badge shows what type was found
- **No Console required** — all controls are in the popup UI
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
| 🎬 YouTube video | Quality picker + MediaRecorder / video-only direct download | `.mp4` / `.webm` |
| 🎬 Drive video | XHR/Fetch intercept + MediaRecorder | `.mp4` / `.webm` |
| 🖼️ Images (any page) | DOM `<img>` scan (≥ 100 px) | Original format |
| 🎬 Videos (any page) | DOM `<video>` + XHR/Fetch intercept | Original format |
| 📄 PDFs (any page) | `<embed>` / `<object>` / `<iframe>` / `.pdf` URL | `.pdf` |
| 🎵 Audio files | DOM `<audio>` element | Original format |
| 📁 Other Drive files (Office, zip…) | `drive.google.com/file/d/` URL | Original format |

### 🚀 Installation

#### Chrome — Load Unpacked (Development)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **"Load unpacked"** and select the project folder
5. The extension icon appears in your toolbar

#### Chrome — From Release ZIP

1. Download `chrome.zip` from [Releases](../../releases)
2. Unzip it
3. Follow steps 2–5 above

#### Firefox — Load Temporary Add-on (Development)

> Requires Firefox 128 or later.

1. Download or clone this repository
2. Open Firefox and go to `about:debugging`
3. Click **"This Firefox"** in the left sidebar
4. Click **"Load Temporary Add-on…"**
5. Navigate to the project folder and select **`manifest_firefox.json`**
6. The extension icon appears in your toolbar

> **Note:** Temporary add-ons are removed when Firefox restarts. For a persistent install, the extension must be signed via [Firefox AMO](https://addons.mozilla.org/).

#### Firefox — From Release ZIP

1. Download `firefox.zip` from [Releases](../../releases)
2. Unzip it
3. In Firefox go to `about:debugging` → **"This Firefox"** → **"Load Temporary Add-on…"**
4. Select the `manifest.json` inside the unzipped folder

### 🎯 Usage

#### Any webpage (images, videos, PDFs)

1. Open any webpage containing images, videos, or PDFs
2. Click the 📥 extension icon
3. A resource picker appears — check the items you want
4. Click **Download** — files are saved to your downloads folder

#### Google Drive files (Docs, Sheets, Slides, PDF…)

1. Open the Google Drive file preview
2. Click the 📥 extension icon
3. The file type is auto-detected — click **Download**

#### View-Only PDF

1. Open the PDF link in Chrome
2. Click the three-dot menu → **"Open in new window"**
3. Click the extension icon
4. Adjust **Scale** and **Quality** sliders if needed
5. Click **Download** — the extension auto-scrolls and builds the PDF

#### YouTube video

1. Open the YouTube watch page and let the video start loading
2. Click the 📥 extension icon
3. A **quality picker** appears with two sections:
   - **With Audio (MediaRecorder)** — Auto or a specific resolution (360p / 480p / 720p / 1080p / …). The player switches to the chosen quality before recording starts, so the saved file has both video and audio.
   - **Video Only (no audio)** — direct download of the raw adaptive stream (no encoding delay)
4. Select your preferred option and click **Download**
5. For MediaRecorder: keep the tab open while recording. Click **⏹ Stop & Download** to finish early, or wait for the video to end

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
├── manifest.json          # Chrome extension manifest (MV3)
├── manifest_firefox.json  # Firefox extension manifest (MV3, gecko settings)
├── build.sh               # Packages chrome.zip and firefox.zip
├── content-hooks.js       # XHR/fetch hooks injected at document_start
├── detect.js              # Page type + resource detection
├── downloader.js          # Main download logic (injected on demand)
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic + log polling
├── lib/
│   └── jspdf.umd.min.js   # Bundled jsPDF (no remote dependency)
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
| YouTube MediaRecorder | Must keep the tab open during recording; quality depends on what the player actually serves at the selected level |
| YouTube video-only download | No audio track — use MediaRecorder option for audio+video |
| CDN images with strict CORS | Falls back to direct-link download (browser saves as-is) |

### 🙏 Credits

- [zeltox/Google-Drive-PDF-Downloader](https://github.com/zeltox/Google-Drive-PDF-Downloader) — auto-scroll & browser zoom tip
- [zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader](https://github.com/zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader) — blob image capture
- [mhsohan/How-to-download-protected-view-only-files-from-google-drive-](https://github.com/mhsohan/How-to-download-protected-view-only-files-from-google-drive-) — display-size optimization

### 📄 License

[MIT](LICENSE)

---

## 中文

一個 Chrome & Firefox Extension，可在**任意網頁**自動偵測可下載的內容，一鍵下載，完全不需要開啟開發者 Console。

> ⚠️ **合法使用提醒**：本擴充功能僅供用於您本人擁有或已獲授權存取的文件。請遵守著作權及 Google 服務條款。

### ✨ 功能特色

- **支援 Chrome & Firefox** — 同時支援兩種瀏覽器（Firefox 128+、Chrome MV3）
- **通用下載器** — 不限 Google Drive 和 YouTube，任意網頁均可使用
- **資源選擇器** — 掃描頁面並顯示可勾選的圖片、影片、PDF 清單
- **YouTube 畫質選擇器** — 可選擇解析度（Auto / 360p / 480p / 720p / 1080p / …）再錄製；播放器會切換到指定畫質，MediaRecorder 錄到的影片有完整聲音
- **一鍵下載** — 點擊擴充功能圖示，按 Download 即可
- **自動偵測檔案類型** — badge 顯示偵測到的檔案類型
- **不需 Console** — 所有操作都在 Popup UI 內完成
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
| 🎬 YouTube 影片 | 畫質選擇器 + MediaRecorder / 無聲直接下載 | `.mp4` / `.webm` |
| 🎬 Drive 影片 | XHR/Fetch 攔截 + MediaRecorder | `.mp4` / `.webm` |
| 🖼️ 圖片（任意頁面） | DOM `<img>` 掃描（≥ 100 px） | 原始格式 |
| 🎬 影片（任意頁面） | DOM `<video>` + XHR/Fetch 攔截 | 原始格式 |
| 📄 PDF（任意頁面） | `<embed>` / `<object>` / `<iframe>` / `.pdf` URL | `.pdf` |
| 🎵 音訊 | DOM `<audio>` 元素 | 原始格式 |
| 📁 其他 Drive 檔案（Office、zip…） | `drive.google.com/file/d/` URL | 原始格式 |

### 🚀 安裝方式

#### Chrome — 載入未封裝項目（開發者模式）

1. 下載或 clone 此 repository
2. 開啟 Chrome，網址列輸入 `chrome://extensions/`
3. 右上角打開「**開發人員模式**」
4. 點「**載入未封裝項目**」→ 選擇專案資料夾
5. 擴充功能圖示出現在工具列中

#### Chrome — 從 Release ZIP 安裝

1. 從 [Releases](../../releases) 下載 `chrome.zip`
2. 解壓縮
3. 依照上方步驟 2–5 操作

#### Firefox — 載入暫時性附加元件（開發者模式）

> 需要 Firefox 128 或以上版本。

1. 下載或 clone 此 repository
2. 開啟 Firefox，網址列輸入 `about:debugging`
3. 點左側「**此 Firefox**」
4. 點「**載入暫時性附加元件…**」
5. 進入專案資料夾，選擇 **`manifest_firefox.json`**
6. 擴充功能圖示出現在工具列中

> **注意：** 暫時性附加元件在 Firefox 重新啟動後會消失。若需要永久安裝，需透過 [Firefox AMO](https://addons.mozilla.org/) 簽署。

#### Firefox — 從 Release ZIP 安裝

1. 從 [Releases](../../releases) 下載 `firefox.zip`
2. 解壓縮
3. Firefox 開啟 `about:debugging` → **「此 Firefox」** → **「載入暫時性附加元件…」**
4. 選擇解壓縮資料夾內的 `manifest.json`

### 🎯 使用方式

#### 任意網頁（圖片、影片、PDF）

1. 開啟含有圖片、影片或 PDF 的網頁
2. 點擊 📥 擴充功能圖示
3. 出現資源選擇器 — 勾選想要下載的項目
4. 點 **Download** — 檔案存入下載資料夾

#### Google Drive 檔案（Docs、Sheets、Slides、PDF…）

1. 在 Google Drive 開啟檔案預覽頁面
2. 點擊 📥 擴充功能圖示
3. 自動偵測檔案類型 → 點 **Download**

#### View-Only PDF

1. 用 Chrome 開啟 Google Drive PDF 連結
2. 點右上角三點選單 → **「在新視窗開啟」**
3. 點擊擴充功能圖示
4. 視需要調整 **Scale**（縮放）和 **Quality**（品質）滑桿
5. 點 **Download** — 擴充功能自動捲動頁面並建立 PDF

#### YouTube 影片

1. 開啟 YouTube 觀看頁面，讓影片開始載入
2. 點擊 📥 擴充功能圖示
3. 出現**畫質選擇器**，分為兩個區段：
   - **With Audio（MediaRecorder）** — Auto 或指定解析度（360p / 480p / 720p / 1080p / …）。錄製前會切換播放器畫質，錄下的檔案同時包含影像與聲音。
   - **Video Only（無聲音）** — 直接下載原始 adaptive 串流（無需錄製等待）
4. 選擇偏好的選項，點 **Download**
5. 使用 MediaRecorder 時：請保持分頁開啟。可點 **⏹ Stop & Download** 提早結束，或等影片播完自動下載

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
├── manifest.json          # Chrome Extension manifest (MV3)
├── manifest_firefox.json  # Firefox Extension manifest (MV3，含 gecko 設定)
├── build.sh               # 打包 chrome.zip 與 firefox.zip
├── content-hooks.js       # 於 document_start 注入的 XHR/fetch 攔截器
├── detect.js              # 頁面類型與資源偵測
├── downloader.js          # 主要下載邏輯（按需注入）
├── popup.html             # Popup UI
├── popup.js               # Popup 邏輯 + Log polling
├── lib/
│   └── jspdf.umd.min.js   # 本地打包的 jsPDF（無遠端依賴）
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
| YouTube MediaRecorder | 錄製期間需保持分頁開啟；實際畫質取決於播放器在該等級實際提供的串流 |
| YouTube 無聲直接下載 | 無音軌 — 需要聲音請選 MediaRecorder 選項 |
| CDN 圖片有嚴格 CORS 限制 | 退回直接連結下載（瀏覽器原生存檔） |

### 🙏 致謝

- [zeltox/Google-Drive-PDF-Downloader](https://github.com/zeltox/Google-Drive-PDF-Downloader) — 自動捲動 & 瀏覽器縮放技巧
- [zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader](https://github.com/zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader) — blob 圖片擷取
- [mhsohan/How-to-download-protected-view-only-files-from-google-drive-](https://github.com/mhsohan/How-to-download-protected-view-only-files-from-google-drive-) — 螢幕尺寸優化

### 📄 授權

[MIT](LICENSE)
