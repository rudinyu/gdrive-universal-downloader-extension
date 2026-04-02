#!/usr/bin/env bash
# Usage: ./bump-version.sh <new-version> ["release title"] ["release notes"]
# Example: ./bump-version.sh 3.6.0
# Example: ./bump-version.sh 3.6.0 "Fix image detection" "- Fixed foo\n- Fixed bar"
set -euo pipefail

NEW="$1"
TITLE="${2:-v$NEW}"
NOTES="${3:-}"

if [[ -z "$NEW" ]]; then
  echo "Usage: $0 <new-version> [\"release title\"] [\"release notes\"]"
  exit 1
fi

# Validate semver-ish format
if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be in x.y.z format"
  exit 1
fi

TAG="v$NEW"
BRANCH="$(git branch --show-current)"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

# Detect current version from manifest.json
OLD=$(grep '"version"' manifest.json | grep -o '[0-9]*\.[0-9]*\.[0-9]*' | head -1)
echo "Bumping $OLD → $NEW"

# Update all version strings
# Use | as delimiter so version numbers containing dots never break the pattern
sed -i '' "s|$OLD|$NEW|g" \
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
git tag "$TAG"
git push origin "$BRANCH"
git push origin "$TAG"

echo "✅ Tagged and pushed $TAG"

# ── GitHub Release (create or update) ────────────────────────────────────────
# gh release create fails if a release for this tag already exists
# (GitHub sometimes auto-creates a draft). Use create, and if it conflicts
# fall back to edit + re-upload.

release_notes="${NOTES:-"Release $TAG"}"

if gh release create "$TAG" chrome.zip firefox.zip \
     --title "$TITLE" \
     --notes "$release_notes" \
     --target "$BRANCH" 2>/dev/null; then
  echo "✅ GitHub release created: https://github.com/$REPO/releases/tag/$TAG"
else
  echo "⚠️  Release already exists — updating..."
  gh release edit "$TAG" --title "$TITLE" --notes "$release_notes"
  gh release upload "$TAG" chrome.zip firefox.zip --clobber
  echo "✅ GitHub release updated: https://github.com/$REPO/releases/tag/$TAG"
fi
