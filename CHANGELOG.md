# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.2] - 2026-03-19

### Fixed
- Fix blob URL memory leak in text downloads (added `revokeObjectURL` cleanup)
- Fix `autoScroll` missing lazy-loaded pages by re-reading `scrollHeight` each iteration
- Fix generic file-export hardcoding `.pdf` extension for all file types
- Fix `getTitle()` stripping non-extension suffixes (e.g., "Report Q4.2025")
- Fix XHR hook breaking `instanceof XMLHttpRequest` (patch prototype instead of replacing constructor)
- Fix polling never stopping after download completes
- Fix silent swallowing of video playback errors
- Fix `lang="zh-TW"` mismatch with English UI

### Changed
- Extract duplicated file-type detection logic into shared `detect.js` (single source of truth)
- Use `currentType` variable instead of brittle DOM className parsing
- Refactor log classification to structured `LOG_LEVELS` array
- Add early-return guard when GUD namespace is missing
- Add version bump script and GitHub Actions release workflow

## [2.5.1] - 2026-03-19

### Fixed
- **Security:** Removed remote script loading of `jsPDF` from `unpkg.com` to prevent supply chain attacks and comply with Chrome Web Store safety policies. `jsPDF` is now bundled locally in `lib/`.
- **UI:** Replaced hardcoded timeout delays (3 seconds) with an event-driven polling mechanism to ensure the UI is always in sync with background tasks.

### Changed
- **Architecture:** Consolidate multiple extension-specific global variables into a single unified `window.__gdriveUniversalDownloader` namespace to prevent conflicts with page scripts.
- **Refactor:** Synchronized file type detection logic between the popup and downloader.

## [2.5.0] - 2026-03-13

### Added
- Initial release with support for Google Drive view-only PDFs, Docs, Sheets, Slides, Videos, and YouTube.
- MediaRecorder integration for YouTube video capture.
- Automatic scrolling logic for large PDFs.
