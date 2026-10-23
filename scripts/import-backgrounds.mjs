/**
 * Backgrounds library importer.
 *
 * Unpacks upload/Backgrounds.zip into media/stock/synkra/ and records every image in
 * content/synkra-backgrounds-manifest.json (committed) so the seed can rebuild the catalogue.
 * These surface in the editor under Backgrounds -> Stock -> "Synkra Library".
 */
import { mkdirSync, writeFileSync, createWriteStream } from 'fs'
import { execSync } from 'child_process'
import path from 'path'

const ROOT = '/home/z/my-project'
const ZIP = path.join(ROOT, 'upload/Backgrounds.zip')
const OUT = path.join(ROOT, 'media/stock/synkra')
const MANIFEST = path.join(ROOT, 'content/synkra-backgrounds-manifest.json')

mkdirSync(OUT, { recursive: true })
execSync(`unzip -o -q -j "${ZIP}" -d "${OUT}"`, { stdio: 'inherit' })

// Clean names: hash names -> background-NN.ext (keep original hash as subtitle)
const { readdirSync, renameSync, statSync } = await import('fs')
const files = readdirSync(OUT).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()
let index = 0
const entries = files.map((file) => {
  const ext = path.extname(file).toLowerCase()
  index += 1
  const nice = `background-${String(index).padStart(3, '0')}${ext}`
  if (nice !== file) renameSync(path.join(OUT, file), path.join(OUT, nice))
  const bytes = statSync(path.join(OUT, nice)).size
  return {
    id: `synkra-bg-${String(index).padStart(3, '0')}`,
    provider: 'synkra',
    category: 'backgrounds',
    title: nice.replace(ext, '').replaceAll('-', ' '),
    file: `synkra/${nice}`,
    original_name: file,
    source_url: 'https://www.vecteezy.com/',
    license: 'Synkra Design library (bundled asset)',
    author: 'Synkra Design',
    bytes,
  }
})

writeFileSync(MANIFEST, JSON.stringify(entries, null, 1))
console.log(`[backgrounds] imported ${entries.length} files (${(entries.reduce((s, e) => s + e.bytes, 0) / 1e6).toFixed(1)} MB)`)
