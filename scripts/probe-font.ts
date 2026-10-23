/** Probe why a variable-only family is skipped by seedFonts. */
import { existsSync, readdirSync, readFileSync } from 'fs'
import path from 'path'

const PACKS = '/home/z/my-project/content/packs/node_modules'
const slug = process.argv[2] ?? 'outfit'
const staticDir = path.join(PACKS, '@fontsource', slug)
const variableDir = path.join(PACKS, '@fontsource-variable', slug)
console.log('static exists:', existsSync(staticDir))
console.log('variable exists:', existsSync(variableDir))
if (existsSync(variableDir)) {
  const metadata = JSON.parse(readFileSync(path.join(variableDir, 'metadata.json'), 'utf8')) as { subsets?: string[]; variable?: unknown }
  console.log('subsets:', metadata.subsets, 'variable:', JSON.stringify(metadata.variable))
  const WANTED_SUBSETS = new Set(['latin', 'latin-ext', 'emoji'])
  const installable = (metadata.subsets ?? ['latin']).filter((s) => WANTED_SUBSETS.has(s))
  console.log('installable:', installable)
  for (const subset of installable) {
    const file = `${subset}-wght-normal.woff2`
    console.log(file, existsSync(path.join(variableDir, 'files', file)))
  }
}
console.log('in installedStatic:', existsSync(path.join(PACKS, '@fontsource')) && readdirSync(path.join(PACKS, '@fontsource')).includes(slug))
console.log('in installedVariable:', existsSync(path.join(PACKS, '@fontsource-variable')) && readdirSync(path.join(PACKS, '@fontsource-variable')).includes(slug))
