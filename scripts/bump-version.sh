#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/manifest.json"

# ── Read current version ──────────────────────────────────────────
CURRENT=$(grep '"version"' "$MANIFEST" | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# ── Compute new version ──────────────────────────────────────────
case "${1:-}" in
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  patch) PATCH=$((PATCH + 1)) ;;
  [0-9]*.[0-9]*.[0-9]*) IFS='.' read -r MAJOR MINOR PATCH <<< "$1" ;;
  *)
    echo "Usage: $0 {major|minor|patch|X.Y.Z}"
    echo ""
    echo "Current version: $CURRENT"
    exit 1
    ;;
esac
NEW="$MAJOR.$MINOR.$PATCH"

if [ "$NEW" = "$CURRENT" ]; then
  echo "Version is already $CURRENT"
  exit 1
fi

echo "Bumping $CURRENT → $NEW"

# ── Update version strings ────────────────────────────────────────
# manifest.json: "version": "X.Y.Z"
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" "$MANIFEST"

# popup.html: vX.Y.Z
sed -i '' "s/v$CURRENT/v$NEW/g" "$ROOT/popup.html"

# downloader.js: vX.Y.Z
sed -i '' "s/v$CURRENT/v$NEW/g" "$ROOT/downloader.js"

echo "  Updated manifest.json"
echo "  Updated popup.html"
echo "  Updated downloader.js"

# ── Add changelog placeholder ─────────────────────────────────────
DATE=$(date +%Y-%m-%d)
# Insert new section before the previous version entry
sed -i '' "/^## \[$CURRENT\]/i\\
## [$NEW] - $DATE\\
\\
### Changed\\
- (describe changes here)\\
" "$ROOT/CHANGELOG.md"

echo "  Updated CHANGELOG.md (edit the placeholder before pushing)"

# ── Git commit + tag ──────────────────────────────────────────────
git -C "$ROOT" add manifest.json popup.html downloader.js CHANGELOG.md
git -C "$ROOT" commit -m "chore: bump version to $NEW"
git -C "$ROOT" tag "v$NEW"

echo ""
echo "Done! Version bumped to $NEW and tagged v$NEW"
echo ""
echo "Next steps:"
echo "  1. Edit CHANGELOG.md with actual release notes"
echo "  2. git commit --amend  (to include changelog edits)"
echo "  3. git push && git push origin v$NEW"
