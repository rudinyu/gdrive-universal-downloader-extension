#!/usr/bin/env bash
# Build Chrome and Firefox extension zips
set -euo pipefail

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

# Validate required files exist
for f in manifest.json manifest_firefox.json popup.html popup.js content-hooks.js detect.js downloader.js; do
  [[ -f "$f" ]] || { echo "Error: required file '$f' not found" >&2; exit 1; }
done
[[ -d icons ]] || { echo "Error: icons/ directory not found" >&2; exit 1; }
[[ -d lib   ]] || { echo "Error: lib/ directory not found"   >&2; exit 1; }

# Validate manifests are parseable JSON
if ! python3 -c "import json,sys; json.load(open('manifest.json'))" 2>/dev/null && \
   ! node -e "JSON.parse(require('fs').readFileSync('manifest.json'))" 2>/dev/null; then
  echo "Warning: could not validate manifest.json (no python3/node found)" >&2
fi

echo "Building chrome.zip..."
zip -r chrome.zip "${FILES[@]}"

echo "Building firefox.zip..."
# Swap manifest temporarily; restore on exit (even if zip fails)
cp manifest.json manifest_chrome_backup.json
trap 'mv -f manifest_chrome_backup.json manifest.json' EXIT

cp manifest_firefox.json manifest.json
zip -r firefox.zip "${FILES[@]}"

# Explicit restore (trap also fires but being explicit is clearer)
mv -f manifest_chrome_backup.json manifest.json
trap - EXIT

echo "Done: chrome.zip and firefox.zip"
