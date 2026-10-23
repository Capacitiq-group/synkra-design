#!/bin/bash
# Create/update the runtime-restore GitHub release and upload the runtime snapshot.
# Snapshot = db/custom.db + media/{fonts,elements,stock,audio,models} prebuilt,
# so a reset sandbox can restore the whole library with one download+extract.
set -euo pipefail
cd /home/z/my-project

PAT="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"
REPO="Capacitiq-group/synkra-design"
TAG="runtime-restore-v1"
TARBALL="/tmp/synkra-runtime-restore.tar.gz"
ASSET_NAME="synkra-runtime-restore.tar.gz"

auth=(-H "Authorization: Bearer $PAT" -H "Accept: application/vnd.github+json")

echo "[1/4] Looking for existing release $TAG"
RELEASE_ID=$(curl -s "${auth[@]}" "https://api.github.com/repos/$REPO/releases/tags/$TAG" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','') if isinstance(d,dict) else '')" || true)

if [ -z "$RELEASE_ID" ]; then
  echo "  creating release"
  RELEASE_ID=$(curl -s "${auth[@]}" -X POST "https://api.github.com/repos/$REPO/releases" \
    -d "{\"tag_name\":\"$TAG\",\"name\":\"Runtime restore snapshot\",\"prerelease\":false,\"body\":\"Prebuilt runtime data: full font library (1,984 Google + 40 bundle families), 36k vector elements/stickers, 2,694 stock images, audio, u2netp model, seeded SQLite DB.\\n\\nRestore: see scripts/recover-sandbox.sh (fast path downloads this asset).\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
else
  echo "  release exists (id $RELEASE_ID); deleting old asset if present"
  for AID in $(curl -s "${auth[@]}" "https://api.github.com/repos/$REPO/releases/$RELEASE_ID/assets" | python3 -c "import json,sys; print(' '.join(str(a['id']) for a in json.load(sys.stdin)))"); do
    curl -s "${auth[@]}" -X DELETE "https://api.github.com/repos/$REPO/releases/assets/$AID" -o /dev/null
  done
fi

echo "[2/4] Uploading $ASSET_NAME ($(du -h "$TARBALL" | cut -f1))"
UPLOAD_URL="https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$ASSET_NAME"
curl -s "${auth[@]}" -X POST -H "Content-Type: application/gzip" --data-binary @"$TARBALL" "$UPLOAD_URL" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('  uploaded:', d.get('name'), d.get('size'), d.get('state') or d.get('message'))"

echo "[3/4] Publishing"
curl -s "${auth[@]}" -X PATCH "https://api.github.com/repos/$REPO/releases/$RELEASE_ID" -d '{"draft":false}' -o /dev/null

echo "[4/4] Done. Asset URL:"
curl -s "${auth[@]}" "https://api.github.com/repos/$REPO/releases/$RELEASE_ID" | python3 -c "import json,sys; d=json.load(sys.stdin); print('https://github.com/'+'$REPO'+'/releases/download/'+'$TAG'+'/'+d['assets'][0]['name'])"
