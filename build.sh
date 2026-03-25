#!/usr/bin/env bash
# Build Chrome and Firefox extension zips
set -e

FILES=(
  manifest.json
  popup.html
  popup.js
  content-hooks.js
  detect.js
  downloader.js
  icons
  lib
)

echo "Building chrome.zip..."
zip -r chrome.zip "${FILES[@]}"

echo "Building firefox.zip..."
# Temporarily swap manifest
cp manifest.json manifest_chrome_backup.json
cp manifest_firefox.json manifest.json
zip -r firefox.zip "${FILES[@]}"
# Restore
mv manifest_chrome_backup.json manifest.json

echo "Done: chrome.zip and firefox.zip"
