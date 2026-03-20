# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
