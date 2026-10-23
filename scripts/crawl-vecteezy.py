#!/usr/bin/env python3
"""Crawl Vecteezy free-vector category pages, download preview images into
media/stock/vecteezy/, and regenerate content/vecteezy-manifest.json.

Resume-safe: skips files that already exist on disk.
"""
import json, os, re, sys, time, urllib.request, urllib.error, concurrent.futures

ROOT = '/home/z/my-project'
OUT = os.path.join(ROOT, 'media/stock/vecteezy')
MANIFEST = os.path.join(ROOT, 'content/vecteezy-manifest.json')
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'}
CATEGORIES = ['icons', 'backgrounds', 'elements', 'patterns', 'banners', 'textures',
              'illustrations', 'infographics', 'logo', 'floral', 'abstract', 'social-media']
PAGES_PER_CATEGORY = int(sys.argv[1]) if len(sys.argv) > 1 else 8
WORKERS = 16

PREVIEW_RE = re.compile(r'https://static\.vecteezy\.com/system/resources/previews/(\d+)/(\d+)/(\d+)/non_2x/([A-Za-z0-9\-_]+)\.(?:jpg|png)')

os.makedirs(OUT, exist_ok=True)

def fetch(url, timeout=30, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if binary else data.decode('utf-8', 'ignore')

URLS_CACHE = '/tmp/vt-urls.json'

def collect_urls():
    if os.path.exists(URLS_CACHE):
        raw = json.load(open(URLS_CACHE))
        return {tuple(k.split('|')): tuple(v) for k, v in raw.items()}
    seen = {}  # (a,b,c) -> (category, slug, ext)
    for cat in CATEGORIES:
        got_before = len(seen)
        for page in range(1, PAGES_PER_CATEGORY + 1):
            url = f'https://www.vecteezy.com/free-vector/{cat}' + (f'?page={page}' if page > 1 else '')
            try:
                html = fetch(url)
            except Exception as e:
                print(f'  page fail {cat}?page={page}: {e}')
                time.sleep(2)
                continue
            found = 0
            for m in PREVIEW_RE.finditer(html):
                a, b, c, slug = m.group(1), m.group(2), m.group(3), m.group(4)
                key = (a, b, c)
                if key not in seen:
                    seen[key] = (cat, slug, m.group(0).rsplit('.', 1)[1])
                    found += 1
            if found == 0:
                break  # no more results on later pages
        print(f'{cat}: +{len(seen)-got_before}', flush=True)
    json.dump({f'{k[0]}|{k[1]}|{k[2]}': list(v) for k, v in seen.items()}, open(URLS_CACHE, 'w'))
    return seen

def download(item):
    (a, b, c), (cat, slug, ext) = item
    fname = f'{cat}-{a}-{b}-{c}.{ext}'
    dest = os.path.join(OUT, fname)
    if os.path.exists(dest) and os.path.getsize(dest) > 2000:
        return ('skip', fname)
    base = f'https://static.vecteezy.com/system/resources/previews/{a}/{b}/{c}'
    for variant in ('large_2x', 'non_2x'):
        try:
            data = fetch(f'{base}/{variant}/{slug}.{ext}', timeout=40, binary=True)
            if len(data) > 2000:
                with open(dest, 'wb') as f:
                    f.write(data)
                return ('ok', fname)
        except Exception:
            continue
    return ('fail', fname)

def main():
    print('collecting preview URLs...')
    seen = collect_urls()
    print(f'total unique previews: {len(seen)}')
    stats = {'ok': 0, 'skip': 0, 'fail': 0}
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for i, (status, fname) in enumerate(ex.map(download, seen.items()), 1):
            stats[status] += 1
            if status == 'fail':
                failures.append(fname)
            if i % 100 == 0:
                print(f'  {i}/{len(seen)} ok={stats["ok"]} skip={stats["skip"]} fail={stats["fail"]}')
    print(f'download done: {stats}')

    # rebuild manifest from successfully downloaded files
    entries = []
    for (a, b, c), (cat, slug, ext) in sorted(seen.items()):
        fname = f'{cat}-{a}-{b}-{c}.{ext}'
        if not os.path.exists(os.path.join(OUT, fname)):
            continue
        title = slug.replace('-', ' ')
        entries.append({
            'id': f'vecteezy-{cat}-{a}-{b}-{c}',
            'provider': 'vecteezy',
            'category': 'backgrounds' if cat == 'backgrounds' else cat,
            'title': title,
            'file': f'vecteezy/{fname}',
            'source_url': f'https://www.vecteezy.com/free-vector/{cat}',
            'license': 'Vecteezy Content License (free, attribution required)',
            'author': 'Vecteezy contributors',
        })
    json.dump(entries, open(MANIFEST, 'w'), indent=1)
    print(f'manifest: {len(entries)} entries -> {MANIFEST}')
    if failures:
        print(f'{len(failures)} failed downloads (sample): {failures[:5]}')

if __name__ == '__main__':
    main()
