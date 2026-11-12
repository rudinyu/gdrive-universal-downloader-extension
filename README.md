# GDrive Universal Downloader — Chrome & Firefox Extension

[English](#english) | [中文](#中文)

---

## English

A Chrome & Firefox Extension that auto-detects downloadable content on **any webpage** and downloads it with one click — no Console needed.

> ⚠️ **Legal Notice**: This extension is intended only for files you own or have been authorized to access. Please comply with copyright laws and Google's Terms of Service.

### ✨ Features

- **Chrome & Firefox support** — works on both browsers (Firefox 128+, Chrome MV3)
- **Universal downloader** — works on any webpage, not just Google Drive and YouTube
- **Preload image detection** — captures images declared via `<link rel="preload" as="image">`, not just `<img>` tags
- **Cross-origin image download** — images and PDFs are downloaded via the browser's native download API, bypassing CORS restrictions that would otherwise open the image in a new tab instead of saving it
- **Resource picker** — scans the page and shows a selectable list of images, videos, PDFs, and HLS playlists with checkboxes
- **YouTube quality picker** — choose resolution (Auto / 360p / 480p / 720p / 1080p / …) before recording; the player switches to the selected quality so MediaRecorder captures it with full audio
- **HLS VOD downloader** — detects finished, unencrypted AVC/AAC HLS streams and saves supported TS or fMP4 segments as MP4 without re-encoding
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
| 📡 HLS VOD | HLS playlist detection + AVC/AAC remux | `.mp4` |
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

#### HLS VOD

1. Open a page that loads an HLS playlist, then click the extension icon.
2. Select one HLS playlist by itself and click **Download**. By default, a dedicated extension tab opens and starts the highest supported quality using the page title as the filename; the job continues after the popup closes.
3. To choose a different quality or filename first, check **Choose quality and filename first** in the popup. Then choose options in the dedicated tab and click **Start download**. Keep that tab open until the browser reports that the MP4 is saved.

The downloader supports finished, unencrypted HLS VOD playlists. It remuxes MPEG-TS segments containing AVC/H.264 and AAC into fragmented MP4 without re-encoding, or joins compatible fragmented-MP4 segments. A master variant with one unambiguous external AAC audio rendition is also combined with its AVC video when both playlists use compatible fragmented MP4; track IDs and fragment timing are adjusted without re-encoding. Explicit and implicit byte ranges are supported when the server honors HTTP Range requests. TS discontinuities are rebased through mux.js; fMP4 discontinuities and changing initialization maps are rejected. Segment concurrency is selectable from one to four (default four). Output is streamed to the browser's Origin Private File System (OPFS) when available, with a 4 GiB implementation cap; browsers without OPFS use IndexedDB chunks capped at 192 MiB. The browser's actual storage quota can be lower, and each media segment is capped at 8 MiB.

Separate audio merging is limited to a single clear AVC video track and a single clear AAC audio track in stable fMP4 playlists. When the separate audio playlist is unavailable or cannot be combined, the downloader retries the valid video playlist by itself; if the finished MP4 has no audio track, the filename gains `-no音訊` before `.mp4` and the completion message says that audio is missing. Cancellation, video failures, and storage or permission errors stop the job without this fallback. Ambiguous audio selections are not merged, but a valid selected video playlist may still be downloaded alone. Separate video renditions, encrypted video tracks, changing initialization maps, discontinuities, and unsupported fragment offsets or layouts remain unsupported for remuxing. Cross-origin fetches first include browser cookies, then retry without credentials only if the browser rejects the fetch; HTTP 403/404 responses are reported directly. Automatic HTTP redirects are disabled so a public playlist cannot redirect the extension request to a private or local address; CDNs that require redirects are unsupported. Site/CDN access is not guaranteed: extension host access does not override a site's CORS, authentication, expiry, cookie, or referer policies.

The shared HLS pipeline uses browser-specific Chrome MV3 and Firefox WebExtension adapters. It accepts HTTP(S) URLs and rejects private IP literals and local hostnames before starting requests. It does not resolve DNS names itself, so a public-looking hostname that resolves to a private address is not detected by this check.

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
├── hls.html               # Persistent HLS download tab
├── hls-platform.js        # Chrome and Firefox WebExtension adapters
├── hls-page.js            # HLS job UI and network requests
├── hls-core.js            # Playlist parsing, validation, and bounded remux pipeline
├── hls-storage.js         # IndexedDB job handoff; OPFS output with bounded IndexedDB fallback
├── lib/
│   ├── jspdf.umd.min.js   # Bundled jsPDF (no remote dependency)
│   ├── mux.js             # Bundled MPEG-TS to fMP4 transmuxer
│   └── MUX_JS_LICENSE.txt # Apache-2.0 license for mux.js
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
| HLS video playlist uses DRM or encryption | Rejected; the extension does not decrypt protected streams |
| HLS playlist is live or low-latency, or uses separate video | Rejected with an explanation; ambiguous audio selections are skipped and valid video can be saved without audio |
| HLS uses a separate AAC rendition in compatible fMP4 playlists | Combined with video into a two-track MP4 without re-encoding; if the rendition cannot be used, valid video-only output is marked `-no音訊.mp4` |
| HLS uses codecs other than AVC/H.264 and AAC, or changing fMP4 maps/discontinuities | Rejected rather than labeled as MP4 |
| HLS site/CDN blocks extension fetches or byte-range requests | Download may fail because CORS, cookies, referer checks, and server behavior vary by site |
| HLS playlist or segment uses a private IP or local hostname | Rejected before the extension makes a request |
| HLS output exceeds 4 GiB with OPFS, 192 MiB with the IndexedDB fallback, or an individual segment exceeds 8 MiB | Rejected; available browser storage can impose a lower limit |

### 🙏 Credits

- [zeltox/Google-Drive-PDF-Downloader](https://github.com/zeltox/Google-Drive-PDF-Downloader) — auto-scroll & browser zoom tip
- [zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader](https://github.com/zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader) — blob image capture
- [mhsohan/How-to-download-protected-view-only-files-from-google-drive-](https://github.com/mhsohan/How-to-download-protected-view-only-files-from-google-drive-) — display-size optimization
- [videojs/mux.js](https://github.com/videojs/mux.js) — MPEG-TS to fragmented-MP4 transmuxing, Apache-2.0; bundled license at `lib/MUX_JS_LICENSE.txt`

### 📄 License

[MIT](LICENSE)

---

## 中文

一個 Chrome & Firefox Extension，可在**任意網頁**自動偵測可下載的內容，一鍵下載，完全不需要開啟開發者 Console。

> ⚠️ **合法使用提醒**：本擴充功能僅供用於您本人擁有或已獲授權存取的文件。請遵守著作權及 Google 服務條款。

### ✨ 功能特色

- **支援 Chrome & Firefox** — 同時支援兩種瀏覽器（Firefox 128+、Chrome MV3）
- **通用下載器** — 不限 Google Drive 和 YouTube，任意網頁均可使用
- **Preload 圖片偵測** — 可抓取透過 `<link rel="preload" as="image">` 宣告的圖片，不限 `<img>` 標籤
- **跨域圖片下載** — 圖片與 PDF 改用瀏覽器原生下載 API，繞過 CORS 限制，不再發生「開啟圖片頁面而非儲存」的問題
- **資源選擇器** — 掃描頁面並顯示可勾選的圖片、影片、PDF 與 HLS 播放清單
- **YouTube 畫質選擇器** — 可選擇解析度（Auto / 360p / 480p / 720p / 1080p / …）再錄製；播放器會切換到指定畫質，MediaRecorder 錄到的影片有完整聲音
- **HLS VOD 下載器** — 偵測已完成且未加密的 AVC/AAC HLS 串流，將支援的 TS 或 fMP4 片段存成 MP4，不重新編碼
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
| 📡 HLS VOD | HLS 播放清單偵測 + AVC/AAC remux | `.mp4` |
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

#### HLS VOD

1. 開啟會載入 HLS 播放清單的網頁，再點擊擴充功能圖示。
2. 單獨選擇一個 HLS 播放清單並點 **Download**。預設會開啟專用分頁，自動下載最高支援畫質，並以網頁標題作為檔名；關閉 Popup 後工作仍會繼續。
3. 若要先選擇畫質或編輯檔名，請在 Popup 勾選 **Choose quality and filename first**。接著在專用分頁選擇選項並點 **Start download**。瀏覽器顯示 MP4 已儲存前，請保持專用分頁開啟。

支援已完成且未加密的 HLS VOD。含 AVC/H.264 與 AAC 的 MPEG-TS 片段會直接 remux 成 fragmented MP4，不重新編碼；相容的 fMP4 片段則會直接串接。若 master variant 明確選出一個外部 AAC 音訊 rendition，且音訊與影片都是相容的 fragmented MP4，也會重整 track ID 與片段時間並合併為同一個 MP4，不重新編碼。若伺服器支援 HTTP Range，會處理明確與連續位元組範圍。TS discontinuity 會由 mux.js 重新定位時間；fMP4 discontinuity 或變更初始化片段會明確拒絕。片段並行數可選 1 到 4（預設 4）。支援時會將輸出串流寫入瀏覽器的 Origin Private File System（OPFS），實作上限為 4 GiB；不支援 OPFS 的瀏覽器會改用 IndexedDB 片段，輸出上限為 192 MiB。瀏覽器實際可用空間可能更少，單一媒體片段上限為 8 MiB。

獨立音訊合併僅支援清晰、穩定的 fMP4 播放清單，且必須各只有一個 AVC 影片軌與 AAC 音訊軌。若獨立音訊播放清單無法使用或無法合併，下載器會改下載仍有效的影片播放清單；若完成的 MP4 沒有音訊軌，檔名會在 `.mp4` 前加上 `-no音訊`，完成訊息也會清楚標示沒有音訊。取消下載、影片失敗、儲存或權限錯誤都會直接停止，不會改成影片備援。模糊的音訊選擇不會合併，但仍可單獨下載有效的影片播放清單。獨立影像、加密影片軌、變更初始化片段、discontinuity，以及不支援的 fragment offset/layout 仍不受支援。跨來源請求會先附帶瀏覽器 Cookie；只有瀏覽器拒絕請求時才會改用不帶憑證重試，HTTP 403/404 則會直接回報。為避免公開播放清單將擴充功能請求重新導向至私有或本機位址，HLS 請求不會自動跟隨 HTTP redirect；依賴 redirect 的 CDN 不受支援。網站或 CDN 仍可能因 CORS、登入狀態、連結期限、Cookie 或 Referer 規則而阻擋擴充功能的請求。

共用 HLS 流程透過 Chrome MV3 與 Firefox WebExtension adapter 呼叫瀏覽器 API。支援 HTTP(S) URL，並會在發出請求前拒絕私有 IP 字面值與本機主機名稱。流程不會自行解析 DNS，因此無法辨識解析到私有位址的公開格式主機名稱。

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
├── hls.html               # 持續執行 HLS 工作的專用分頁
├── hls-platform.js        # Chrome 與 Firefox WebExtension adapter
├── hls-page.js            # HLS 工作介面與網路請求
├── hls-core.js            # 播放清單解析、驗證與有界 remux 流程
├── hls-storage.js         # IndexedDB 工作交接；OPFS 輸出與有界 IndexedDB 備援
├── lib/
│   ├── jspdf.umd.min.js   # 本地打包的 jsPDF（無遠端依賴）
│   ├── mux.js             # MPEG-TS 轉 fMP4 transmuxer
│   └── MUX_JS_LICENSE.txt # mux.js 的 Apache-2.0 授權
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
| HLS 影片播放清單使用 DRM 或加密 | 明確拒絕；擴充功能不會解密受保護串流 |
| HLS 是直播、低延遲或使用獨立影像 | 顯示原因並拒絕下載；模糊的音訊選擇會略過，若影片有效則可另存無音訊檔案 |
| HLS 使用相容 fMP4 的獨立 AAC 音訊 rendition | 不重新編碼合併為雙軌 MP4；若獨立音訊無法使用，仍有效的純影片輸出會標示 `-no音訊.mp4` |
| HLS 使用 AVC/H.264、AAC 以外的 codec，或 fMP4 初始化資料改變／discontinuity | 明確拒絕，避免輸出不相容的 MP4 |
| HLS 網站或 CDN 阻擋 extension fetch 或 byte-range 請求 | 可能因 CORS、Cookie、Referer 或伺服器行為而失敗 |
| HLS 播放清單或片段使用私有 IP 或本機主機名稱 | 發出請求前會拒絕 |
| HLS 輸出超過 OPFS 的 4 GiB 上限、IndexedDB 備援的 192 MiB 上限，或單一片段超過 8 MiB | 明確拒絕；瀏覽器可用空間可能更少 |

### 🙏 致謝

- [zeltox/Google-Drive-PDF-Downloader](https://github.com/zeltox/Google-Drive-PDF-Downloader) — 自動捲動 & 瀏覽器縮放技巧
- [zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader](https://github.com/zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader) — blob 圖片擷取
- [mhsohan/How-to-download-protected-view-only-files-from-google-drive-](https://github.com/mhsohan/How-to-download-protected-view-only-files-from-google-drive-) — 螢幕尺寸優化
- [videojs/mux.js](https://github.com/videojs/mux.js) — MPEG-TS 轉 fragmented MP4，Apache-2.0；授權檔在 `lib/MUX_JS_LICENSE.txt`

### 📄 授權

[MIT](LICENSE)
