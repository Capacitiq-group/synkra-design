import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  HttpError, jsonResponse, readJson, checkCsrf, requireUser, currentUser, rateLimit, clientKey,
  parseJsonColumn, LIMITS,
} from './core'
import { saveUpload } from './files'
import { serializeAsset } from './designs'

// ---------- assets (uploads library) ----------

function sniffKind(mime: string, name: string): 'image' | 'svg' | 'audio' {
  if (mime === 'image/svg+xml' || name.toLowerCase().endsWith('.svg')) return 'svg'
  if (mime.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|aac|weba|flac)$/i.test(name)) return 'audio'
  return 'image'
}

async function probeImageSize(buffer: ArrayBuffer, mime: string): Promise<{ width: number; height: number }> {
  try {
    const bytes = new Uint8Array(buffer)
    // PNG
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      const view = new DataView(buffer)
      return { width: view.getUint32(16), height: view.getUint32(20) }
    }
    // GIF
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      const view = new DataView(buffer)
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
    }
    // JPEG (scan SOF markers)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const view = new DataView(buffer)
      let offset = 2
      while (offset < bytes.length - 9) {
        if (bytes[offset] !== 0xff) { offset += 1; continue }
        const marker = bytes[offset + 1]
        const length = view.getUint16(offset + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
        }
        offset += 2 + length
      }
    }
    // WebP (VP8/VP8L/VP8X)
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      const view = new DataView(buffer)
      const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
      if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
      }
      if (chunk === 'VP8L') {
        const b = view.getUint32(21, true)
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
      }
      if (chunk === 'VP8X') {
        return { width: (view.getUint32(24, true) & 0xffffff) + 1, height: (view.getUint32(27, true) & 0xffffff) + 1 }
      }
    }
    // SVG: read width/height attributes
    if (mime === 'image/svg+xml') {
      const text = new TextDecoder().decode(bytes.slice(0, 4096))
      const width = Number(text.match(/\bwidth="([\d.]+)/)?.[1] ?? 0)
      const height = Number(text.match(/\bheight="([\d.]+)/)?.[1] ?? 0)
      if (width && height) return { width: Math.round(width), height: Math.round(height) }
    }
  } catch {
    // best-effort only
  }
  return { width: 0, height: 0 }
}

export const assetHandlers = {
  async 'GET /assets'(req: NextRequest): Promise<NextResponse> {
    const user = await requireUser(req)
    const kind = req.nextUrl.searchParams.get('kind')
    const q = req.nextUrl.searchParams.get('q')?.trim() || null
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('page_size') ?? 20) || 20))
    const ordering = req.nextUrl.searchParams.get('ordering') ?? '-created_at'
    const where = {
      ownerId: user.id,
      ...(kind ? { kind } : {}),
      ...(q ? { name: { contains: q } } : {}),
    }
    const orderBy = ordering === 'name' ? { name: 'asc' as const } : ordering === '-name' ? { name: 'desc' as const } : ordering === 'created_at' ? { createdAt: 'asc' as const } : { createdAt: 'desc' as const }
    const [total, rows] = await Promise.all([
      db.asset.count({ where }),
      db.asset.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    ])
    const pageUrl = (n: number) => {
      const p = new URLSearchParams(req.nextUrl.searchParams)
      p.set('page', String(n))
      return `${req.nextUrl.pathname}?${p.toString()}`
    }
    return jsonResponse({
      count: total,
      next: page * pageSize < total ? pageUrl(page + 1) : null,
      previous: page > 1 ? pageUrl(page - 1) : null,
      results: rows.map(serializeAsset),
    })
  },

  async 'POST /assets'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    rateLimit('upload', user.id, 60, 60_000)
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) throw new HttpError(400, 'validation_error', 'Choose a file to upload.', { fields: { file: ['Required.'] } })
    if (file.size > LIMITS.maxUploadBytes) throw new HttpError(400, 'file_too_large', 'Uploads can be at most 25 MB.')
    const used = await db.asset.aggregate({ where: { ownerId: user.id }, _sum: { size: true } })
    if ((used._sum.size ?? 0) + file.size > LIMITS.userStorageQuotaBytes) throw new HttpError(400, 'storage_full', 'Your uploads library is full. Delete some files first.')
    const name = typeof form.get('name') === 'string' ? (form.get('name') as string).slice(0, 255) || file.name : file.name
    const tags = typeof form.get('tags') === 'string' ? (form.get('tags') as string).split(',').map((t) => t.trim()).filter(Boolean) : []
    const kind = sniffKind(file.type, file.name)
    const buffer = await file.arrayBuffer()
    const size = kind === 'image' ? await probeImageSize(buffer, file.type) : { width: 0, height: 0 }
    const saved = await saveUpload(file, `assets/${user.id}`)
    const durationMs = kind === 'audio' ? Number(form.get('duration_ms')) || null : null
    const row = await db.asset.create({
      data: {
        ownerId: user.id, kind, name, filePath: saved.path, size: saved.bytes, mime: saved.mime,
        width: size.width, height: size.height, tags: JSON.stringify(tags),
        meta: JSON.stringify(form.get('meta') && typeof form.get('meta') === 'string' ? JSON.parse(form.get('meta') as string) : {}),
        durationMs,
      },
    })
    return jsonResponse(serializeAsset(row), { status: 201 })
  },

  async 'PATCH /assets/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const row = await db.asset.findUnique({ where: { id: params.id } })
    if (!row || row.ownerId !== user.id) throw new HttpError(404, 'not_found', 'That upload does not exist.')
    const body = await readJson(req)
    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 255)
    if (Array.isArray(body.tags)) data.tags = JSON.stringify(body.tags.filter((t: unknown) => typeof t === 'string'))
    const updated = await db.asset.update({ where: { id: row.id }, data })
    return jsonResponse(serializeAsset(updated))
  },

  async 'DELETE /assets/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const row = await db.asset.findUnique({ where: { id: params.id } })
    if (!row || row.ownerId !== user.id) throw new HttpError(404, 'not_found', 'That upload does not exist.')
    await db.asset.delete({ where: { id: row.id } })
    return new NextResponse(null, { status: 204 })
  },

  async 'GET /assets/usage'(req: NextRequest): Promise<NextResponse> {
    const user = await requireUser(req)
    const used = await db.asset.aggregate({ where: { ownerId: user.id }, _sum: { size: true } })
    return jsonResponse({ used_bytes: used._sum.size ?? 0, quota_bytes: LIMITS.userStorageQuotaBytes })
  },
}

// ---------- brand kits ----------

function brandJson(row: { id: string; name: string; isDefault: boolean; colors: string; fonts: string; logos: string; createdAt: Date; updatedAt: Date }, logos: unknown[]) {
  return {
    id: row.id, name: row.name, is_default: row.isDefault,
    colors: parseJsonColumn<unknown[]>(row.colors, []),
    fonts: parseJsonColumn<unknown[]>(row.fonts, []),
    logos,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

export const brandHandlers = {
  async 'GET /brand-kits'(req: NextRequest): Promise<NextResponse> {
    const user = await requireUser(req)
    const rows = await db.brandKit.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: 'asc' } })
    const logoIds = rows.flatMap((row) => parseJsonColumn<string[]>(row.logos, []))
    const logoAssets = logoIds.length > 0 ? await db.asset.findMany({ where: { id: { in: logoIds }, ownerId: user.id } }) : []
    const logoById = new Map(logoAssets.map((asset) => [asset.id, serializeAsset(asset)]))
    return jsonResponse({ results: rows.map((row) => brandJson(row, parseJsonColumn<string[]>(row.logos, []).map((id) => logoById.get(id)).filter(Boolean))), count: rows.length })
  },

  async 'POST /brand-kits'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const body = await readJson(req)
    const row = await createOrUpdateKit(user.id, null, body)
    return jsonResponse(row, { status: 201 })
  },

  async 'PATCH /brand-kits/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const row = await db.brandKit.findUnique({ where: { id: params.id } })
    if (!row || row.ownerId !== user.id) throw new HttpError(404, 'not_found', 'That brand kit does not exist.')
    const body = await readJson(req)
    const updated = await createOrUpdateKit(user.id, row.id, body)
    return jsonResponse(updated)
  },

  async 'DELETE /brand-kits/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const row = await db.brandKit.findUnique({ where: { id: params.id } })
    if (!row || row.ownerId !== user.id) throw new HttpError(404, 'not_found', 'That brand kit does not exist.')
    await db.brandKit.delete({ where: { id: row.id } })
    return new NextResponse(null, { status: 204 })
  },
}

async function createOrUpdateKit(ownerId: string, id: string | null, body: any): Promise<unknown> {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  if (!name) throw new HttpError(400, 'validation_error', 'Give the kit a name.', { fields: { name: ['Required.'] } })
  const colors = Array.isArray(body.colors) ? body.colors.slice(0, 20) : []
  const fonts = Array.isArray(body.fonts) ? body.fonts.slice(0, 6) : []
  const logoIds = Array.isArray(body.logo_ids) ? body.logo_ids.slice(0, 10) : []
  const count = await db.brandKit.count({ where: { ownerId } })
  if (id === null && count >= 20) throw new HttpError(400, 'too_many_kits', 'You can keep at most 20 brand kits.')
  const makeDefault = body.is_default === true || count === 0
  if (makeDefault) await db.brandKit.updateMany({ where: { ownerId, NOT: { id: id ?? '' } }, data: { isDefault: false } })
  const data = {
    name, isDefault: makeDefault,
    colors: JSON.stringify(colors), fonts: JSON.stringify(fonts), logos: JSON.stringify(logoIds),
  }
  const row = id ? await db.brandKit.update({ where: { id }, data }) : await db.brandKit.create({ data: { ownerId, ...data } })
  const logoAssets = logoIds.length > 0 ? await db.asset.findMany({ where: { id: { in: logoIds }, ownerId } }) : []
  const logoById = new Map(logoAssets.map((asset) => [asset.id, serializeAsset(asset)]))
  return brandJson(row, logoIds.map((assetId: string) => logoById.get(assetId)).filter(Boolean))
}

// ---------- templates ----------

function templateSummary(row: { id: string; slug: string; title: string; width: number; height: number; preset: string; pageCount: number; thumbnailPath: string | null; isFeatured: boolean; useCount: number; createdAt: Date; tags: string; category: { id: string; slug: string; name: string } | null }) {
  const orientation = row.width > row.height ? 'landscape' : row.width < row.height ? 'portrait' : 'square'
  return {
    id: row.id, slug: row.slug, title: row.title,
    category: row.category ? { id: row.category.id, slug: row.category.slug, name: row.category.name } : null,
    tags: parseJsonColumn<string[]>(row.tags, []),
    width: row.width, height: row.height, orientation, preset: row.preset, page_count: row.pageCount,
    thumbnail_url: row.thumbnailPath ? `/media/${row.thumbnailPath}` : null,
    is_featured: row.isFeatured, use_count: row.useCount, created_at: row.createdAt.toISOString(),
  }
}

export const templateHandlers = {
  async 'GET /template-categories'(): Promise<NextResponse> {
    const rows = await db.templateCategory.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { templates: true } } } })
    return jsonResponse({ results: rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, icon: row.icon, template_count: row._count.templates, sort_order: row.sortOrder })), count: rows.length })
  },

  async 'GET /templates'(req: NextRequest): Promise<NextResponse> {
    const params = req.nextUrl.searchParams
    const page = Math.max(1, Number(params.get('page') ?? 1) || 1)
    const pageSize = Math.min(60, Math.max(1, Number(params.get('page_size') ?? 24) || 24))
    const q = params.get('q')?.trim().toLowerCase() || null
    const category = params.get('category')
    const preset = params.get('preset')
    const orientation = params.get('orientation')
    const ordering = params.get('ordering') ?? '-created_at'
    const orderBy = ordering === 'use_count' ? { useCount: 'asc' as const } : ordering === '-use_count' ? { useCount: 'desc' as const } : ordering === 'title' ? { title: 'asc' as const } : ordering === '-title' ? { title: 'desc' as const } : ordering === 'created_at' ? { createdAt: 'asc' as const } : { createdAt: 'desc' as const }
    const rows = await db.template.findMany({ where: { isPublished: true, ...(category ? { category: { slug: category } } : {}), ...(preset ? { preset } : {}) }, orderBy, include: { category: true } })
    const filtered = rows.filter((row) => {
      if (orientation === 'landscape' && row.width <= row.height) return false
      if (orientation === 'portrait' && row.width >= row.height) return false
      if (orientation === 'square' && row.width !== row.height) return false
      if (q) {
        const haystack = `${row.title} ${row.tags} ${row.category?.name ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    const slice = filtered.slice((page - 1) * pageSize, page * pageSize)
    const pageUrl = (n: number) => {
      const p = new URLSearchParams(params)
      p.set('page', String(n))
      return `${req.nextUrl.pathname}?${p.toString()}`
    }
    return jsonResponse({
      count: filtered.length,
      next: page * pageSize < filtered.length ? pageUrl(page + 1) : null,
      previous: page > 1 ? pageUrl(page - 1) : null,
      results: slice.map(templateSummary),
    })
  },

  async 'GET /templates/:slug'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const row = await db.template.findUnique({ where: { slug: params.slug }, include: { category: true } })
    if (!row || !row.isPublished) throw new HttpError(404, 'not_found', 'That template does not exist.')
    return jsonResponse({ ...templateSummary(row), description: row.description, document: JSON.parse(row.document) })
  },

  async 'POST /templates/:slug/use'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const row = await db.template.findUnique({ where: { slug: params.slug } })
    if (!row || !row.isPublished) throw new HttpError(404, 'not_found', 'That template does not exist.')
    const doc = JSON.parse(row.document)
    const design = await db.design.create({
      data: {
        ownerId: user.id, title: row.title, width: row.width, height: row.height, preset: row.preset,
        document: row.document, pageCount: Array.isArray(doc.pages) ? doc.pages.length : 1,
      },
    })
    await db.template.update({ where: { id: row.id }, data: { useCount: { increment: 1 } } })
    const fresh = await db.design.findUnique({ where: { id: design.id } })
    const { designFull } = await import('./designs')
    return jsonResponse(designFull(fresh!), { status: 201 })
  },
}

// ---------- elements ----------

export const elementHandlers = {
  async 'GET /elements/packs'(): Promise<NextResponse> {
    const rows = await db.elementPack.findMany({ where: { isPublished: true }, orderBy: { sortOrder: 'asc' }, include: { _count: { select: { elements: true } } } })
    return jsonResponse({
      results: rows.map((row) => ({
        id: row.id, slug: row.slug, name: row.name, kind: row.kind, element_count: row._count.elements,
        license: row.license, license_url: row.licenseUrl, attribution: row.attribution, source_url: row.sourceUrl,
        description: row.description,
        thumbnail_url: row.thumbnailPath ? `/media/${row.thumbnailPath}` : null,
      })),
      count: rows.length,
    })
  },

  async 'GET /elements'(req: NextRequest): Promise<NextResponse> {
    const params = req.nextUrl.searchParams
    const page = Math.max(1, Number(params.get('page') ?? 1) || 1)
    const pageSize = Math.min(96, Math.max(1, Number(params.get('page_size') ?? 36) || 36))
    const q = params.get('q')?.trim().toLowerCase() || null
    const pack = params.get('pack')
    const kind = params.get('kind')
    const style = params.get('style')
    const ordering = params.get('ordering') ?? ''
    const where = {
      isPublished: true,
      ...(pack ? { pack: { slug: pack } } : {}),
      ...(kind ? { kind } : {}),
      ...(style ? { style } : {}),
    }
    const rows = await db.element.findMany({
      where,
      orderBy: ordering === 'name' ? { name: 'asc' } : ordering === '-name' ? { name: 'desc' } : { sortOrder: 'asc' },
      take: 4000,
      include: { pack: { select: { id: true, slug: true, name: true } } },
    })
    const filtered = q
      ? rows.filter((row) => {
          const name = row.searchName.toLowerCase()
          if (name.includes(q)) return true
          const tags = row.searchTags.toLowerCase()
          return q.split(/\s+/).every((word) => tags.includes(word) || name.includes(word))
        })
      : rows
    const sorted = q && ordering !== 'name' && ordering !== '-name'
      ? filtered.slice().sort((a, b) => {
          const an = a.searchName.toLowerCase().startsWith(q) ? 0 : 1
          const bn = b.searchName.toLowerCase().startsWith(q) ? 0 : 1
          return an - bn
        })
      : filtered
    const slice = sorted.slice((page - 1) * pageSize, page * pageSize)
    return jsonResponse({
      count: sorted.length,
      next: page * pageSize < sorted.length ? `${req.nextUrl.pathname}?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page + 1) }).toString()}` : null,
      previous: page > 1 ? `${req.nextUrl.pathname}?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page - 1) }).toString()}` : null,
      results: slice.map((row) => ({
        id: row.id, name: row.name, kind: row.kind, style: row.style, pack: row.pack,
        tags: parseJsonColumn<string[]>(row.tags, []), svg_url: `/media/${row.svgPath}`,
        width: row.width, height: row.height, colors: parseJsonColumn<string[]>(row.colors, []), is_recolorable: row.isRecolorable,
      })),
    })
  },
}

// ---------- fonts ----------

export const fontHandlers = {
  async 'GET /fonts'(req: NextRequest): Promise<NextResponse> {
    const params = req.nextUrl.searchParams
    const page = Math.max(1, Number(params.get('page') ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(params.get('page_size') ?? 50) || 50))
    const q = params.get('q')?.trim().toLowerCase() || null
    const category = params.get('category')
    const script = params.get('script')
    const isVariable = params.get('is_variable')
    const where = {
      isPublished: true,
      source: 'fontsource' as const,
      ...(category ? { category } : {}),
      ...(isVariable === 'true' ? { isVariable: true } : isVariable === 'false' ? { isVariable: false } : {}),
    }
    const [total, rows] = await Promise.all([
      db.fontFamily.count({ where }),
      db.fontFamily.findMany({ where, orderBy: [{ popularity: 'asc' }, { family: 'asc' }], include: { variants: true } }),
    ])
    const filtered = rows.filter((row) => {
      if (q && !row.family.toLowerCase().includes(q)) return false
      if (script && !(JSON.parse(row.scripts) as string[]).includes(script)) return false
      return true
    })
    const slice = filtered.slice((page - 1) * pageSize, page * pageSize)
    const pageUrl = (n: number) => {
      const p = new URLSearchParams(params)
      p.set('page', String(n))
      return `${req.nextUrl.pathname}?${p.toString()}`
    }
    return jsonResponse({
      count: filtered.length,
      next: page * pageSize < filtered.length ? pageUrl(page + 1) : null,
      previous: page > 1 ? pageUrl(page - 1) : null,
      results: slice.map((row) => ({
        id: row.id, family: row.family, category: row.category, scripts: JSON.parse(row.scripts) as string[],
        is_variable: row.isVariable, is_user_font: false, popularity: row.popularity,
        variants: row.variants.map((v) => ({
          weight: v.weight, style: v.style as 'normal' | 'italic', url: `/media/${v.filePath}`,
          subsets: [{ subset: v.subset, url: `/media/${v.filePath}` }],
        })),
        unicode_ranges: Object.fromEntries(row.variants.map((v) => [v.subset, v.unicodeRange])),
      })),
    })
  },

  async 'GET /fonts/mine'(req: NextRequest): Promise<NextResponse> {
    const user = await requireUser(req)
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('page_size') ?? 30) || 30))
    const where = { source: 'upload' as const, ownerId: user.id }
    const [total, rows] = await Promise.all([
      db.fontFamily.count({ where }),
      db.fontFamily.findMany({ where, orderBy: { popularity: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: { variants: true } }),
    ])
    const pageUrl = (n: number) => {
      const p = new URLSearchParams(req.nextUrl.searchParams)
      p.set('page', String(n))
      return `${req.nextUrl.pathname}?${p.toString()}`
    }
    return jsonResponse({
      count: total,
      next: page * pageSize < total ? pageUrl(page + 1) : null,
      previous: page > 1 ? pageUrl(page - 1) : null,
      results: rows.map((row) => ({
        id: row.id, family: row.family, category: row.category, scripts: JSON.parse(row.scripts) as string[],
        is_variable: row.isVariable, is_user_font: true, popularity: row.popularity,
        variants: row.variants.map((v) => ({ weight: v.weight, style: v.style as 'normal' | 'italic', url: `/media/${v.filePath}` })),
      })),
    })
  },

  async 'POST /fonts/mine'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    rateLimit('upload', user.id, 60, 60_000)
    const form = await req.formData()
    const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
    if (files.length === 0) throw new HttpError(400, 'validation_error', 'Choose font files to upload.', { fields: { files: ['Required.'] } })
    if (files.length > 5) throw new HttpError(400, 'validation_error', 'Upload at most 5 files at once.')
    const familyInput = typeof form.get('family') === 'string' ? (form.get('family') as string).trim().slice(0, 120) : ''
    const category = typeof form.get('category') === 'string' ? (form.get('category') as string) : 'sans-serif'
    const family = familyInput || files[0].name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 120) || 'My font'
    const taken = await db.fontFamily.findFirst({ where: { family, source: 'upload', ownerId: user.id } })
    if (taken) throw new HttpError(400, 'font_name_taken', 'You already uploaded a font family with that name.', { fields: { family: ['Name already used.'] } })
    const mineCount = await db.fontFamily.count({ where: { source: 'upload', ownerId: user.id } })
    if (mineCount >= 50) throw new HttpError(400, 'font_limit_reached', 'You can upload at most 50 font families.')
    const created = await db.fontFamily.create({
      data: {
        family, slug: family.toLowerCase().replace(/[^a-z0-9]+/g, '-'), category,
        scripts: JSON.stringify(['latin']), isVariable: false, popularity: 1, source: 'upload', ownerId: user.id, license: 'Upload',
      },
    })
    for (const file of files) {
      const weightMatch = file.name.match(/(\d{3})/)
      const style = /italic/i.test(file.name) ? 'italic' : 'normal'
      const weight = weightMatch ? Number(weightMatch[1]) : 400
      const saved = await saveUpload(file, `fonts/user/${user.id}`, ['font/woff2', 'font/woff', 'font/ttf', 'font/otf', 'application/octet-stream'], 5 * 1024 * 1024)
      await db.fontVariant.create({
        data: { familyId: created.id, weight, style, subset: 'latin', unicodeRange: '', filePath: saved.path, format: saved.path.split('.').pop() ?? 'ttf', size: saved.bytes },
      })
    }
    const variants = await db.fontVariant.findMany({ where: { familyId: created.id } })
    return jsonResponse({
      id: created.id, family: created.family, category: created.category, scripts: ['latin'], is_variable: false, is_user_font: true, popularity: 1,
      variants: variants.map((v) => ({ weight: v.weight, style: v.style as 'normal' | 'italic', url: `/media/${v.filePath}` })),
    }, { status: 201 })
  },

  async 'DELETE /fonts/mine/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const row = await db.fontFamily.findUnique({ where: { id: params.id } })
    if (!row || row.ownerId !== user.id) throw new HttpError(404, 'not_found', 'That font does not exist.')
    await db.fontFamily.delete({ where: { id: row.id } })
    return new NextResponse(null, { status: 204 })
  },
}

// ---------- config / stock / ai / exports ----------

export function configPayload(origin: string): Record<string, unknown> {
  const model = process.env.SYNKRA_BG_MODEL_FILE
    ? {
        id: 'u2netp',
        name: 'u2netp (in your browser)',
        url: '/media/models/u2netp.onnx',
        bytes: Number(process.env.SYNKRA_BG_MODEL_BYTES ?? 0),
        sha256: process.env.SYNKRA_BG_MODEL_SHA256 ?? '',
        input: { name: 'input', size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], rescale: '255' },
        output: 'output',
      }
    : null
  return {
    google_client_id: process.env.SYNKRA_GOOGLE_CLIENT_ID ?? '',
    features: {
      stock_photos: Boolean(process.env.UNSPLASH_ACCESS_KEY || process.env.PEXELS_API_KEY || process.env.PIXABAY_API_KEY),
      server_pdf: false,
      google_login: false,
      email_verification: false,
      background_removal: Boolean(model),
      realtime: process.env.SYNKRA_REALTIME_ENABLED !== 'false',
      mcp: false,
      ai_providers: false,
    },
    limits: {
      max_upload_bytes: LIMITS.maxUploadBytes,
      max_pages: LIMITS.maxPages,
      max_document_bytes: LIMITS.maxDocumentBytes,
      realtime_max_participants: LIMITS.realtimeMaxParticipants,
      bulk_fill_max_rows: LIMITS.bulkFillMaxRows,
    },
    assets: { background_removal_model: model },
    exports: { filename_style: 'simple', filename_timestamp: false },
    ai: { user_providers: 'off', offsite_notice: 'The picture would be processed outside this installation.' },
    site: { origin, contact: 'design@synkra.co.za' },
  }
}

export const miscHandlers = {
  async 'GET /health'(): Promise<NextResponse> {
    await db.$queryRaw`SELECT 1`
    return jsonResponse({ status: 'ok', app: 'synkra-design' })
  },

  async 'GET /config'(req: NextRequest): Promise<NextResponse> {
    return jsonResponse(configPayload(req.nextUrl.origin))
  },

  async 'GET /size-presets'(): Promise<NextResponse> {
    const { readFile } = await import('fs/promises')
    const { join } = await import('path')
    try {
      const raw = await readFile(join(process.cwd(), 'content', 'size_presets.json'), 'utf8')
      return jsonResponse(JSON.parse(raw))
    } catch {
      return jsonResponse({ version: 1, groups: [] })
    }
  },

  async 'GET /stock/providers'(): Promise<NextResponse> {
    return jsonResponse({ providers: [], all: [], default: '' })
  },

  async 'GET /stock/audio/info'(): Promise<NextResponse> {
    return jsonResponse({ configured: false })
  },

  async 'GET /ai/models'(req: NextRequest): Promise<NextResponse> {
    await requireUser(req)
    const config = configPayload(req.nextUrl.origin) as { assets?: { background_removal_model: unknown } }
    const models = config.assets?.background_removal_model
      ? [{ id: 'device', label: 'On this device', task: 'background-removal', kind: 'device', provider_name: 'This browser', owner: 'device', sends_offsite: false }]
      : []
    return jsonResponse({ task: req.nextUrl.searchParams.get('task') ?? 'background-removal', models })
  },

  async 'POST /exports/pdf'(): Promise<NextResponse> {
    throw new HttpError(501, 'server_pdf_disabled', 'Server-side print PDFs are not enabled on this installation. Use the browser PDF export.')
  },
}

export { currentUser, clientKey }
