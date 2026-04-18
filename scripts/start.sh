#!/usr/bin/env bash
# ─── AI Video Pipeline — One-click Start Script ───
# Usage: bash scripts/start.sh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

check() {
  local name="$1" cmd="$2" install_hint="$3" required="${4:-true}"
  if command -v "$cmd" &>/dev/null; then
    printf "  ${GREEN}✅ %-20s${NC} %s\n" "$name" "$(command -v "$cmd")"
    return 0
  fi
  if [ "$required" = "true" ]; then
    printf "  ${RED}❌ %-20s${NC} 未找到 — %s\n" "$name" "$install_hint"
    return 1
  else
    printf "  ${YELLOW}⚠️  %-20s${NC} 未找到 — %s\n" "$name" "$install_hint"
    return 0
  fi
}

echo ""
echo "🎬 AI Video Pipeline — 环境检测"
echo "────────────────────────────────"
FAIL=0
check "Node.js (>=20)" "node" "https://nodejs.org/" || FAIL=1
check "FFmpeg"         "ffmpeg" "apt install ffmpeg / brew install ffmpeg" || FAIL=1
check "Python 3"       "python3" "apt install python3 / brew install python3" || FAIL=1

# edge-tts check (Python package)
if python3 -c "import importlib; importlib.import_module('edge_tts')" &>/dev/null || command -v edge-tts &>/dev/null; then
  printf "  ${GREEN}✅ %-20s${NC} installed\n" "edge-tts"
else
  printf "  ${YELLOW}⚠️  %-20s${NC} pip install edge-tts\n" "edge-tts"
fi

echo ""

if [ "$FAIL" -ne 0 ]; then
  echo -e "${RED}请先安装缺失的必要依赖后重试。${NC}"
  exit 1
fi

# ── Install npm dependencies if needed ──
if [ ! -d "node_modules" ]; then
  echo "📦 安装后端依赖..."
  npm install
fi
if [ ! -d "ui/node_modules" ]; then
  echo "📦 安装前端依赖..."
  (cd ui && npm install)
fi
if [ ! -d "browser-shell/node_modules" ]; then
  echo "📦 安装 Electron 依赖..."
  (cd browser-shell && npm install)
fi

# ── Start Electron desktop app (all browser automation runs inside Electron tabs) ──
echo ""
echo "🚀 启动 Electron 桌面应用..."
echo "   所有浏览器自动化在 Electron 内部标签页完成，不会打开外部浏览器。"
echo ""

exec npm run dev:desktop
