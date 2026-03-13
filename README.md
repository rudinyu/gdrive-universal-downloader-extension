# GDrive Universal Downloader — Chrome Extension

A Chrome Extension that auto-detects Google Drive file types and downloads them with one click — no Console needed.

> ⚠️ **Legal Notice**: This extension is intended only for files you own or have been authorized to access. Please comply with copyright laws and Google's Terms of Service.

---

## ✨ Features

- **One-click download** — click the extension icon, hit Download
- **Auto file-type detection** — badge shows what type was found
- **No Console required** — all controls are in the popup UI
- **YouTube recording** — Stop & Download button replaces any console commands
- **PDF quality controls** — Scale and Quality sliders for view-only PDFs

---

## 📦 Supported Formats

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

---

## 🚀 Installation

### Method 1 — Load Unpacked (Development)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **"Load unpacked"** and select the project folder
5. The extension icon appears in your toolbar

### Method 2 — From Release ZIP

1. Download the latest `.zip` from [Releases](../../releases)
2. Unzip it
3. Follow steps 2–5 above

---

## 🎯 Usage

### All file types (except View-Only PDF and YouTube video)

1. Open the Google Drive file preview
2. Click the 📥 extension icon
3. The file type is auto-detected — click **Download**

### View-Only PDF

1. Open the PDF link in Chrome
2. Click the three-dot menu → **"Open in new window"**
3. Click the extension icon
4. Adjust **Scale** and **Quality** sliders if needed
5. Click **Download** — the extension auto-scrolls and builds the PDF

### YouTube / Drive Video

1. Open the video page (let it start loading)
2. Click the extension icon → **Download**
3. Recording starts automatically via `MediaRecorder`
4. When done: video ends → auto-download, **or** click **⏹ Stop & Download** in the popup

---

## ⚙️ PDF Settings

| Setting | Value | Effect |
|---------|-------|--------|
| **Scale** | `1.0` | Screen size — smallest file *(recommended)* |
| **Scale** | `1.5` | 1.5× screen size |
| **Scale** | `2.0` | Full retina resolution |
| **Quality** | `0.95` | Near-lossless JPEG |
| **Quality** | `0.82` | Balanced *(default)* |
| **Quality** | `0.70` | Smaller file |

**Tip:** You can also control PDF quality via browser zoom (75% = smaller, 150% = sharper).

---

## 🗂️ Project Structure

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

### Architecture

```
[Page loads]
     │
     ▼
content-hooks.js (document_start, MAIN world)
  → Installs XHR/fetch interceptors to capture video stream URLs early

[User clicks extension icon]
     │
     ▼
popup.js
  → Detects file type by running a snippet in the page
  → Shows type badge + relevant settings (PDF sliders / video note)

[User clicks Download]
     │
     ▼
popup.js
  → Pushes settings to window.__gdriveSettings
  → Injects downloader.js into the page (MAIN world)
  → Polls window.__gdriveLog every 400ms for live log output
  → Shows ⏹ Stop & Download button while MediaRecorder is active
```

---

## ⚠️ Limitations

| Situation | Result |
|-----------|--------|
| Owner disabled downloads (Docs/Sheets/Slides) | Export API blocked by Google |
| Video with DRM (Widevine) | `captureStream()` returns empty frames |
| YouTube video | Recorded via MediaRecorder — quality matches current stream (360p–720p) |

---

## 🙏 Credits

- [zeltox/Google-Drive-PDF-Downloader](https://github.com/zeltox/Google-Drive-PDF-Downloader) — auto-scroll & browser zoom tip
- [zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader](https://github.com/zavierferodova/Google-Drive-View-Only-PDF-Script-Downloader) — blob image capture
- [mhsohan/How-to-download-protected-view-only-files-from-google-drive-](https://github.com/mhsohan/How-to-download-protected-view-only-files-from-google-drive-) — display-size optimization

---

## 📄 License

[MIT](LICENSE)
