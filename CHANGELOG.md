# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
