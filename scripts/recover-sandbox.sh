#!/bin/bash
# SYNKRA Design — sandbox recovery script.
# The sandbox periodically resets the working tree to a stale initial commit and
# kills all processes. This script restores everything from the GitHub source of
# truth and rebuilds runtime data from the upstream Doory repo.
#
# Usage: bash /home/z/my-project/scripts/recover-sandbox.sh
set -euo pipefail
cd /home/z/my-project

PAT="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"
REPO="https://${PAT}@github.com/Capacitiq-group/synkra-design.git"

echo "[1/7] Restoring source from GitHub (origin/main)"
git fetch "$REPO" main 2>&1 | tail -1
git reset --hard FETCH_HEAD

echo "[2/7] Installing dependencies"
[ -d node_modules ] && [ "$(ls node_modules | wc -l)" -gt 100 ] || bun install

echo "[3/7] Restoring Doory reference data (repos/doory/backend/data)"
if [ ! -d repos/doory/backend/data ]; then
  rm -rf repos/doory
  git clone --depth 1 --filter=blob:none --sparse https://github.com/shaongitbd/doory.git repos/doory
  (cd repos/doory && git sparse-checkout set backend/data)
fi

echo "[4/7] Installing content pack dependencies"
if [ ! -d content/packs/node_modules ] || [ "$(ls content/packs/node_modules | wc -l)" -lt 5 ]; then
  (cd content/packs && bun install)
fi

echo "[5/7] Creating database"
bunx prisma generate
bunx prisma db push --accept-data-loss

echo "[6/7] Seeding content (templates, audio, fonts, elements)"
if [ ! -f media/audio/index.json ] || [ "$(ls media/elements 2>/dev/null | wc -l)" -lt 25 ]; then
  bunx tsx scripts/seed.ts
fi

echo "[7/7] Background-removal model"
mkdir -p media/models
if [ ! -f media/models/u2netp.onnx ]; then
  curl -sL -o media/models/u2netp.onnx \
    https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
fi
sha256sum media/models/u2netp.onnx
# Expected: 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8 (4574861 bytes)

echo "Starting services"
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "mini-services/realtime" 2>/dev/null || true
sleep 2
(cd mini-services/realtime && [ -d node_modules ] || bun install; nohup bun run index.ts > /tmp/realtime.log 2>&1 &)
(nohup bun run dev > /dev/null 2>&1 &)
sleep 14

curl -s -o /dev/null -w "app (3000): %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "gateway (81): %{http_code}\n" http://localhost:81/
curl -s -o /dev/null -w "realtime (3010): %{http_code}\n" "http://localhost:3010/" --max-time 3 || true
echo "Recovery complete. Verify in browser: signup -> Home dashboard -> Design Studio."
