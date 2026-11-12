# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.8.0] - 2026-11-12

### Added
- Added HLS VOD detection and a resource-picker workflow that starts the highest supported quality automatically by default, with an opt-out for manual quality and filename selection.
- Added bounded TS-to-fMP4 remuxing and compatible fMP4 assembly in a dedicated tab, with IndexedDB job handoff so the task survives popup closure; output streams to OPFS (4 GiB cap) or uses a bounded IndexedDB fallback (192 MiB cap), and segment concurrency is selectable from one to four.
- Added no-transcode merging for compatible fMP4 HLS variants with one separate AVC video track and one AAC audio track, including track-ID remapping and decode-time ordering.
- Added a safe video-only fallback when a separate audio rendition cannot be used; files without an audio track are named with `-no音訊.mp4` and clearly reported in the download tab.
- Added shared Chrome MV3 and Firefox WebExtension adapters for HLS networking, host access, downloads, and extension-tab lifecycle.
- Added credential fallback for cross-origin CORS rejections while preserving HTTP authorization failures.
- Disabled automatic HLS redirects so a public playlist cannot redirect extension requests to private or local addresses.

## [3.8.1] - 2026-11-12

### Fixed
- Hardened HLS fMP4 assembly by normalizing size-zero boxes and validating separate-rendition sample offsets against each media-data box.
- Kept separate audio optional: combine compatible audio when possible, otherwise allow video-only fallback; prevent canceled jobs from reporting success.
- Reclaim stale HLS jobs and outputs with bounded startup cleanup, and make HLS picker choices exclusive with sanitized role and path labels.

## [3.7.18] - 2026-11-10

### Fixed
- Fixed intermittent failed image downloads in Firefox by revoking blob URLs only after the download has ended.
- Report interrupted image and YouTube mux downloads as failures in the popup log instead of showing success.

## [3.7.17] - 2026-11-09

### Added
- Detect HTTP(S) image-like requests initiated by page images through Resource Timing, allowing Canvas-based viewers such as MyPPT to expose rendered images as page resources with unknown dimensions.

## [3.7.4] - 2026-04-18

### Fixed
- Scoped temporary `declarativeNetRequest` Referer rewrite rules to the active tab so Firefox no longer applies them browser-wide.
- Preserved the full HTTP(S) page Referer during protected downloads while still stripping URL fragments.

## [3.7.1] - 2026-03-26

### Security
- Restricted temporary `declarativeNetRequest` rules to extension-initiated HTTP(S) requests and collapse Referer spoofing to the page origin so other tabs never inherit a spoofed or sensitive URL.
- Sanitized every derived filename before handing it to `chrome.downloads` (and blob saves), stripping traversal patterns and control characters from page-controlled names.

## [3.4.0] - 2026-03-20

### Changed
- Refactored core logic for better modularity and maintainability
- Improved page detection with a centralized selector map
- Enhanced popup with better state restoration and error handling
- Centralized configuration and constants in downloader.js
- Made version bump script more portable

## [3.3.1] - 2026-03-20

### Security
- **XSS fix**: replaced `innerHTML` with `textContent` + DOM-constructed badge elements in the YouTube quality picker — page-supplied format labels can no longer inject HTML into the popup.

## [3.3.0] - 2026-03-18

### Added
- **Resource Picker**: Scans current webpage for images, videos, and PDFs.
- **Deduplication**: Automatically dedupes PDFs by source URL.
- **Universal Mode**: The popup now displays a list of detected resources with checkboxes for selection.
- **Batch Download**: Allows downloading multiple selected items with a single click.
- **Retry Logic**: If a high-resolution image fetch fails (CORS), it falls back to a direct link download.

### Changed
- Refactored `popup.js` to support the new resource picker UI.
- Updated `detect.js` with improved logic for scanning generic webpages.
- Increased download batch limit to 50 items.

### Fixed
- Fixed a bug where YouTube direct download would sometimes fail due to URL encoding issues.
