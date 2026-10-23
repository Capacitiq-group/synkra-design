/**
 * Vecteezy free-vector library crawler.
 *
 * Walks Vecteezy's public free-vector category listings (the pages every visitor's browser
 * loads), collects the unique preview image URLs + titles, and downloads the freely
 * accessible non_2x preview JPEGs into media/stock/vecteezy/. Writes a manifest with
 * source attribution for each file. Polite: sequential requests, small delay, bounded page depth.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'fs'
import path from 'path'

const ROOT = '/home/z/my-project'
const OUT = path.join(ROOT, 'media/stock/vecteezy')
const MANIFEST = path.join(ROOT, 'content/vecteezy-manifest.json')
const TARGET = Number(process.argv[2] ?? 1100)
const BUDGET_MS = Number(process.env.TIME_BUDGET_MS ?? 0) // optional wall-clock budget per invocation
const START_TS = Date.now()
const OUT_OF_TIME = () => BUDGET_MS > 0 && Date.now() - START_TS > BUDGET_MS
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const DELAY_MS = 700

const CATEGORIES = [
  'icons', 'backgrounds', 'textures', 'patterns', 'illustrations', 'elements', 'logos',
  'frames', 'banners', 'badges', 'arrows', 'flowers', 'animals', 'people', 'business',
  'technology', 'food', 'nature', 'abstract', 'travel', 'music', 'sports', 'wedding',
  'christmas', 'birthday', 'education', 'medical', 'finance', 'social-media', 'web',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20_000) })
      if (res.status === 200) return await res.text()
      if (res.status === 404 || res.status === 301) return null
      await sleep(1500)
    } catch {
      await sleep(1500)
    }
  }
  return null
}

function extractItems(html) {
  const items = new Map()
  // Resource preview images: https://static.vecteezy.com/system/resources/previews/0XX/XXX/XXX/non_2x/<slug>.jpg
  const re = /https:\/\/static\.vecteezy\.com\/system\/resources\/previews\/(\d{3}\/\d{3}\/\d{3})\/non_2x\/([a-z0-9-]+)\.jpg/gi
  for (const match of html.matchAll(re)) {
    const id = match[1].replaceAll('/', '-')
    if (!items.has(id)) {
      const slug = match[2].slice(0, 90)
      items.set(id, {
        id,
        url: match[0],
        title: slug.replaceAll('-', ' ').trim(),
        slug,
      })
    }
  }
  return [...items.values()]
}

async function download(url, target) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
    if (res.status !== 200) return false
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength < 3_000) return false // skip tiny placeholders
    writeFileSync(target, buf)
    return true
  } catch {
    return false
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const manifest = existsSync(MANIFEST) ? JSON.parse(await import('fs').then((f) => f.readFileSync(MANIFEST, 'utf8'))) : []
  const have = new Set(manifest.map((m) => m.id))
  console.log(`[vecteezy] starting with ${manifest.length} items, target ${TARGET}`)

  crawl: for (const category of CATEGORIES) {
    for (let page = 1; page <= 8; page++) {
      if (manifest.length >= TARGET || OUT_OF_TIME()) break crawl
      const url = page === 1 ? `https://www.vecteezy.com/free-vector/${category}` : `https://www.vecteezy.com/free-vector/${category}?page=${page}`
      const html = await fetchText(url)
      if (!html) {
        console.log(`[vecteezy] ${category} p${page}: unavailable`)
        break
      }
      const found = extractItems(html)
      let added = 0
      for (const item of found) {
        if (manifest.length >= TARGET || OUT_OF_TIME()) break crawl
        if (have.has(item.id)) continue
        const target = path.join(OUT, `${category}-${item.id}.jpg`)
        if (!existsSync(target)) {
          const ok = await download(item.url, target)
          if (!ok) continue
        }
        have.add(item.id)
        manifest.push({
          id: `vecteezy-${category}-${item.id}`,
          provider: 'vecteezy',
          category,
          title: item.title,
          file: `vecteezy/${path.basename(target)}`,
          source_url: `https://www.vecteezy.com/free-vector/${category}`,
          license: 'Vecteezy Content License (free, attribution required)',
          author: 'Vecteezy contributors',
        })
        added += 1
        if (manifest.length % 25 === 0) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1))
        await sleep(120)
      }
      console.log(`[vecteezy] ${category} p${page}: +${added} (total ${manifest.length})`)
      await sleep(DELAY_MS)
    }
    // Persist progress after each category
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1))
  }

  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1))
  const bytes = manifest.reduce((sum, m) => {
    try { return sum + statSync(path.join(OUT, path.basename(m.file))).size } catch { return sum }
  }, 0)
  console.log(`[vecteezy] DONE: ${manifest.length} items, ${(bytes / 1e6).toFixed(1)} MB`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

process.on('uncaughtException', (err) => console.error('[vecteezy] uncaught:', err))
process.on('unhandledRejection', (err) => console.error('[vecteezy] unhandled:', err))
