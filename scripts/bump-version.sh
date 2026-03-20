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
sed "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" "$MANIFEST" > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"

# popup.html: vX.Y.Z
sed "s/v$CURRENT/v$NEW/g" "$ROOT/popup.html" > "$ROOT/popup.html.tmp" && mv "$ROOT/popup.html.tmp" "$ROOT/popup.html"

# downloader.js: GDrive Universal Downloader vX.Y.Z
sed "s/v$CURRENT/v$NEW/g" "$ROOT/downloader.js" > "$ROOT/downloader.js.tmp" && mv "$ROOT/downloader.js.tmp" "$ROOT/downloader.js"
# downloader.js: const VERSION = 'X.Y.Z';
sed "s/const VERSION = '$CURRENT'/const VERSION = '$NEW'/" "$ROOT/downloader.js" > "$ROOT/downloader.js.tmp" && mv "$ROOT/downloader.js.tmp" "$ROOT/downloader.js"

echo "  Updated manifest.json"
echo "  Updated popup.html"
echo "  Updated downloader.js"

# ── Add changelog placeholder ─────────────────────────────────────
DATE=$(date +%Y-%m-%d)
# Insert new section before the previous version entry
# Portable way to insert before a line matching a pattern
cat <<EOF > "$ROOT/CHANGELOG.md.tmp"
## [$NEW] - $DATE

### Changed
- Refactored core logic for better modularity and maintainability
- Improved page detection with a centralized selector map
- Enhanced popup with better state restoration and error handling
- Centralized configuration and constants in downloader.js
- Made version bump script more portable

EOF
cat "$ROOT/CHANGELOG.md" >> "$ROOT/CHANGELOG.md.tmp"
mv "$ROOT/CHANGELOG.md.tmp" "$ROOT/CHANGELOG.md"

echo "  Updated CHANGELOG.md"

# ── Git commit + tag ──────────────────────────────────────────────
git -C "$ROOT" add manifest.json popup.html downloader.js detect.js popup.js content-hooks.js scripts/bump-version.sh CHANGELOG.md
git -C "$ROOT" commit -m "chore: bump version to $NEW"
git -C "$ROOT" tag "v$NEW"


echo ""
echo "Done! Version bumped to $NEW and tagged v$NEW"
echo ""
echo "Next steps:"
echo "  1. Edit CHANGELOG.md with actual release notes"
echo "  2. git commit --amend  (to include changelog edits)"
echo "  3. git push && git push origin v$NEW"
