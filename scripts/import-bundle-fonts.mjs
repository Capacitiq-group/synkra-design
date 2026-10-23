/**
 * Bundle fonts importer (upload/Fonts.zip — 39 nested font zips sourced from 1001fonts.com).
 *
 * Extracts TTF/OTF files into media/fonts/bundle/<slug>/ and writes
 * content/bundle-fonts-manifest.json (committed) which scripts/seed.ts reads to register
 * every family as a first-class FontFamily (source 'bundle') in the font picker.
 */
import { mkdirSync, rmSync, readdirSync, writeFileSync, copyFileSync, statSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'

const ROOT = '/home/z/my-project'
const ZIP = path.join(ROOT, 'upload/Fonts.zip')
const TMP = '/tmp/bundlefonts'
const OUT = path.join(ROOT, 'media/fonts/bundle')
const MANIFEST = path.join(ROOT, 'content/bundle-fonts-manifest.json')

rmSync(TMP, { recursive: true, force: true })
mkdirSync(`${TMP}/zips`, { recursive: true })
execSync(`unzip -o -q "${ZIP}" -d ${TMP}/zips`)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const titleize = (slug) => slug.replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const entries = []
mkdirSync(`${TMP}/unzipped`, { recursive: true })
const zipFiles = readdirSync(`${TMP}/zips`).filter((f) => f.endsWith('.zip')).sort()
for (const zip of zipFiles) {
  const slug = zip.replace(/\.zip$/i, '').replace(/\s*\(\d+\)$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const dir = `${TMP}/unzipped/${slug}`
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  execSync(`unzip -o -q "${TMP}/zips/${zip}" -d "${dir}"`)
  const fonts = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ttf|otf)$/i.test(e.name)) fonts.push(p)
    }
  }
  walk(dir)
  if (fonts.length === 0) continue
  // Use the actual internal font file name as the family name when it is descriptive,
  // otherwise fall back to the zip slug.
  const first = fonts[0]
  const internal = path.basename(first).replace(/\.(ttf|otf)$/i, '').trim()
  const family = internal.length >= 3 ? internal : titleize(slug)
  const outDir = path.join(OUT, slug)
  mkdirSync(outDir, { recursive: true })
  let index = 0
  for (const font of fonts) {
    index += 1
    const ext = path.extname(font).toLowerCase()
    const fileName = fonts.length === 1 ? `regular${ext}` : `${path.basename(font).toLowerCase()}`
    copyFileSync(font, path.join(outDir, fileName))
    entries.push({
      slug: fonts.length === 1 ? slug : `${slug}-${index}`,
      family,
      file: `fonts/bundle/${slug}/${fileName}`,
      format: ext === '.otf' ? 'otf' : 'ttf',
      bytes: statSync(path.join(outDir, fileName)).size,
      weight: 400,
      style: /italic/i.test(fileName) ? 'italic' : 'normal',
      license: 'Freeware (bundled via 1001fonts.com)',
      sourceRef: '1001fonts.com',
    })
  }
  console.log(`[bundle-fonts] ${family}: ${fonts.length} file(s)`)
}

writeFileSync(MANIFEST, JSON.stringify(entries, null, 1))
console.log(`[bundle-fonts] total ${entries.length} font files from ${zipFiles.length} archives`)
