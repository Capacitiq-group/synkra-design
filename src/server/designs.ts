import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { Design, Asset, Prisma } from '@prisma/client'
import {
  HttpError, jsonResponse, readJson, checkCsrf, requireUser, currentUser, rateLimit, clientKey,
  assertDocumentSaveable, parseJsonColumn, LIMITS,
} from './core'
import { saveUpload } from './files'

type AuthenticatedUser = Awaited<ReturnType<typeof requireUser>>

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/
const AVERAGE_GLYPH_WIDTH = 0.52
const FONT_SIZE_MULT = 1.13
const MIN_FONT_SIZE = 4
const MAX_FONT_SIZE = 999

function posFloat(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function estimateTextLines(text: string, width: number, fontSize: number, weight = 400): number {
  const glyph = fontSize * AVERAGE_GLYPH_WIDTH * (weight >= 600 ? 1.06 : 1)
  const perLine = Math.max(1, Math.floor(width / Math.max(glyph, 0.1)))
  let lines = 0
  for (const paragraph of String(text).split('\n')) {
    let length = 0
    let count = 1
    for (const word of paragraph.split(' ')) {
      const needed = length === 0 ? word.length : length + 1 + word.length
      if (needed <= perLine) {
        length = needed
        continue
      }
      if (length) count += 1
      length = word.length
      while (length > perLine) {
        count += 1
        length -= perLine
      }
    }
    lines += count
  }
  return Math.max(1, lines)
}

function textHeight(lines: number, fontSize: number, lineHeight: number): number {
  return fontSize * FONT_SIZE_MULT * (1 + (lines - 1) * lineHeight)
}

function fitFontSize(text: string, width: number, height: number, fontSize: number, weight = 400, lineHeight = 1.16, minFontSize?: number): number {
  const target = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSize))
  const rawMin = minFontSize ?? Math.max(MIN_FONT_SIZE, Math.round(target * 0.5))
  const floor = Math.min(target, Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, rawMin)))
  const fits = (size: number): boolean => textHeight(estimateTextLines(text, width, size, weight), size, lineHeight) <= height + 1e-3
  if (fits(target) || target <= floor) return Math.round(target * 1000) / 1000
  let low = 1
  let high = Math.ceil(target - floor)
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (fits(Math.max(floor, target - mid))) high = mid
    else low = mid + 1
  }
  return Math.round(Math.max(floor, target - low) * 1000) / 1000
}

type DocObject = Record<string, any>
type Doc = { pages?: any[]; width?: number; height?: number; unit?: string; schemaVersion?: number; meta?: Record<string, unknown> }

function readDoc(json: string): Doc {
  try {
    return JSON.parse(json) as Doc
  } catch {
    return {}
  }
}

function readFit(value: unknown): { mode: 'shrink'; minFontSize?: number } | null {
  if (!value || typeof value !== 'object') return null
  const fit = value as Record<string, unknown>
  if (fit.mode !== 'shrink') return null
  if (typeof fit.minFontSize === 'number' && Number.isFinite(fit.minFontSize) && fit.minFontSize >= MIN_FONT_SIZE) {
    return { mode: 'shrink', minFontSize: Math.min(MAX_FONT_SIZE, fit.minFontSize) }
  }
  return { mode: 'shrink' }
}

function textOverflows(obj: DocObject): boolean {
  const fit = readFit(obj.fit)
  const size = typeof obj.fontSize === 'number' && Number.isFinite(obj.fontSize) && obj.fontSize >= 1 ? obj.fontSize : null
  if (!fit || size === null) return false
  const text = String(obj.text ?? '')
  const width = posFloat(obj.width, 200)
  const leading = posFloat(obj.lineHeight, 1.16)
  const height = posFloat(obj.height, textHeight(1, size, leading))
  const weight = Math.round(posFloat(obj.fontWeight, 400))
  const fitted = fitFontSize(text, width, height, size, weight, leading, fit.minFontSize)
  const lines = estimateTextLines(text, width, fitted, weight)
  return textHeight(lines, fitted, leading) > height + 1e-3
}

function objectKind(obj: DocObject): string {
  const type = String(obj.type ?? '').toLowerCase()
  if (obj.qr) return 'qr'
  if (obj.isPlaceholder === true) return 'placeholder'
  if (typeof obj.elementId === 'string') return 'element'
  if (type === 'image') return 'image'
  if (['textbox', 'itext', 'text'].includes(type)) return 'text'
  if (['doryline', 'line'].includes(type)) return 'line'
  if (['rect', 'ellipse', 'circle', 'triangle', 'polygon', 'polyline', 'path'].includes(type)) return 'shape'
  if (['group', 'activeselection'].includes(type)) return 'group'
  return 'unknown'
}

function walkObjects(objects: unknown, visit: (obj: DocObject) => void): void {
  if (!Array.isArray(objects)) return
  for (const obj of objects) {
    if (obj && typeof obj === 'object') {
      visit(obj as DocObject)
      if (Array.isArray((obj as DocObject).objects)) walkObjects((obj as DocObject).objects, visit)
    }
  }
}

interface FieldEntry {
  key: string | null
  type: 'text' | 'image' | 'color'
  label: string | null
  pages: number[]
  object_ids: string[]
  current: unknown
  fit: { mode: 'shrink'; minFontSize?: number } | null
  overflow: boolean
}

function readFieldTag(value: unknown): { key: string; type: 'text' | 'image' | 'color'; label?: string } | null {
  if (!value || typeof value !== 'object') return null
  const tag = value as Record<string, unknown>
  const key = tag.key
  const type = tag.type
  if (typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(key)) return null
  if (type !== 'text' && type !== 'image' && type !== 'color') return null
  return { key, type, ...(typeof tag.label === 'string' && tag.label ? { label: tag.label } : {}) }
}

function currentOf(obj: DocObject, type: string): unknown {
  if (type === 'text') return String(obj.text ?? '')
  if (type === 'image') return { asset_id: obj.assetId ?? null, url: obj.docSrc ?? obj.src ?? null }
  return typeof obj.fill === 'string' ? obj.fill : null
}

function listFields(document: Doc): FieldEntry[] {
  const byKey = new Map<string, FieldEntry>()
  const out: FieldEntry[] = []
  const pages = Array.isArray(document.pages) ? document.pages : []
  pages.forEach((page, index) => {
    const number = index + 1
    if (!page || typeof page !== 'object') return
    walkObjects((page as DocObject).objects, (obj) => {
      const tag = readFieldTag(obj.field)
      if (!tag) {
        if (objectKind(obj) === 'placeholder') {
          out.push({ key: null, type: 'image', label: null, pages: [number], object_ids: [obj.id], current: currentOf(obj, 'image'), fit: null, overflow: false })
        }
        return
      }
      const entry = byKey.get(tag.key)
      if (!entry) {
        const created: FieldEntry = {
          key: tag.key, type: tag.type, label: tag.label ?? null, pages: [number], object_ids: [obj.id],
          current: currentOf(obj, tag.type), fit: tag.type === 'text' ? readFit(obj.fit) : null, overflow: tag.type === 'text' ? textOverflows(obj) : false,
        }
        byKey.set(tag.key, created)
        out.push(created)
      } else if (entry.type === tag.type && !entry.pages.includes(number)) {
        entry.object_ids.push(obj.id)
        entry.pages.push(number)
        if (tag.type === 'text') {
          if (entry.fit === null) entry.fit = readFit(obj.fit)
          if (textOverflows(obj)) entry.overflow = true
        }
      }
    })
  })
  return out
}

// ---------- serializers ----------

export function designSummary(design: Design): Record<string, unknown> {
  return {
    id: design.id,
    title: design.title,
    width: design.width,
    height: design.height,
    preset: design.preset,
    page_count: design.pageCount,
    thumbnail_url: design.thumbnailPath ? `/media/${design.thumbnailPath}` : null,
    folder: design.folderId,
    starred: design.starred,
    revision: design.revision,
    created_at: design.createdAt.toISOString(),
    updated_at: design.updatedAt.toISOString(),
    trashed_at: design.trashedAt?.toISOString() ?? null,
  }
}

export function designFull(design: Design): Record<string, unknown> {
  return { ...designSummary(design), document: readDoc(design.document) }
}

function serializeAsset(asset: Asset): Record<string, unknown> {
  const meta = parseJsonColumn<Record<string, unknown>>(asset.meta, {})
  const attribution = meta.provider
    ? {
        provider: String(meta.provider),
        author: String(meta.author ?? ''),
        author_url: String(meta.author_url ?? ''),
        source_url: String(meta.source_url ?? ''),
      }
    : null
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    url: `/media/${asset.filePath}`,
    thumb_url: asset.thumbPath ? `/media/${asset.thumbPath}` : `/media/${asset.filePath}`,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    mime: asset.mime,
    tags: parseJsonColumn<string[]>(asset.tags, []),
    attribution,
    duration_ms: asset.durationMs ?? null,
    created_at: asset.createdAt.toISOString(),
  }
}

async function getOwnedDesign(req: NextRequest, id: string): Promise<{ user: AuthenticatedUser; design: Design }> {
  const user = await requireUser(req)
  const design = await db.design.findUnique({ where: { id } })
  if (!design || design.ownerId !== user.id) throw new HttpError(404, 'not_found', 'That design does not exist.')
  return { user, design }
}

function orderingToPrisma(ordering: string | null): Prisma.DesignOrderByWithRelationInput {
  switch (ordering) {
    case 'updated_at': return { updatedAt: 'asc' }
    case 'title': return { title: 'asc' }
    case '-title': return { title: 'desc' }
    case '-created_at': return { createdAt: 'desc' }
    case '-updated_at':
    default: return { updatedAt: 'desc' }
  }
}

async function thumbnailFromUpload(req: NextRequest, design: Design): Promise<string | null> {
  const form = await req.formData()
  const image = form.get('image')
  if (!(image instanceof File) || image.size === 0) throw new HttpError(400, 'validation_error', 'Send the thumbnail as the `image` field.', { fields: { image: ['Required.'] } })
  if (image.size > LIMITS.maxThumbnailBytes) throw new HttpError(400, 'validation_error', 'The thumbnail is too large.', { fields: { image: ['Thumbnails can be at most 2 MB.'] } })
  const saved = await saveUpload(image, `designs/${design.ownerId}`, ['image/png', 'image/jpeg', 'image/webp'], LIMITS.maxThumbnailBytes)
  return saved.path
}

// ---------- handlers ----------

export const designHandlers = {
  async 'GET /designs'(req: NextRequest): Promise<NextResponse> {
    const user = await requireUser(req)
    const q = req.nextUrl.searchParams.get('q')?.trim() || null
    const folder = req.nextUrl.searchParams.get('folder')
    const starred = req.nextUrl.searchParams.get('starred') === 'true'
    const trashed = req.nextUrl.searchParams.get('trashed') === 'true'
    const ordering = orderingToPrisma(req.nextUrl.searchParams.get('ordering'))
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('page_size') ?? 24) || 24))
    const where: Prisma.DesignWhereInput = {
      ownerId: user.id,
      trashedAt: trashed ? { not: null } : null,
      ...(starred ? { starred: true } : {}),
      ...(q ? { title: { contains: q } } : {}),
      ...(folder === 'root' ? { folderId: null } : folder ? { folderId: folder } : {}),
    }
    const [total, rows] = await Promise.all([
      db.design.count({ where }),
      db.design.findMany({ where, orderBy: ordering, skip: (page - 1) * pageSize, take: pageSize }),
    ])
    const base = `${req.nextUrl.pathname}?${req.nextUrl.searchParams.toString()}`
    const pageUrl = (n: number) => {
      const params = new URLSearchParams(req.nextUrl.searchParams)
      params.set('page', String(n))
      return `${req.nextUrl.pathname}?${params.toString()}`
    }
    return jsonResponse({
      count: total,
      next: page * pageSize < total ? pageUrl(page + 1) : null,
      previous: page > 1 ? pageUrl(page - 1) : null,
      results: rows.map(designSummary),
    })
  },

  async 'POST /designs'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const body = await readJson(req)
    let document = body.document ?? null
    let title = typeof body.title === 'string' ? body.title.slice(0, 200) : 'Untitled design'
    let width = typeof body.width === 'number' ? Math.round(body.width) : 1080
    let height = typeof body.height === 'number' ? Math.round(body.height) : 1080
    let preset = typeof body.preset === 'string' ? body.preset : ''
    let pageCount = 1
    if (typeof body.template === 'string' && body.template) {
      const template = await db.template.findUnique({ where: { slug: body.template } })
      if (!template || !template.isPublished) throw new HttpError(404, 'not_found', 'That template does not exist.')
      const tplDoc = readDoc(template.document)
      const { pages } = assertDocumentSaveable(tplDoc)
      document = tplDoc
      title = typeof body.title === 'string' ? title : template.title
      width = template.width
      height = template.height
      preset = template.preset
      pageCount = pages.length
      await db.template.update({ where: { id: template.id }, data: { useCount: { increment: 1 } } })
    }
    if (document !== null && typeof document === 'object') {
      const checked = assertDocumentSaveable(document)
      pageCount = checked.pages
      const doc = document as Doc
      if (typeof doc.width === 'number') width = Math.round(doc.width)
      if (typeof doc.height === 'number') height = Math.round(doc.height)
    } else {
      const blank = { schemaVersion: 1, width, height, unit: 'px', pages: [{ id: crypto.randomUUID(), background: { type: 'solid', color: '#ffffff' }, objects: [] }] }
      document = blank
    }
    const count = await db.design.count({ where: { ownerId: user.id, trashedAt: null } })
    if (count >= LIMITS.maxDesignsPerUser) throw new HttpError(400, 'too_many_designs', 'You have reached the design limit of this account.')
    const design = await db.design.create({
      data: {
        ownerId: user.id, title, width, height, preset, pageCount,
        document: JSON.stringify(document),
        folderId: typeof body.folder === 'string' ? body.folder : null,
      },
    })
    return jsonResponse(designFull(design), { status: 201 })
  },

  async 'GET /designs/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const { design } = await getOwnedDesign(req, params.id)
    return jsonResponse(designFull(design))
  },

  async 'PATCH /designs/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design } = await getOwnedDesign(req, params.id)
    const body = await readJson(req)
    const data: Prisma.DesignUpdateInput = {}
    if (typeof body.title === 'string') data.title = body.title.slice(0, 200)
    if (typeof body.starred === 'boolean') data.starred = body.starred
    if (body.folder === null || typeof body.folder === 'string') data.folder = body.folder === null ? { disconnect: true } : { connect: { id: body.folder } }
    if (body.document !== undefined) {
      const { pages } = assertDocumentSaveable(body.document)
      data.document = JSON.stringify(body.document)
      data.pageCount = pages
      const doc = body.document as Doc
      data.width = typeof doc.width === 'number' ? Math.round(doc.width) : design.width
      data.height = typeof doc.height === 'number' ? Math.round(doc.height) : design.height
    }
    if (typeof body.base_revision === 'number' && body.base_revision !== design.revision) {
      throw new HttpError(409, 'revision_conflict', 'This design changed elsewhere while you were editing.', {
        data: { current: { revision: design.revision, updated_at: design.updatedAt.toISOString() } },
      })
    }
    const updated = await db.design.update({ where: { id: design.id }, data: { ...data, revision: { increment: 1 } } })
    return jsonResponse(designFull(updated))
  },

  async 'DELETE /designs/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design } = await getOwnedDesign(req, params.id)
    const permanent = req.nextUrl.searchParams.get('permanent') === 'true'
    if (permanent) {
      if (design.trashedAt === null) throw new HttpError(400, 'not_trashed', 'Only trashed designs can be deleted for good.')
      await db.design.delete({ where: { id: design.id } })
    } else {
      await db.design.update({ where: { id: design.id }, data: { trashedAt: new Date() } })
    }
    return new NextResponse(null, { status: 204 })
  },

  async 'POST /designs/:id/restore'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design } = await getOwnedDesign(req, params.id)
    const updated = await db.design.update({ where: { id: design.id }, data: { trashedAt: null } })
    return jsonResponse(designFull(updated))
  },

  async 'POST /designs/:id/duplicate'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design } = await getOwnedDesign(req, params.id)
    const copy = await db.design.create({
      data: {
        ownerId: design.ownerId, title: design.title.startsWith('Copy of') ? design.title : `Copy of ${design.title}`,
        width: design.width, height: design.height, preset: design.preset, document: design.document,
        pageCount: design.pageCount, thumbnailPath: design.thumbnailPath, folderId: design.folderId, starred: design.starred,
      },
    })
    return jsonResponse(designFull(copy), { status: 201 })
  },

  async 'PUT /designs/:id/thumbnail'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design } = await getOwnedDesign(req, params.id)
    const path = await thumbnailFromUpload(req, design)
    const updated = await db.design.update({ where: { id: design.id }, data: { thumbnailPath: path } })
    return jsonResponse({ thumbnail_url: updated.thumbnailPath ? `/media/${updated.thumbnailPath}` : null })
  },

  async 'POST /designs/bulk'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const body = await readJson(req)
    const ids: string[] = Array.isArray(body.ids) ? body.ids : []
    const action = String(body.action ?? '')
    if (ids.length === 0) return jsonResponse({ affected: 0 })
    const owned = await db.design.findMany({ where: { id: { in: ids }, ownerId: user.id } })
    const ownedIds = owned.map((d) => d.id)
    switch (action) {
      case 'trash':
        await db.design.updateMany({ where: { id: { in: ownedIds } }, data: { trashedAt: new Date() } })
        break
      case 'restore':
        await db.design.updateMany({ where: { id: { in: ownedIds } }, data: { trashedAt: null } })
        break
      case 'delete':
        await db.design.deleteMany({ where: { id: { in: ownedIds }, NOT: { trashedAt: null } } })
        break
      case 'star':
        await db.design.updateMany({ where: { id: { in: ownedIds } }, data: { starred: true } })
        break
      case 'unstar':
        await db.design.updateMany({ where: { id: { in: ownedIds } }, data: { starred: false } })
        break
      case 'move':
        await db.design.updateMany({ where: { id: { in: ownedIds } }, data: { folderId: body.folder ?? null } })
        break
      default:
        throw new HttpError(400, 'validation_error', 'Unknown bulk action.', { fields: { action: ['Unknown action.'] } })
    }
    return jsonResponse({ affected: ownedIds.length })
  },

  async 'DELETE /designs/trash'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    await db.design.deleteMany({ where: { ownerId: user.id, NOT: { trashedAt: null } } })
    return new NextResponse(null, { status: 204 })
  },

  async 'GET /designs/:id/fields'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const { design } = await getOwnedDesign(req, params.id)
    return jsonResponse({ fields: listFields(readDoc(design.document)) })
  },

  async 'POST /designs/:id/fill'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { user, design } = await getOwnedDesign(req, params.id)
    const body = await readJson(req)
    const result = await fillDesign(user.id, design, body.values ?? {}, body.as_copy === true, body.name)
    return jsonResponse(result, { status: body.as_copy === true ? 201 : 200 })
  },

  async 'POST /designs/:id/bulk-fill'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { user, design } = await getOwnedDesign(req, params.id)
    const body = await readJson(req)
    const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : []
    if (rows.length > LIMITS.bulkFillMaxRows) throw new HttpError(400, 'too_many_rows', `At most ${LIMITS.bulkFillMaxRows} rows per request.`)
    rateLimit('bulk_fill', user.id, 120, 60_000)
    const folderName = typeof body.folder === 'string' && body.folder.trim() ? body.folder.trim() : null
    let folderId: string | null = null
    if (folderName) {
      const existing = await db.folder.findFirst({ where: { ownerId: user.id, name: folderName, parentId: null } })
      folderId = existing?.id ?? (await db.folder.create({ data: { ownerId: user.id, name: folderName } })).id
    }
    const baseTitle = design.title
    const used = new Set<string>()
    const results: unknown[] = []
    let created = 0
    for (let i = 0; i < rows.length; i += 1) {
      const rowNumber = Array.isArray(body.row_numbers) && typeof body.row_numbers[i] === 'number' ? body.row_numbers[i] : i + 1
      try {
        const pattern = typeof body.name_pattern === 'string' && body.name_pattern.trim() ? body.name_pattern.trim() : `${baseTitle} - {n}`
        let title = pattern.replace('{n}', String(i + 1))
        let suffix = 2
        while (used.has(title)) title = `${pattern.replace('{n}', String(i + 1))} (${suffix++})`
        used.add(title)
        const copy = await db.design.create({
          data: {
            ownerId: user.id, title, width: design.width, height: design.height, preset: design.preset,
            document: design.document, pageCount: design.pageCount, thumbnailPath: design.thumbnailPath, folderId,
          },
        })
        const fill = await applyFieldValues(user.id, copy, rows[i] as Record<string, unknown>)
        results.push({ row: rowNumber, ok: true, design_id: copy.id, title, filled: fill.filled, skipped: fill.skipped, overflow: fill.overflow })
        created += 1
      } catch (error) {
        results.push({ row: rowNumber, ok: false, error: error instanceof Error ? error.message.split(': ').pop() : 'This row could not be filled.' })
      }
    }
    return jsonResponse({ created, rows: results })
  },

  // ---------- versions ----------

  async 'GET /designs/:id/versions'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const { design } = await getOwnedDesign(req, params.id)
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? 1) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('page_size') ?? 30) || 30))
    const [total, rows] = await Promise.all([
      db.designVersion.count({ where: { designId: design.id } }),
      db.designVersion.findMany({ where: { designId: design.id }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ])
    const params0 = new URLSearchParams(req.nextUrl.searchParams)
    const pageUrl = (n: number) => {
      const p = new URLSearchParams(params0)
      p.set('page', String(n))
      return `${req.nextUrl.pathname}?${p.toString()}`
    }
    return jsonResponse({
      count: total,
      next: page * pageSize < total ? pageUrl(page + 1) : null,
      previous: page > 1 ? pageUrl(page - 1) : null,
      results: rows.map((row) => ({
        id: row.id, label: row.label, is_auto: row.isAuto, page_count: row.pageCount,
        thumbnail_url: row.thumbnailPath ? `/media/${row.thumbnailPath}` : null, created_at: row.createdAt.toISOString(),
      })),
    })
  },

  async 'POST /designs/:id/versions'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design } = await getOwnedDesign(req, params.id)
    const body = await readJson(req)
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 120) : ''
    const manualCount = await db.designVersion.count({ where: { designId: design.id, isAuto: false } })
    if (manualCount >= 100) throw new HttpError(400, 'too_many_versions', 'A design can keep at most 100 saved versions.')
    const version = await db.designVersion.create({
      data: { designId: design.id, label: label || 'Saved version', isAuto: false, document: design.document, pageCount: design.pageCount, thumbnailPath: design.thumbnailPath },
    })
    return jsonResponse({
      id: version.id, label: version.label, is_auto: false, page_count: version.pageCount,
      thumbnail_url: version.thumbnailPath ? `/media/${version.thumbnailPath}` : null, created_at: version.createdAt.toISOString(),
    }, { status: 201 })
  },

  async 'GET /designs/:id/versions/:vid'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const { design } = await getOwnedDesign(req, params.id)
    const version = await db.designVersion.findUnique({ where: { id: params.vid } })
    if (!version || version.designId !== design.id) throw new HttpError(404, 'not_found', 'That version does not exist.')
    return jsonResponse({
      id: version.id, label: version.label, is_auto: version.isAuto, page_count: version.pageCount,
      thumbnail_url: version.thumbnailPath ? `/media/${version.thumbnailPath}` : null,
      created_at: version.createdAt.toISOString(), document: readDoc(version.document),
    })
  },

  async 'POST /designs/:id/versions/:vid/restore'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design } = await getOwnedDesign(req, params.id)
    const version = await db.designVersion.findUnique({ where: { id: params.vid } })
    if (!version || version.designId !== design.id) throw new HttpError(404, 'not_found', 'That version does not exist.')
    // Keep a snapshot of the current state first, like the backend does.
    await db.designVersion.create({
      data: { designId: design.id, label: 'Before restore', isAuto: true, document: design.document, pageCount: design.pageCount, thumbnailPath: design.thumbnailPath },
    })
    const { pages } = assertDocumentSaveable(readDoc(version.document))
    const updated = await db.design.update({
      where: { id: design.id },
      data: { document: version.document, pageCount: pages, revision: { increment: 1 }, thumbnailPath: version.thumbnailPath },
    })
    return jsonResponse(designFull(updated))
  },
}

// ---------- fill ----------

async function resolveImageSource(ownerId: string, value: unknown): { src: string; assetId?: string } {
  if (typeof value === 'string') {
    const text = value.trim()
    if (/^https?:\/\//i.test(text)) {
      // URL images: the server copies them into the user's uploads (URL_IMAGE_UPLOADS default on).
      const response = await fetch(text, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error('That picture link could not be downloaded.')
      const blob = await response.blob()
      if (blob.size > LIMITS.maxUploadBytes) throw new Error('The linked picture is too large.')
      const saved = await saveUpload(new File([blob], 'linked-image', { type: blob.type || 'image/png' }), `assets/${ownerId}`, undefined, LIMITS.maxUploadBytes)
      return { src: `/media/${saved.path}` }
    }
    const asset = await db.asset.findUnique({ where: { id: text } })
    if (asset && asset.ownerId === ownerId && asset.kind !== 'audio') return { src: `/media/${asset.filePath}`, assetId: asset.id }
    const byName = await db.asset.findFirst({ where: { ownerId, name: { equals: text, }, kind: { not: 'audio' } }, orderBy: { createdAt: 'desc' } })
    if (byName) return { src: `/media/${byName.filePath}`, assetId: byName.id }
    throw new Error(`There is no picture named ${JSON.stringify(text)} in your uploads.`)
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.asset_id === 'string') {
      const asset = await db.asset.findUnique({ where: { id: v.asset_id } })
      if (asset && asset.ownerId === ownerId) return { src: `/media/${asset.filePath}`, assetId: asset.id }
      throw new Error('That upload does not exist.')
    }
    if (typeof v.element_id === 'string') {
      const element = await db.element.findUnique({ where: { id: v.element_id } })
      if (element) return { src: `/media/${element.svgPath}` }
      throw new Error('That element does not exist.')
    }
    if (typeof v.url === 'string' && v.url) {
      if (/^https?:\/\//i.test(v.url)) return resolveImageSource(ownerId, v.url)
      return { src: v.url }
    }
  }
  throw new Error('An image value is a link, an upload name or {asset_id | element_id | url}.')
}

async function applyFieldValues(ownerId: string, design: Design, values: Record<string, unknown>): Promise<{ filled: string[]; skipped: string[]; overflow: string[] }> {
  const doc = readDoc(design.document)
  const entries = listFields(doc)
  const filled: string[] = []
  const skipped: string[] = []
  const overflow: string[] = []
  for (const entry of entries) {
    if (entry.key === null) continue
    if (!(entry.key in values) || values[entry.key] === null || values[entry.key] === '') {
      skipped.push(entry.key)
      continue
    }
    const value = values[entry.key]
    for (const objectId of entry.object_ids) {
      for (const page of doc.pages ?? []) {
        walkObjects((page as DocObject)?.objects, (obj) => {
          if (obj.id !== objectId) return
          if (entry.type === 'text') {
            if (typeof value !== 'string' && typeof value !== 'number') throw new Error('A text value is a string.')
            obj.text = String(value)
            const fit = readFit(obj.fit)
            if (fit) {
              const size = posFloat(obj.fontSize, 40)
              const width = posFloat(obj.width, 200)
              const height = posFloat(obj.height, textHeight(1, size, posFloat(obj.lineHeight, 1.16)))
              obj.fontSize = fitFontSize(String(value), width, height, size, Math.round(posFloat(obj.fontWeight, 400)), posFloat(obj.lineHeight, 1.16), fit.minFontSize)
            }
          } else if (entry.type === 'color') {
            if (typeof value !== 'string' || !HEX_COLOR.test(value.trim())) throw new Error('A color value is a #hex string, e.g. #ff6600.')
            obj.fill = value.trim()
          } else {
            const source = resolveImageSource(ownerId, value)
            obj.src = source.src
            delete obj.docSrc
            if (source.assetId) obj.assetId = source.assetId
          }
        })
      }
    }
    filled.push(entry.key)
  }
  const { pages } = assertDocumentSaveable(doc)
  await db.design.update({ where: { id: design.id }, data: { document: JSON.stringify(doc), pageCount: pages, revision: { increment: 1 } } })
  return { filled, skipped, overflow }
}

async function fillDesign(ownerId: string, design: Design, values: Record<string, unknown>, asCopy: boolean, name: unknown): Promise<unknown> {
  if (!asCopy) {
    const fill = await applyFieldValues(ownerId, design, values)
    const updated = await db.design.findUnique({ where: { id: design.id } })
    return { ...designFull(updated!), filled: fill.filled, skipped: fill.skipped }
  }
  const title = typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : design.title
  const copy = await db.design.create({
    data: {
      ownerId, title, width: design.width, height: design.height, preset: design.preset,
      document: design.document, pageCount: design.pageCount, thumbnailPath: design.thumbnailPath, folderId: design.folderId,
    },
  })
  await applyFieldValues(ownerId, copy, values)
  const fresh = await db.design.findUnique({ where: { id: copy.id } })
  return designFull(fresh!)
}

// ---------- folders ----------

function folderJson(row: { id: string; name: string; parentId: string | null; createdAt: Date }, designCount: number) {
  return { id: row.id, name: row.name, parent: row.parentId, design_count: designCount, created_at: row.createdAt.toISOString() }
}

export const folderHandlers = {
  async 'GET /folders'(req: NextRequest): Promise<NextResponse> {
    const user = await requireUser(req)
    const rows = await db.folder.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: 'asc' }, take: 100 })
    const counts = await db.design.groupBy({ by: ['folderId'], where: { ownerId: user.id, trashedAt: null }, _count: { _all: true } })
    const countByFolder = new Map(counts.map((c) => [c.folderId, c._count._all]))
    return jsonResponse({ results: rows.map((row) => folderJson(row, countByFolder.get(row.id) ?? 0)), count: rows.length })
  },

  async 'POST /folders'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const body = await readJson(req)
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
    if (!name) throw new HttpError(400, 'validation_error', 'Give the folder a name.', { fields: { name: ['Required.'] } })
    const clash = await db.folder.findFirst({ where: { ownerId: user.id, name, parentId: typeof body.parent === 'string' ? body.parent : null } })
    if (clash) throw new HttpError(400, 'validation_error', 'You already have a folder with that name here.', { fields: { name: ['Name already used.'] } })
    const row = await db.folder.create({ data: { ownerId: user.id, name, parentId: typeof body.parent === 'string' ? body.parent : null } })
    return jsonResponse(folderJson(row, 0), { status: 201 })
  },

  async 'PATCH /folders/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const row = await db.folder.findUnique({ where: { id: params.id } })
    if (!row || row.ownerId !== user.id) throw new HttpError(404, 'not_found', 'That folder does not exist.')
    const body = await readJson(req)
    const data: Prisma.FolderUpdateInput = {}
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120)
    if (body.parent !== undefined) data.parent = body.parent === null ? { disconnect: true } : { connect: { id: body.parent } }
    const updated = await db.folder.update({ where: { id: row.id }, data })
    return jsonResponse(folderJson(updated, 0))
  },

  async 'DELETE /folders/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const row = await db.folder.findUnique({ where: { id: params.id } })
    if (!row || row.ownerId !== user.id) throw new HttpError(404, 'not_found', 'That folder does not exist.')
    await db.folder.delete({ where: { id: row.id } })
    return new NextResponse(null, { status: 204 })
  },
}

export { listFields, readDoc, serializeAsset }
