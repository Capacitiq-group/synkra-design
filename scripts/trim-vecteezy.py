#!/usr/bin/env python3
"""Trim media/stock/vecteezy to MAX_PER_CATEGORY files per category (keeping the
lowest IDs = first crawled pages), then rebuild content/vecteezy-manifest.json."""
import json, os, collections

ROOT = '/home/z/my-project'
OUT = os.path.join(ROOT, 'media/stock/vecteezy')
MANIFEST = os.path.join(ROOT, 'content/vecteezy-manifest.json')
MAX_PER_CATEGORY = 200

manifest = json.load(open(MANIFEST))
by_cat = collections.OrderedDict()
for e in manifest:
    by_cat.setdefault(e['category'], []).append(e)

kept, removed_bytes = [], 0
for cat, entries in by_cat.items():
    keep = entries[:MAX_PER_CATEGORY]
    kept.extend(keep)
    for e in entries[MAX_PER_CATEGORY:]:
        p = os.path.join(OUT, os.path.basename(e['file']))
        if os.path.exists(p):
            removed_bytes += os.path.getsize(p)
            os.remove(p)

kept.sort(key=lambda e: e['id'])
json.dump(kept, open(MANIFEST, 'w'), indent=1)
print(f'kept {len(kept)} entries ({sum(len(v) for v in by_cat.values())} before), freed {removed_bytes/1e6:.0f} MB')
