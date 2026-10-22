/**
 * Unpacks the uploaded SVG libraries into content/generated-elements/ where the seeder
 * picks them up as element packs:
 *  - svg-alphabet-library-master.zip -> alphabet-library/<style>/<style>-<category>-<char>.svg  (35 x 79 = 2,765)
 *  - ALL-FONTS-svgs-master.zip       -> font-letters/<font>/<char>.svg                          (~979)
 * Both land in git so resets can re-seed without re-uploading.
 */
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync, renameSync, statSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'

const ROOT = '/home/z/my-project'
const UPLOAD = path.join(ROOT, 'upload')
const TMP = '/tmp/svgunpack'
const GEN = path.join(ROOT, 'content/generated-elements')

// ---------------------------------------------------------------- alphabet
const ALPHA_OUT = path.join(GEN, 'alphabet-library')
rmSync(ALPHA_OUT, { recursive: true, force: true })
mkdirSync(ALPHA_OUT, { recursive: true })
rmSync(`${TMP}/alpha`, { recursive: true, force: true })
mkdirSync(`${TMP}/alpha`, { recursive: true })
execSync(`unzip -o -q "${UPLOAD}/svg-alphabet-library-master.zip" "*.zip" -d ${TMP}/alpha`, { stdio: 'inherit' })
const styleZips = readdirSync(TMP + '/alpha').filter((f) => f.endsWith('.zip')).sort()
let alphabetCount = 0
for (const zip of styleZips) {
  const dir = `${TMP}/alpha/${zip.replace(/\.zip$/, '')}`
  rmSync(dir, { recursive: true, force: true })
  execSync(`unzip -o -q "${TMP}/alpha/${zip}" -d "${dir}"`)
  // nested layout: <style>/uppercase/*.svg etc.
  const inner = readdirSync(dir).find((e) => existsSync(path.join(dir, e, 'uppercase')))
  const base = inner ? path.join(dir, inner) : dir
  for (const category of ['uppercase', 'lowercase', 'numbers', 'punctuation']) {
    const src = path.join(base, category)
    if (!existsSync(src)) continue
    const styleSlug = zip.replace(/\.zip$/, '').replace(/^\d+-/, '')
    const dest = path.join(ALPHA_OUT, styleSlug, category)
    mkdirSync(dest, { recursive: true })
    for (const file of readdirSync(src)) {
      renameSync(path.join(src, file), path.join(dest, file))
      alphabetCount += 1
    }
  }
}
console.log(`[alphabet] unpacked ${alphabetCount} SVGs into ${ALPHA_OUT}`)

// ---------------------------------------------------------------- font letters
const LETTERS_OUT = path.join(GEN, 'font-letters')
rmSync(LETTERS_OUT, { recursive: true, force: true })
mkdirSync(LETTERS_OUT, { recursive: true })
rmSync(`${TMP}/letters`, { recursive: true, force: true })
mkdirSync(`${TMP}/letters`, { recursive: true })
execSync(`unzip -o -q "${UPLOAD}/ALL-FONTS-svgs-master.zip" -d ${TMP}/letters`, { stdio: 'inherit' })
let lettersCount = 0
const fontFolders = readdirSync(`${TMP}/letters`).filter((f) => !f.startsWith('.'))
for (const folder of fontFolders) {
  const src = path.join(TMP, 'letters', folder)
  if (!statSync(src).isDirectory()) continue
  const dest = path.join(LETTERS_OUT, folder.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))
  mkdirSync(dest, { recursive: true })
  for (const file of readdirSync(src)) {
    if (!file.endsWith('.svg')) continue
    renameSync(path.join(src, file), path.join(dest, file))
    lettersCount += 1
  }
}
console.log(`[font-letters] unpacked ${lettersCount} SVGs into ${LETTERS_OUT}`)
writeFileSync('/tmp/svg-unpack-done.txt', `alphabet=${alphabetCount} letters=${lettersCount}`)
