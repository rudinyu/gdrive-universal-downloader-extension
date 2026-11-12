#!/usr/bin/env bash
# Build Chrome and Firefox extension zips (both use the same manifest.json)
set -euo pipefail

FILES=(
  manifest.json
  popup.html
  popup.js
  hls.html
  hls-platform.js
  hls-page.js
  hls-core.js
  hls-storage.js
  content-hooks.js
  detect.js
  downloader.js
  LICENSE
  icons
  lib
)

# Validate required files exist
for f in manifest.json popup.html popup.js hls.html hls-platform.js hls-page.js hls-core.js hls-storage.js content-hooks.js detect.js downloader.js LICENSE lib/mux.js lib/MUX_JS_LICENSE.txt; do
  [[ -f "$f" ]] || { echo "Error: required file '$f' not found" >&2; exit 1; }
done
[[ -d icons ]] || { echo "Error: icons/ directory not found" >&2; exit 1; }
[[ -d lib   ]] || { echo "Error: lib/ directory not found"   >&2; exit 1; }

# Validate manifest is parseable JSON
if ! python3 -c "import json,sys; json.load(open('manifest.json'))" 2>/dev/null && \
   ! node -e "JSON.parse(require('fs').readFileSync('manifest.json'))" 2>/dev/null; then
  echo "Warning: could not validate manifest.json (no python3/node found)" >&2
fi

echo "Building chrome.zip..."
rm -f chrome.zip
zip -r chrome.zip "${FILES[@]}"

echo "Building firefox.zip..."
rm -f firefox.zip
zip -r firefox.zip "${FILES[@]}"

REQUIRED_PACKAGE_MEMBERS=(
  LICENSE
  hls.html
  hls-core.js
  hls-page.js
  hls-platform.js
  hls-storage.js
  lib/mux.js
  lib/MUX_JS_LICENSE.txt
)

verify_package_members() {
  local archive="$1"
  local member
  for member in "${REQUIRED_PACKAGE_MEMBERS[@]}"; do
    if ! unzip -Z -1 "$archive" | grep -F -x -- "$member" >/dev/null; then
      echo "Error: $archive is missing required package member '$member'" >&2
      return 1
    fi
  done
}

echo "Verifying HLS and license files in both packages..."
verify_package_members chrome.zip
verify_package_members firefox.zip

echo "Done: chrome.zip and firefox.zip"
