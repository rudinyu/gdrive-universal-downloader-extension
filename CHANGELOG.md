# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.2] - 2026-03-20

### Fixed
- **Stop button missing after popup reopen**: `init()` now reads `GUD.recording` on startup; if a MediaRecorder session is already running (popup was closed and reopened mid-recording), the running state is restored and polling resumes so the Stop & Download button is immediately visible.
- **Universal video download hanging**: videos in universal picker now use a direct `triggerDownload` link (hands off to the browser download manager) instead of `fetchBlob`, which would attempt to buffer the entire video file in memory and block the UI indefinitely.

## [3.0.1] - 2026-03-20

### Fixed
- **Universal stuck at "Starting..."**: popup now sets `detectedType` directly in the init script instead of re-injecting `detect.js` at download time. On pages with lazy-loaded images (e.g. Dcard), `naturalWidth` is 0 during re-scan, causing `detect.js` to overwrite the type back to `unknown` and silently skip all download logic.
- **YouTube direct download**: downloader now reads `ytInitialPlayerResponse.streamingData.formats` to get a direct progressive stream URL (real file download). MediaRecorder is used as a fallback only when no direct URL is available.
- **Fetch hang on CDN images**: removed `credentials: 'include'` (CDNs returning `Access-Control-Allow-Origin: *` reject credentialed requests); added a 15-second `AbortController` timeout to prevent fetch from blocking indefinitely.

## [3.0.0] - 2026-03-20

### Added
- **Universal Downloader**: extension now works on any webpage, not just Google Drive and YouTube.
- Resource picker UI: popup scans the page and shows a selectable list of images, videos, and PDFs with checkboxes and Select All / None controls.
- Image download uses `fetch()` → blob strategy to force save-to-disk even for cross-origin images, with a direct-link fallback.
- PDF detection covers `<embed>`, `<object>`, `<iframe>`, and pages whose URL ends in `.pdf`.
- XHR/fetch hooks extended to capture `.mp4`, `.webm`, `.mov`, and `.ogg` URLs on any site.

### Changed
- `host_permissions` and `content_scripts` expanded to `<all_urls>`.
- Generic `<video>` / `<audio>` DOM detection (non-GDrive pages) replaced by the universal resource picker.
- Extension description updated to reflect universal scope.

## [2.5.3] - 2026-03-20

### Fixed
- Popup detects when a run ends (even with warnings) via `runComplete`, so the Download button reliably re-enables without reopening the popup.
- Downloader now emits `markComplete()` signals for every exit path, which prevents the UI from hanging after warning-only flows.

### Changed
- Video/audio/image downloads infer filename extensions from stream URLs or MIME types instead of forcing `.mp4/.mp3/.jpg`, so files save with their native formats (e.g., `.webm`, `.mov`, `.png`).

## [2.5.2] - 2026-03-19

### Fixed
- **Security:** Resolved critical RCE vulnerability by bundling `jsPDF` locally in `lib/`.
- **UI:** Improved state management and polling for more accurate "Download" button behavior.
- **Namespace:** Unified global variables into `window.__gdriveUniversalDownloader` to prevent page conflicts.

## [2.5.1] - 2026-03-19
### Fixed
- Initial security refactor (BETA).

## [2.5.0] - 2026-03-13
### Added
- Initial release with support for Google Drive view-only PDFs, Docs, Sheets, Slides, Videos, and YouTube.
