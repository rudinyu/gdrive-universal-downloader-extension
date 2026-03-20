# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.1] - 2026-03-20

### Fixed
- **YouTube "access denied"**: direct URL download from `ytInitialPlayerResponse` was blocked because googlevideo.com streaming URLs require auth headers that a plain navigation request doesn't include. Reverted YouTube to MediaRecorder capture (same as v2.5.3 which was confirmed working).

## [3.1.0] - 2026-03-20

### Fixed
- **Root cause of all v3.0 failures**: the `universal` strategy used `await fetchBlob()` and `await sleep()` directly inside the non-async outer IIFE. This is a JavaScript syntax error — V8 rejects the entire file at parse time, so the IIFE never starts. That explains `marker=null`, empty logs, and the 90 s timeout on every page type including YouTube and Dcard. Fix: wrap the async download loop in an inner `(async () => { ... })()` IIFE.
- Reverted `world: 'ISOLATED'` back to `world: 'MAIN'` for file injections (CSP was not the issue; v2.5.3 used `MAIN` and worked fine).

## [3.0.9] - 2026-03-20

### Fixed
- **YouTube / CSP-protected pages (root cause)**: `executeScript` with `files:` in `world: 'MAIN'` causes Chrome to create a `<script>` element, which pages with nonce-based CSP (e.g. YouTube) silently block — the injection API reports success but the code never runs. Fix: switch `files:` injections (downloader.js, jsPDF) to `world: 'ISOLATED'`, which bypasses the page's CSP while still sharing the `window` object (so `window.__gdriveUniversalDownloader` remains accessible to both worlds).
- **Image download hang**: `fetchBlob` cleared the abort timer when response headers arrived, but `.blob()` can take a long time reading a large body. The timer now stays active until the full blob is received. Timeout reduced to 8 s for faster fallback to direct-link.

## [3.0.8] - 2026-03-20

### Changed
- Added post-injection diagnostic probe (`🔬`) to reveal whether downloader IIFE executes.

## [3.0.7] - 2026-03-20

### Fixed
- **Log blackout (root cause)**: `downloader.js` captured `window.__gdriveUniversalDownloader` into a local `GUD` variable at injection time. If YouTube (or any SPA) reassigned that global between `executeScript` calls, `log()` and `markComplete()` were writing to a stale object that polling never reads. Fix: `log`, `markComplete`, and all recording-state assignments now always read through the live `window.__gdriveUniversalDownloader` reference, so messages are always visible regardless of any GUD reassignment.

## [3.0.6] - 2026-03-20

### Fixed
- **Log blackout / YouTube stuck after injection**: the init script was replacing `window.__gdriveUniversalDownloader` with a new object, meaning downloader.js would capture a stale reference and push logs to an object that polling was no longer reading. Fix: init script now mutates the existing object (only creates a new one if it doesn't already exist), so downloader.js and polling always share the same reference.

## [3.0.5] - 2026-03-20

### Changed
- Added step-by-step diagnostic logs (`[1/3]`, `[3/3]`, GUD diag, `✓ Injected`, `result.error` check) to surface injection failures.

## [3.0.4] - 2026-03-20

### Changed
- (describe changes here)

## [3.0.3] - 2026-03-20

### Fixed
- **Silent log blackout ("stuck at Starting")**: the init script was mutating properties on the existing GUD object. If the page or a SPA had reassigned `window.__gdriveUniversalDownloader` at any point, downloader.js would hold a stale local reference and push logs to an object that polling was no longer reading. Fix: the init script now rebuilds GUD as a completely new object (preserving `capturedVideoURLs`), guaranteeing that downloader.js and polling always share the same reference.
- **Button stuck forever**: added a 90-second safety timeout in `startPolling`; if no completion signal is received, the button re-enables and shows a hint.
- **No feedback when GUD is null**: downloader.js now writes an error message to a fresh namespace object (instead of silently returning) so the popup can display it.

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
