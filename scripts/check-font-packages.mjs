/**
 * Checks which Fontsource families have a static npm package vs variable-only,
 * then rewrites content/packs/package.json accordingly.
 */
import { readFileSync, writeFileSync } from 'fs'

const fonts = JSON.parse(readFileSync('/home/z/my-project/content/fontsource-fonts.json', 'utf8'))
const orig = new Set(JSON.parse(readFileSync('/tmp/orig-fonts.json', 'utf8')))
const ids = fonts.filter((f) => f.category !== 'icons').map((f) => f.id).filter((id) => !orig.has(id))
console.log(`families to verify: ${ids.length}`)

async function exists(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%2F', '%2f')}`, { method: 'HEAD', signal: AbortSignal.timeout(15_000) })
    return res.status === 200
  } catch {
    return false
  }
}

const missing = ids
console.log(`families to check: ${missing.length}`)

const staticOk = []
const variableOnly = []
const CHUNK = 40
for (let i = 0; i < missing.length; i += CHUNK) {
  const batch = missing.slice(i, i + CHUNK)
  const results = await Promise.all(batch.map(async (id) => {
    const [hasStatic, hasVariable] = await Promise.all([exists(`@fontsource/${id}`), exists(`@fontsource-variable/${id}`)])
    return { id, hasStatic, hasVariable }
  }))
  for (const r of results) {
    if (r.hasStatic) staticOk.push(r.id)
    else if (r.hasVariable) variableOnly.push(r.id)
    else console.log(`[skip] ${r.id}: neither package exists`)
  }
  process.stdout.write(`checked ${Math.min(i + CHUNK, missing.length)}/${missing.length}\n`)
}

console.log(`static ok: ${staticOk.length}, variable-only: ${variableOnly.length}`)
writeFileSync('/tmp/font-package-split.json', JSON.stringify({ staticOk, variableOnly }, null, 1))
