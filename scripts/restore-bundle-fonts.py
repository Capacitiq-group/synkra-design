#!/usr/bin/env python3
"""Restore the bundle font library (Fonts.zip → media/fonts/bundle/) and rebuild
content/bundle-fonts-manifest.json with accurate metadata read via fontTools."""
import json, os, shutil, subprocess
from fontTools.ttLib import TTFont

ROOT = '/home/z/my-project'
SRC = '/tmp/fonts-zip/extracted'
OUT = os.path.join(ROOT, 'media/fonts/bundle')
MANIFEST = os.path.join(ROOT, 'content/bundle-fonts-manifest.json')

def slugify_zip(name):
    s = name.lower().strip()
    s = s.replace(' (1)', '')
    s = s.replace('_', '-').replace(' ', '-')
    while '--' in s:
        s = s.replace('--', '-')
    return s.strip('-')

entries = []
for zipname in sorted(os.listdir(SRC)):
    srcdir = os.path.join(SRC, zipname)
    if not os.path.isdir(srcdir):
        continue
    slug = slugify_zip(zipname)
    for fname in sorted(os.listdir(srcdir)):
        if not fname.lower().endswith(('.ttf', '.otf')):
            continue
        srcfile = os.path.join(srcdir, fname)
        outdir = os.path.join(OUT, slug)
        os.makedirs(outdir, exist_ok=True)
        # avoid clobbering distinct files with same name; keep original filename
        dstfile = os.path.join(outdir, fname)
        shutil.copy2(srcfile, dstfile)
        # read metadata
        family, weight, style = slug, 400, 'normal'
        try:
            font = TTFont(srcfile, fontNumber=0, lazy=True)
            name_table = font['name']
            rec = (name_table.getDebugName(16) or name_table.getDebugName(1) or slug).strip()
            family = rec
            if 'OS/2' in font:
                weight = int(font['OS/2'].usWeightClass) or 400
            is_italic = False
            if 'OS/2' in font:
                is_italic = bool(font['OS/2'].fsSelection & 1)
            if not is_italic and 'head' in font:
                is_italic = bool(font['head'].macStyle & 2)
            if is_italic:
                style = 'italic'
            font.close()
        except Exception as e:
            print(f'  warn: metadata fail {fname}: {e}')
        fmt = 'otf' if fname.lower().endswith('.otf') else 'ttf'
        entries.append({
            'slug': slug,
            'family': family,
            'file': f'fonts/bundle/{slug}/{fname}',
            'format': fmt,
            'bytes': os.path.getsize(dstfile),
            'weight': weight,
            'style': style,
            'license': 'Freeware (bundled via 1001fonts.com)',
            'sourceRef': '1001fonts.com',
        })
        print(f'{family:28s} w{weight} {style:6s} {fmt} {fname}')

json.dump(entries, open(MANIFEST, 'w'), indent=1)
print(f'\n{len(entries)} font files -> {MANIFEST}')
fams = sorted({e["family"] for e in entries})
print(f'{len(fams)} families: {fams}')
