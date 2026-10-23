#!/bin/bash
# SYNKRA Design — sandbox recovery script.
#
# The sandbox periodically resets the working tree to a stale commit and wipes
# runtime data (db/, media/, repos/, node_modules). This script restores a fully
# working platform.
#
#   FAST PATH  — download the prebuilt runtime snapshot (GitHub release
#                runtime-restore-v1) and extract db/ + media/. ~2-3 minutes.
#   SLOW PATH  — rebuild everything from source (Doory data, content packs,
#                seed, model download). Used when the snapshot is unreachable.
#
# Usage: bash /home/z/my-project/scripts/recover-sandbox.sh [--force-slow]
set -euo pipefail
cd /home/z/my-project

PAT="[REDACTED:github_token]"
REPO="https://${PAT}@github.com/Capacitiq-group/synkra-design.git"
GH_API="https://api.github.com/repos/Capacitiq-group/synkra-design"
TAG="runtime-restore-v1"

echo "[1/8] Restoring source from GitHub (origin/main)"
git fetch "$REPO" main 2>&1 | tail -1 || git fetch origin main 2>&1 | tail -1
git reset --hard FETCH_HEAD

echo "[2/8] Installing dependencies"
if [ ! -d node_modules ] || [ "$(ls node_modules 2>/dev/null | wc -l)" -lt 100 ]; then
  bun install
fi
bunx prisma generate 2>&1 | tail -1

echo "[3/8] Restoring runtime data (db + media)"
restored=0
if [ "${1:-}" != "--force-slow" ]; then
  ASSET_ID=$(curl -sf -H "Authorization: Bearer $PAT" "$GH_API/releases/tags/$TAG" \
    | python3 -c "import json,sys; a=json.load(sys.stdin).get('assets',[]); print(a[0]['id'] if a else '')" || true)
  if [ -n "$ASSET_ID" ] && curl -sfL --retry 3 \
      -H "Authorization: Bearer $PAT" -H "Accept: application/octet-stream" \
      -o /tmp/runtime-restore.tar.gz "$GH_API/releases/assets/$ASSET_ID"; then
    echo "  downloaded $(du -h /tmp/runtime-restore.tar.gz | cut -f1), extracting"
    tar -xzf /tmp/runtime-restore.tar.gz
    rm -f /tmp/runtime-restore.tar.gz
    echo "  restored: db/custom.db + media/{fonts,elements,stock,audio,models}"
    restored=1
  fi
fi
if [ "$restored" = "0" ]; then
  echo "  snapshot unreachable or disabled — full rebuild"
  echo "[4/8] Restoring Doory reference data (repos/doory/backend/data)"
  if [ ! -d repos/doory/backend/data ]; then
    rm -rf repos/doory
    git clone --depth 1 --filter=blob:none --sparse https://github.com/shaongitbd/doory.git repos/doory
    (cd repos/doory && git sparse-checkout set backend/data)
  fi

  echo "[5/8] Installing content pack dependencies"
  if [ ! -d content/packs/node_modules ] || [ "$(ls content/packs/node_modules 2>/dev/null | wc -l)" -lt 5 ]; then
    (cd content/packs && bun install)
  fi

  echo "[6/8] Creating database and seeding content"
  bunx prisma db push --accept-data-loss
  SEED_ALL_FONTS=1 bunx tsx scripts/seed.ts 2>&1 | tail -6

  echo "[7/8] Background-removal model"
  mkdir -p media/models
  [ -f media/models/u2netp.onnx ] || curl -sL -o media/models/u2netp.onnx \
    https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
else
  echo "[4/8] skipped (snapshot restore)"
  echo "[5/8] skipped (snapshot restore)"
  echo "[6/8] skipped (snapshot restore)"
  echo "[7/8] skipped (snapshot restore)"
fi

echo "[8/8] Ensuring sandbox test user + starting services"
bunx tsx scripts/ensure-test-user.ts
bunx prisma db push --accept-data-loss 2>&1 | tail -1 || true

pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill -f "mini-services/realtime" 2>/dev/null || true
sleep 2
(cd mini-services/realtime && [ -d node_modules ] || bun install; nohup bun run index.ts > /tmp/realtime.log 2>&1 &)
(nohup bun run dev > /dev/null 2>&1 &)
(nohup bash scripts/watchdog.sh > /dev/null 2>&1 &)
sleep 14

curl -s -o /dev/null -w "app (3000): %{http_code}\n" http://localhost:3000/
curl -s "http://localhost:3000/api/v1/fonts?page=1&page_size=1" | head -c 80; echo
echo "Done. Test login: sandbox@synkra.test / SandboxTest2026!"
