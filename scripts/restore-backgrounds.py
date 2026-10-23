#!/usr/bin/env python3
"""Restore Backgrounds.zip → media/stock/synkra/ using the manifest original_name mapping."""
import json, os, shutil

ROOT = '/home/z/my-project'
SRC = '/tmp/bg-zip'
OUT = os.path.join(ROOT, 'media/stock/synkra')
manifest = json.load(open(os.path.join(ROOT, 'content/synkra-backgrounds-manifest.json')))

os.makedirs(OUT, exist_ok=True)
# index source files by original_name
src_files = {}
for dirpath, _dirs, files in os.walk(SRC):
    for f in files:
        src_files[f] = os.path.join(dirpath, f)

copied, missing = 0, []
for entry in manifest:
    orig = entry['original_name']
    dst = os.path.join(OUT, os.path.basename(entry['file']))
    if os.path.exists(dst):
        copied += 1
        continue
    src = src_files.get(orig)
    if not src:
        missing.append(orig)
        continue
    shutil.copy2(src, dst)
    copied += 1

total = len([f for f in os.listdir(OUT) if not f.startswith('.')])
print(f'copied/verified {copied}/{len(manifest)}; files on disk: {total}; missing: {len(missing)}')
if missing:
    print(missing[:5])
