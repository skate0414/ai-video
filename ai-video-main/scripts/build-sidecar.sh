#!/usr/bin/env bash
# ── Build the Node.js backend as a standalone binary for Tauri sidecar ──
#
# This script bundles src/server.ts into a standalone executable using
# the `bun build --compile` command, or falls back to `pkg` if bun is
# not available. The output binary is placed in ui/src-tauri/binaries/
# with platform-specific naming required by Tauri.
#
# Usage:
#   ./scripts/build-sidecar.sh
#   ./scripts/build-sidecar.sh --target x86_64-unknown-linux-gnu
#
# Prerequisites:
#   - bun (recommended) or @vercel/pkg globally installed
#   - Node.js 20+

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/ui/src-tauri/binaries"

mkdir -p "$OUTPUT_DIR"

# ── Detect host target triple ──
detect_target() {
  local arch
  local os
  arch="$(uname -m)"
  os="$(uname -s)"

  case "$arch" in
    x86_64|amd64) arch="x86_64" ;;
    aarch64|arm64) arch="aarch64" ;;
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
  esac

  case "$os" in
    Linux)  echo "${arch}-unknown-linux-gnu" ;;
    Darwin) echo "${arch}-apple-darwin" ;;
    MINGW*|MSYS*|CYGWIN*) echo "${arch}-pc-windows-msvc" ;;
    *) echo "Unsupported OS: $os" >&2; exit 1 ;;
  esac
}

TARGET="${1:-$(detect_target)}"
BINARY_NAME="ai-video-server-${TARGET}"

# Windows executables need .exe suffix
if [[ "$TARGET" == *"windows"* ]]; then
  BINARY_NAME="${BINARY_NAME}.exe"
fi

echo "Building sidecar for target: $TARGET"
echo "Output: $OUTPUT_DIR/$BINARY_NAME"

cd "$ROOT_DIR"

# ── Strategy 1: Use bun if available ──
if command -v bun &>/dev/null; then
  echo "Using bun to compile standalone binary..."
  bun build src/server.ts --compile --outfile "$OUTPUT_DIR/$BINARY_NAME"
  echo "✅ Sidecar built with bun: $BINARY_NAME"
  exit 0
fi

# ── Strategy 2: Use esbuild + pkg ──
if command -v npx &>/dev/null; then
  echo "Using esbuild + pkg..."
  
  # Bundle TypeScript into a single JS file
  npx esbuild src/server.ts --bundle --platform=node --target=node20 \
    --outfile="$OUTPUT_DIR/server.cjs" --format=cjs \
    --external:playwright --external:@google/genai

  # Package into standalone binary
  npx -y @yao-pkg/pkg "$OUTPUT_DIR/server.cjs" \
    --target node20-${TARGET%%-*} \
    --output "$OUTPUT_DIR/$BINARY_NAME"

  rm -f "$OUTPUT_DIR/server.cjs"
  echo "✅ Sidecar built with pkg: $BINARY_NAME"
  exit 0
fi

echo "❌ Neither bun nor npx found. Cannot build sidecar binary."
exit 1
