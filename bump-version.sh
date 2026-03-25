#!/usr/bin/env bash
# Usage: ./bump-version.sh <new-version>
# Example: ./bump-version.sh 3.5.5
set -e

NEW="$1"
if [[ -z "$NEW" ]]; then
  echo "Usage: $0 <new-version>  (e.g. 3.6.0)"
  exit 1
fi

# Validate semver-ish format
if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be in x.y.z format"
  exit 1
fi

# Detect current version from manifest.json
OLD=$(grep '"version"' manifest.json | grep -o '[0-9]*\.[0-9]*\.[0-9]*' | head -1)
echo "Bumping $OLD → $NEW"

# Update all version strings
sed -i '' "s/$OLD/$NEW/g" \
  manifest.json \
  manifest_firefox.json \
  popup.html \
  downloader.js

echo "✅ Updated: manifest.json, manifest_firefox.json, popup.html, downloader.js"

# Rebuild zips
bash build.sh

# Commit
git add manifest.json manifest_firefox.json popup.html downloader.js
git commit -m "chore: bump version to $NEW

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

# Tag and push
git tag "v$NEW"
git push origin "$(git branch --show-current)"
git push origin "v$NEW"

echo ""
echo "✅ Tagged and pushed v$NEW"
echo "   Create a GitHub release at:"
echo "   https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/new?tag=v$NEW"
echo ""
echo "   Or run:"
echo "   gh release create v$NEW chrome.zip firefox.zip --title \"v$NEW\" --target $(git branch --show-current)"
