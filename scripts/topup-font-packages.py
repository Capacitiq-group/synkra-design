#!/usr/bin/env python3
"""Verify missing fontsource packages exist on npm, add them to content/packs/package.json."""
import json, urllib.request, concurrent.futures, sys

PACKS = '/home/z/my-project/content/packs/package.json'
FONTS = '/home/z/my-project/content/fontsource-fonts.json'

def exists(pkg):
    try:
        req = urllib.request.Request(f'https://registry.npmjs.org/{pkg}', method='GET')
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status == 200
    except Exception:
        return False

def main():
    pkg = json.load(open(PACKS))
    deps = pkg['dependencies']
    statics = {d.split('/', 1)[1] for d in deps if d.startswith('@fontsource/')}
    variables = {d.split('/', 1)[1] for d in deps if d.startswith('@fontsource-variable/')}
    fonts = json.load(open(FONTS))
    by_id = {f['id']: f for f in fonts}
    missing = set(by_id) - statics - variables
    print(f'{len(missing)} families missing from package.json')

    checks = []
    for mid in sorted(missing):
        f = by_id[mid]
        if f.get('variable'):
            checks.append((mid, f'@fontsource-variable/{mid}'))
        checks.append((mid, f'@fontsource/{mid}'))

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        results = dict(zip([c[1] for c in checks], ex.map(exists, [c[1] for c in checks])))

    added = []
    skipped = []
    for mid, npm_name in checks:
        if results.get(npm_name) and npm_name not in deps:
            deps[npm_name] = '^5.2.5'
            added.append(npm_name)
        elif not results.get(npm_name):
            skipped.append(npm_name)

    deps = dict(sorted(deps.items()))
    pkg['dependencies'] = deps
    json.dump(pkg, open(PACKS, 'w'), indent=2)
    print(f'added {len(added)} packages')
    if skipped:
        print(f'skipped (not on npm): {skipped}')

if __name__ == '__main__':
    main()
