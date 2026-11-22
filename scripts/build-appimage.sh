#!/usr/bin/env bash
# Reproducible AppImage build. Requires Node 22, python3, and network
# access so electron-builder can fetch Electron and appimagetool.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f package-lock.json ]]; then
  echo "package-lock.json is missing. Run npm install and commit the lockfile." >&2
  exit 1
fi

python3 scripts/render-icon.py
npm ci
npm test
npm run build
npx electron-builder --linux AppImage --publish never

echo
echo "AppImage:"
find release -maxdepth 1 -name 'Rascal-*.AppImage' -printf '  %p\n'
