#!/usr/bin/env bash
# Generate placeholder Tauri icons using ImageMagick.
# Replace the SVG source with your actual logo before production release.
#
# Usage:
#   ./scripts/generate-icons.sh
#
# Prerequisites:
#   - ImageMagick (convert command) or inkscape

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ICONS_DIR="$SCRIPT_DIR/../ui/src-tauri/icons"

mkdir -p "$ICONS_DIR"

# Create a minimal SVG placeholder
cat > "$ICONS_DIR/icon.svg" << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="16" fill="#1e1e2e"/>
  <text x="64" y="80" text-anchor="middle" font-size="64" font-family="sans-serif" fill="#89b4fa">🎬</text>
</svg>
EOF

if command -v convert &>/dev/null; then
  echo "Generating icons with ImageMagick..."
  convert "$ICONS_DIR/icon.svg" -resize 32x32   "$ICONS_DIR/32x32.png"
  convert "$ICONS_DIR/icon.svg" -resize 128x128 "$ICONS_DIR/128x128.png"
  convert "$ICONS_DIR/icon.svg" -resize 256x256 "$ICONS_DIR/128x128@2x.png"
  convert "$ICONS_DIR/icon.svg" -resize 256x256 "$ICONS_DIR/icon.ico"
  convert "$ICONS_DIR/icon.svg" -resize 512x512 "$ICONS_DIR/icon.icns"
  echo "✅ Icons generated in $ICONS_DIR"
else
  echo "⚠️  ImageMagick not found. Please install it or manually create icon files."
  echo "   Required files in $ICONS_DIR:"
  echo "   - 32x32.png, 128x128.png, 128x128@2x.png, icon.ico, icon.icns"
fi
