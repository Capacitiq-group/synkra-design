/**
 * SYNKRA Design — content seeder.
 *
 * Seeds the SQLite catalogue from the vendored content libraries: size presets, the ten starter
 * templates (with their photos and thumbnails), the CC0 audio library, the font catalogue
 * (Fontsource packages), and the vector elements catalogue (original generated art + open-licence
 * icon packs + emoji). Idempotent: packs and families are keyed by slug, templates by slug.
 */
import { PrismaClient } from '@prisma/client'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'fs'
import path from 'path'

const ROOT = '/home/z/my-project'
const REPOS = path.join(ROOT, 'repos/doory/backend/data')
const MEDIA = path.join(ROOT, 'media')
const PACKS = path.join(ROOT, 'content/packs/node_modules')
const GENERATED = path.join(ROOT, 'content/generated-elements')
const DB = new PrismaClient()

function log(step: string, message: string): void {
  console.log(`[seed:${step}] ${message}`)
}

// ---------------------------------------------------------------- presets

function seedPresets(): void {
  const src = path.join(REPOS, 'size_presets.json')
  const out = path.join(ROOT, 'content/size_presets.json')
  mkdirSync(path.dirname(out), { recursive: true })
  copyFileSync(src, out)
  log('presets', 'copied size_presets.json')
}

// ---------------------------------------------------------------- templates

interface TemplateManifestEntry {
  slug: string
  title: string
  category: string
  tags: string[]
  description: string
  preset: string
  is_featured?: boolean
  fonts?: string[]
}

const TEMPLATE_CATEGORIES: [string, string, string][] = [
  ['social-media', 'Social Media', 'share-2'],
  ['presentations', 'Presentations', 'presentation'],
  ['posters', 'Posters', 'image'],
  ['flyers', 'Flyers', 'file-text'],
  ['invitations', 'Invitations', 'mail'],
  ['cards', 'Cards', 'credit-card'],
  ['resumes', 'Resumes', 'file-user'],
  ['logos', 'Logos', 'shapes'],
  ['marketing', 'Marketing', 'megaphone'],
  ['education', 'Education', 'graduation-cap'],
  ['business', 'Business', 'briefcase'],
  ['photo-collage', 'Photo Collage', 'layout-grid'],
  ['youtube', 'YouTube', 'circle-play'],
  ['print', 'Print', 'printer'],
]

async function seedTemplates(): Promise<void> {
  const dir = path.join(REPOS, 'templates')
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { categories?: { slug: string; name: string; icon?: string }[]; templates: TemplateManifestEntry[] }
  const categories = manifest.categories ?? TEMPLATE_CATEGORIES.map(([slug, name, icon]) => ({ slug, name, icon }))
  for (const [index, category] of categories.entries()) {
    await DB.templateCategory.upsert({
      where: { slug: category.slug },
      update: { name: category.name, icon: category.icon ?? '', sortOrder: index },
      create: { slug: category.slug, name: category.name, icon: category.icon ?? '', sortOrder: index },
    })
  }
  // Starter photos live next to the templates and are referenced by absolute /media paths in documents.
  mkdirSync(path.join(MEDIA, 'templates/photos'), { recursive: true })
  mkdirSync(path.join(MEDIA, 'templates/thumbs'), { recursive: true })
  const photosDir = path.join(dir, 'photos')
  if (existsSync(photosDir)) {
    for (const file of readdirSync(photosDir)) cpSync(path.join(photosDir, file), path.join(MEDIA, 'templates/photos', file))
  }
  const thumbsDir = path.join(dir, 'thumbs')
  if (existsSync(thumbsDir)) {
    for (const file of readdirSync(thumbsDir)) cpSync(path.join(thumbsDir, file), path.join(MEDIA, 'templates/thumbs', file))
  }
  let count = 0
  for (const entry of manifest.templates) {
    const documentPath = path.join(dir, `${entry.slug}.json`)
    if (!existsSync(documentPath)) continue
    const document = readFileSync(documentPath, 'utf8')
    const doc = JSON.parse(document) as { pages?: unknown[]; width?: number; height?: number }
    const thumbPath = existsSync(path.join(MEDIA, 'templates/thumbs', `${entry.slug}.webp`)) ? `templates/thumbs/${entry.slug}.webp` : null
    const categoryId = categories.find((c) => c.slug === entry.category)?.slug
    const categoryRow = categoryId ? await DB.templateCategory.findUnique({ where: { slug: categoryId } }) : null
    await DB.template.upsert({
      where: { slug: entry.slug },
      update: {
        title: entry.title, description: entry.description ?? '', categoryId: categoryRow?.id ?? null,
        tags: JSON.stringify(entry.tags ?? []),
        width: doc.width ?? 1080, height: doc.height ?? 1080, preset: entry.preset ?? '',
        pageCount: Array.isArray(doc.pages) ? doc.pages.length : 1, document, thumbnailPath: thumbPath,
        isFeatured: entry.is_featured === true, isPublished: true,
      },
      create: {
        slug: entry.slug, title: entry.title, description: entry.description ?? '',
        categoryId: categoryRow?.id ?? null,
        tags: JSON.stringify(entry.tags ?? []), width: doc.width ?? 1080, height: doc.height ?? 1080, preset: entry.preset ?? '',
        pageCount: Array.isArray(doc.pages) ? doc.pages.length : 1, document, thumbnailPath: thumbPath,
        isFeatured: entry.is_featured === true, isPublished: true,
      },
    })
    count += 1
  }
  log('templates', `seeded ${count} templates`)
}

// ---------------------------------------------------------------- audio

function seedAudio(): void {
  const library = JSON.parse(readFileSync(path.join(REPOS, 'audio_library.json'), 'utf8')) as {
    release: string
    license: string
    tracks: {
      id: string; kind: string; title: string; mood?: string; category?: string; genre?: string; tags?: string[]
      bpm?: number; key?: string; loop?: boolean; channels?: number; durationMs: number; lufs?: number
      bytes: number; peaks: number[]; file: string; source?: string; license?: string
    }[]
    packs?: { id: string; name: string; homepage: string; license: string; attribution: string }[]
  }
  const outDir = path.join(MEDIA, 'audio')
  mkdirSync(path.join(outDir, 'music'), { recursive: true })
  mkdirSync(path.join(outDir, 'sfx'), { recursive: true })
  const entries = []
  for (const track of library.tracks) {
    const source = path.join(REPOS, 'audio', track.file)
    if (!existsSync(source)) continue
    const target = path.join(outDir, track.file)
    mkdirSync(path.dirname(target), { recursive: true })
    if (!existsSync(target)) copyFileSync(source, target)
    entries.push({
      id: track.id, kind: track.kind, title: track.title, mood: track.mood, category: track.category,
      genre: track.genre ?? '', tags: track.tags ?? [], bpm: track.bpm, key: track.key,
      loop: track.loop ?? track.kind === 'music', channels: track.channels ?? 2, durationMs: track.durationMs,
      lufs: track.lufs, bytes: track.bytes, peaks: track.peaks, file: track.file,
      source: track.source ?? 'synkra', license: track.license ?? 'CC0-1.0',
    })
  }
  // The catalogue shape the editor validates: {schema: 1, release, license, tracks[], packs[]}.
  const catalogue = {
    schema: 1,
    release: library.release,
    license: library.license,
    tracks: entries,
    packs: library.packs ?? [{ id: 'synkra', name: 'Synkra Studio Audio', homepage: '', license: 'CC0-1.0', attribution: '' }],
  }
  writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(catalogue))
  log('audio', `seeded ${entries.length} tracks`)
}

// ---------------------------------------------------------------- fonts

const FONT_POPULAR = JSON.parse(readFileSync(path.join(REPOS, 'popular_fonts.json'), 'utf8')) as { family: string; id: string; category: string; scripts: string[]; popularity: number }[]
const TEMPLATE_FONTS = ['poppins', 'crimson-text', 'manrope', 'archivo', 'oswald', 'playfair-display', 'josefin-sans', 'anton', 'great-vibes', 'pinyon-script', 'inter']
const CJK_PREFIXES = ['chinese', 'korean', 'japanese']
const MAX_FAMILIES = 120

async function seedFonts(): Promise<void> {
  const wanted = [...FONT_POPULAR.slice(0, MAX_FAMILIES - TEMPLATE_FONTS.length).map((f) => f.id), ...TEMPLATE_FONTS]
  const slugs = [...new Set(wanted)]
  let families = 0
  let variants = 0
  for (const slug of slugs) {
    const staticDir = path.join(PACKS, '@fontsource', slug)
    const variableDir = path.join(PACKS, '@fontsource-variable', slug)
    let familyName = slug
    let category = 'sans-serif'
    let isVariable = false
    let weights: number[] = [400, 700]
    let styles: string[] = ['normal']
    let subsets: string[] = ['latin']
    let fileDir = staticDir
    if (existsSync(staticDir)) {
      const metadata = JSON.parse(readFileSync(path.join(staticDir, 'metadata.json'), 'utf8')) as { family?: string; category?: string; subsets?: string[]; weights?: number[]; styles?: string[] }
      familyName = metadata.family ?? slug
      category = metadata.category ?? 'sans-serif'
      weights = [400, 700]
      styles = metadata.styles?.filter((s) => s === 'normal' || s === 'italic') ?? ['normal']
      subsets = metadata.subsets ?? ['latin']
    } else if (existsSync(variableDir)) {
      const metadata = JSON.parse(readFileSync(path.join(variableDir, 'metadata.json'), 'utf8')) as { family?: string; category?: string; subsets?: string[]; variable?: { weights?: number[] } }
      familyName = metadata.family ?? slug
      category = metadata.category ?? 'sans-serif'
      isVariable = true
      weights = [400]
      styles = ['normal']
      subsets = metadata.subsets ?? ['latin']
      fileDir = variableDir
    } else {
      continue
    }
    const unicode = JSON.parse(readFileSync(path.join(fileDir, 'unicode.json'), 'utf8')) as Record<string, string>
    const installable = subsets.filter((subset) => !CJK_PREFIXES.some((prefix) => subset.startsWith(prefix)))
    const outDir = path.join(MEDIA, 'fonts/system', slug)
    const rows: { weight: number; style: string; subset: string; unicodeRange: string; filePath: string; format: string; size: number }[] = []
    if (isVariable) {
      for (const subset of installable) {
        const file = `${subset}-wght-normal.woff2`
        const source = path.join(fileDir, 'files', file)
        if (!existsSync(source)) continue
        mkdirSync(outDir, { recursive: true })
        const target = path.join(outDir, file)
        if (!existsSync(target)) copyFileSync(source, target)
        rows.push({ weight: 400, style: 'normal', subset, unicodeRange: unicode[subset] ?? '', filePath: `fonts/system/${slug}/${file}`, format: 'woff2', size: statSync(target).size })
      }
    } else {
      for (const weight of weights) {
        for (const style of styles) {
          for (const subset of installable) {
            const styleName = style === 'italic' ? 'italic' : 'normal'
            const file = `${slug}-${subset}-${weight}-${styleName}.woff2`
            const source = path.join(fileDir, 'files', file)
            if (!existsSync(source)) continue
            mkdirSync(outDir, { recursive: true })
            const target = path.join(outDir, file)
            if (!existsSync(target)) copyFileSync(source, target)
            rows.push({ weight, style: styleName, subset, unicodeRange: unicode[subset] ?? '', filePath: `fonts/system/${slug}/${file}`, format: 'woff2', size: statSync(target).size })
          }
        }
      }
    }
    if (rows.length === 0) continue
    const popularity = FONT_POPULAR.find((f) => f.id === slug)?.popularity ?? 5000
    const scripts = FONT_POPULAR.find((f) => f.id === slug)?.scripts ?? ['latin']
    const key = `system:${slug}`
    const existing = await DB.fontFamily.findUnique({ where: { key } })
    const data = {
      key, family: familyName, slug, category, scripts: JSON.stringify(scripts), isVariable, popularity,
      license: 'OFL-1.1', source: 'fontsource', ownerId: null, isPublished: true,
    }
    const family = existing
      ? await DB.fontFamily.update({ where: { id: existing.id }, data })
      : await DB.fontFamily.create({ data })
    await DB.fontVariant.deleteMany({ where: { familyId: family.id } })
    await DB.fontVariant.createMany({ data: rows.map((row) => ({ ...row, familyId: family.id })) })
    families += 1
    variants += rows.length
  }
  log('fonts', `seeded ${families} families, ${variants} variants`)
}

// ---------------------------------------------------------------- elements

interface PackDef {
  id: string
  name: string
  kind: string
  style: string
  description: string
  sort_order: number
  source: { type: string; package?: string; version?: string; set?: string; index?: string }
  files?: { include?: string[] }
  license: { spdx: string; url?: string }
  attribution: string
  normalize?: { mode?: string; size?: number; frame?: boolean }
  tags?: { format?: string; file?: string }
  homepage?: string
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

function monoize(svg: string): string {
  return svg.replace(/(fill|stroke)="(?!none)(?!currentColor)[^"]*"/gi, (_m, attr) => `${attr}="#15161a"`)
}

function elementSize(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/viewBox="([\d.\-\s]+)"/)?.[1]?.trim().split(/\s+/).map(Number)
  if (viewBox && viewBox.length === 4) return { width: Math.round(viewBox[2]), height: Math.round(viewBox[3]) }
  const width = Math.round(Number(svg.match(/\bwidth="([\d.]+)/)?.[1] ?? 0))
  const height = Math.round(Number(svg.match(/\bheight="([\d.]+)/)?.[1] ?? 0))
  return { width, height }
}

function elementColors(svg: string): string[] {
  const colors = new Set<string>()
  for (const match of svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,8})"/g)) colors.add(match[1].toLowerCase())
  return [...colors].slice(0, 8)
}

function nameToTags(name: string): string[] {
  return name.replace(/\.svg$/i, '').replace(/[-_]+/g, ' ').toLowerCase().split(/\s+/).filter((word) => word.length > 1).slice(0, 8)
}

async function seedElements(): Promise<void> {
  const manifest = JSON.parse(readFileSync(path.join(REPOS, 'element_packs.json'), 'utf8')) as { packs: PackDef[] }
  let totalElements = 0
  for (const pack of manifest.packs) {
    const existing = await DB.elementPack.findUnique({ where: { slug: pack.id } })
    if (existing) {
      const count = await DB.element.count({ where: { packId: existing.id } })
      if (count > 0) {
        log('elements', `pack ${pack.id} already seeded (${count})`)
        totalElements += count
        continue
      }
    }
    const collected: { key: string; name: string; svg: string; tags: string[] }[] = []
    if (pack.source.type === 'generated') {
      const setDir = path.join(GENERATED, pack.source.set ?? pack.id)
      if (!existsSync(setDir)) continue
      for (const folder of readdirSync(setDir)) {
        const folderPath = path.join(setDir, folder)
        if (!statSync(folderPath).isDirectory()) continue
        for (const file of readdirSync(folderPath).filter((f) => f.endsWith('.svg'))) {
          const svg = readFileSync(path.join(folderPath, file), 'utf8')
          collected.push({ key: file.replace(/\.svg$/, ''), name: file.replace(/\.svg$/, '').replace(/[-_]+/g, ' '), svg, tags: [...nameToTags(file), folder.replace(/[-_]+/g, ' ')] })
        }
      }
    } else if (pack.source.type === 'npm') {
      const packageName = pack.source.package ?? ''
      const baseDir = path.join(PACKS, packageName)
      const includes = pack.files?.include ?? []
      let tags: Map<string, string[]> = new Map()
      if (pack.tags?.format === 'json-map') {
        const tagsPath = path.join(baseDir, pack.tags.file ?? 'tags.json')
        if (existsSync(tagsPath)) {
          const raw = JSON.parse(readFileSync(tagsPath, 'utf8')) as Record<string, string | string[]>
          tags = new Map(Object.entries(raw).map(([key, value]) => [key, (Array.isArray(value) ? value : String(value).split(/\s+/)).map((t) => String(t).toLowerCase())]))
        }
      } else if (pack.tags?.format === 'tabler') {
        const tagsPath = path.join(baseDir, pack.tags.file ?? 'icons.json')
        if (existsSync(tagsPath)) {
          const raw = JSON.parse(readFileSync(tagsPath, 'utf8')) as Record<string, { tags?: string[]; category?: string }>
          tags = new Map(Object.entries(raw).map(([key, value]) => [key, [...(value.tags ?? []), ...(value.category ? [value.category] : [])].map((t) => String(t).toLowerCase())]))
        }
      } else if (pack.tags?.format === 'phosphor-js') {
        const tagsPath = path.join(baseDir, pack.tags.file ?? 'dist/index.mjs')
        if (existsSync(tagsPath)) {
          const raw = readFileSync(tagsPath, 'utf8')
          for (const match of raw.matchAll(/(?:"tags":\s*\[([^\]]*)\]|keywords:\s*\[([^\]]*)\])/g)) {
            void match
          }
          // Phosphor's metadata lives in the ESM bundle; fall back to filename tags.
        }
      } else if (pack.tags?.format === 'iconify-categories') {
        const metadataPath = path.join(baseDir, pack.tags.file ?? 'metadata.json')
        if (existsSync(metadataPath)) {
          const raw = JSON.parse(readFileSync(metadataPath, 'utf8')) as { icons?: Record<string, { category?: string; tags?: string[] }> }
          for (const [key, value] of Object.entries(raw.icons ?? {})) {
            tags.set(key, [...(value.tags ?? []), ...(value.category ? [value.category] : [])].map((t) => String(t).toLowerCase()))
          }
        }
      }
      for (const pattern of includes) {
        const segments = pattern.split('/')
        const last = segments[segments.length - 1]
        if (last.endsWith('.json')) {
          // Iconify collections: the SVG bodies live inside the JSON catalogue.
          if (pack.tags?.format === 'iconify-categories' || packageName.startsWith('@iconify-json/')) {
            const iconsPath = path.join(baseDir, last)
            const metadataPath = path.join(baseDir, 'metadata.json')
            if (!existsSync(iconsPath)) continue
            const collection = JSON.parse(readFileSync(iconsPath, 'utf8')) as {
              icons?: Record<string, { body: string; width?: number; height?: number }>
              aliases?: Record<string, { parent: string }>
              width?: number
              height?: number
            }
            const metadata = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, 'utf8')) as { icons?: Record<string, { category?: string; tags?: string[] }> } : {}
            const defaultWidth = collection.width ?? 24
            const defaultHeight = collection.height ?? 24
            for (const [key, icon] of Object.entries(collection.icons ?? {})) {
              const width = icon.width ?? defaultWidth
              const height = icon.height ?? defaultHeight
              const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${icon.body}</svg>`
              const tagInfo = metadata.icons?.[key]
              collected.push({ key, name: key.replace(/[-_]+/g, ' '), svg, tags: [...(tagInfo?.tags ?? []), ...(tagInfo?.category ? [tagInfo.category] : [])].map((t) => String(t).toLowerCase()) })
            }
          }
          continue
        }
        const dirSegments = segments.slice(0, -1)
        const searchDir = path.join(baseDir, ...dirSegments)
        if (!existsSync(searchDir) || !statSync(searchDir).isDirectory()) continue
        for (const file of readdirSync(searchDir)) {
          if (!file.endsWith('.svg')) continue
          if (pack.id === 'bootstrap-fill' && !file.endsWith('-fill.svg')) continue
          if (pack.id === 'material-filled' && !file.endsWith('-fill.svg')) continue
          if (pack.id === 'phosphor-bold' && !file.endsWith('-bold.svg')) continue
          if (pack.id === 'phosphor-fill' && !file.endsWith('-fill.svg')) continue
          if (pack.id === 'phosphor-duotone' && !file.endsWith('-duotone.svg')) continue
          if (pack.id === 'phosphor-regular' && /-(bold|fill|duotone|light|thin|italic)\.svg$/.test(file)) continue
          if (pack.id === 'heroicons-solid' && !/24\/solid/.test(pattern)) continue
          if (pack.id === 'material-filled' && !file.includes('-fill')) continue
          if (pack.id === 'bootstrap-outline' && file.endsWith('-fill.svg')) continue
          if (pack.id === 'material-outlined' && file.endsWith('-fill.svg')) continue
          const svg = readFileSync(path.join(searchDir, file), 'utf8')
          const key = file.replace(/\.svg$/, '')
          collected.push({ key, name: key.replace(/[-_]+/g, ' '), svg, tags: tags.get(key) ?? nameToTags(file) })
        }
      }
    } else if (pack.source.type === 'urls') {
      // Illustration sets: vendored files downloaded from the pinned URLs (sha256-verified at fetch time).
      const indexName = pack.source.index ?? ''
      const items = JSON.parse(readFileSync(path.join(ROOT, 'content/url-elements', indexName), 'utf8')) as { name: string; tags?: string[] }[]
      for (const item of items) {
        const filePath = path.join(ROOT, 'content/url-elements/files', `${indexName.replace(/\.json$/, '')}-${item.name}`)
        if (!existsSync(filePath)) continue
        collected.push({ key: item.name.replace(/\.svg$/, ''), name: item.name.replace(/\.svg$/, '').replace(/[-_]+/g, ' '), svg: readFileSync(filePath, 'utf8'), tags: item.tags ?? nameToTags(item.name) })
      }
    }
    if (collected.length === 0) {
      log('elements', `pack ${pack.id}: no files found, skipped`)
      continue
    }
    const packData = {
      slug: pack.id, name: pack.name, kind: pack.kind, license: pack.license.spdx, licenseUrl: pack.license.url ?? '',
      attribution: pack.attribution, sourceUrl: pack.homepage ?? '', sourceRef: pack.source.package ? `${pack.source.package}@${pack.source.version}` : '',
      description: pack.description, sortOrder: pack.sort_order, isPublished: true,
    }
    const row = existing
      ? await DB.elementPack.update({ where: { id: existing.id }, data: packData })
      : await DB.elementPack.create({ data: packData })
    const outDir = path.join(MEDIA, 'elements', pack.id)
    mkdirSync(outDir, { recursive: true })
    const mode = pack.normalize?.mode ?? 'colour'
    const fixedSize = pack.normalize?.size
    const rows: { key: string; name: string; kind: string; style: string; tags: string; searchName: string; searchTags: string; svgPath: string; width: number; height: number; colors: string; isRecolorable: boolean; sortOrder: number; contentHash: string }[] = []
    let order = 0
    for (const item of collected) {
      let svg = sanitizeSvg(item.svg)
      if (mode === 'mono') svg = monoize(svg)
      if (fixedSize && !/width="/.test(svg)) {
        svg = svg.replace(/<svg /, `<svg width="${fixedSize}" height="${fixedSize}" `)
      }
      const fileName = `${item.key}.svg`
      writeFileSync(path.join(outDir, fileName), svg)
      const size = elementSize(svg)
      const colors = elementColors(svg)
      const searchTags = [...new Set([...item.tags, ...item.name.toLowerCase().split(/\s+/)])].join(' ')
      rows.push({
        key: item.key, name: item.name, kind: pack.kind, style: pack.style, tags: JSON.stringify(item.tags),
        searchName: item.name.toLowerCase(), searchTags, svgPath: `elements/${pack.id}/${fileName}`,
        width: size.width || fixedSize || 24, height: size.height || fixedSize || 24,
        colors: JSON.stringify(colors), isRecolorable: mode === 'mono' && colors.length <= 8,
        sortOrder: order, contentHash: `${pack.id}:${item.key}`,
      })
      order += 1
    }
    await DB.element.deleteMany({ where: { packId: row.id } })
    for (let i = 0; i < rows.length; i += 500) {
      await DB.element.createMany({ data: rows.slice(i, i + 500).map((element) => ({ ...element, packId: row.id })) })
    }
    totalElements += rows.length
    log('elements', `pack ${pack.id}: ${rows.length} elements`)
  }
  log('elements', `total ${totalElements}`)
}

// ---------------------------------------------------------------- run

async function main(): Promise<void> {
  seedPresets()
  await seedTemplates()
  await seedAudio()
  await seedFonts()
  await seedElements()
  await DB.$disconnect()
  log('done', 'content seeding complete')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
