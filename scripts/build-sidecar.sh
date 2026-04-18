#!/usr/bin/env bash
# ── Build the Node.js backend as a standalone binary for Electron sidecar ──
#
# This script bundles src/server.ts into a standalone executable using
# the `bun build --compile` command, or falls back to `pkg` if bun is
# not available. The output binary is placed in browser-shell/ resources
# so it is bundled with the Electron desktop app.
#
# It also installs Playwright Chromium and copies the browser binary into
# browser-shell/ so it is bundled with the desktop app.
#
# Usage:
#   ./scripts/build-sidecar.sh
#
# Prerequisites:
#   - bun (recommended) or @vercel/pkg globally installed
#   - Node.js 20+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/browser-shell/resources"

mkdir -p "$OUTPUT_DIR"

BINARY_NAME="ai-video-server"

# Windows executables need .exe suffix
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
  BINARY_NAME="${BINARY_NAME}.exe"
fi

echo "Building sidecar binary..."
echo "Output: $OUTPUT_DIR/$BINARY_NAME"

cd "$ROOT_DIR"

# ── Strategy 1: Use bun if available ──
if command -v bun &>/dev/null; then
  echo "Using bun to compile standalone binary..."
  bun build src/server.ts --compile --outfile "$OUTPUT_DIR/$BINARY_NAME"
  echo "✅ Sidecar built with bun: $BINARY_NAME"
# ── Strategy 2: Use esbuild + pkg ──
elif command -v npx &>/dev/null; then
  echo "Using esbuild + pkg..."
  
  # Bundle TypeScript into a single JS file
  npx esbuild src/server.ts --bundle --platform=node --target=node20 \
    --outfile="$OUTPUT_DIR/server.cjs" --format=cjs \
    --external:playwright --external:@google/genai

  # Package into standalone binary
  npx -y @yao-pkg/pkg "$OUTPUT_DIR/server.cjs" \
    --target node20 \
    --output "$OUTPUT_DIR/$BINARY_NAME"

  rm -f "$OUTPUT_DIR/server.cjs"
  echo "✅ Sidecar built with pkg: $BINARY_NAME"
else
  echo "❌ Neither bun nor npx found. Cannot build sidecar binary."
  exit 1
fi

# ── Bundle Playwright Chromium ──
echo ""
echo "Installing Playwright Chromium for bundling..."
npx playwright install chromium

# Locate the Playwright browser directory
PW_BROWSERS="${PLAYWRIGHT_BROWSERS_PATH:-${HOME}/.cache/ms-playwright}"
CHROMIUM_SRC=$(find "$PW_BROWSERS" -maxdepth 1 -name 'chromium-*' -type d | sort -V | tail -1)

if [[ -n "$CHROMIUM_SRC" && -d "$CHROMIUM_SRC" ]]; then
  CHROMIUM_BASENAME="$(basename "$CHROMIUM_SRC")"
  BROWSERS_DIR="$OUTPUT_DIR/browsers"
  rm -rf "$BROWSERS_DIR"
  mkdir -p "$BROWSERS_DIR"
  cp -r "$CHROMIUM_SRC" "$BROWSERS_DIR/$CHROMIUM_BASENAME"
  echo "✅ Chromium bundled into: $BROWSERS_DIR/$CHROMIUM_BASENAME"
else
  echo "⚠️  Could not locate Playwright Chromium browsers directory."
  echo "   Chromium will not be bundled — users will need to install it manually."
fi
