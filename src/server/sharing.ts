import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { Design } from '@prisma/client'
import {
  HttpError, jsonResponse, readJson, checkCsrf, requireUser, currentUser, rateLimit, clientKey, randomToken, hashPassword, verifyPassword,
} from './core'
import { readDoc, listFields } from './designs'

type DocObject = Record<string, any>
type Doc = ReturnType<typeof readDoc>

const ROLES = new Set(['view', 'comment', 'edit'])

function serializeLink(row: { id: string; token: string; role: string; isActive: boolean; expiresAt: Date | null; passwordHash: string | null; createdAt: Date }, origin: string) {
  return {
    id: row.id,
    token: row.token,
    role: row.role,
    url: `${origin}/s/${row.token}`,
    is_active: row.isActive,
    expires_at: row.expiresAt?.toISOString() ?? null,
    has_password: row.passwordHash !== null,
    created_at: row.createdAt.toISOString(),
  }
}

async function getOwnedDesign(req: NextRequest, id: string): Promise<{ user: Awaited<ReturnType<typeof requireUser>>; design: Design }> {
  const user = await requireUser(req)
  const design = await db.design.findUnique({ where: { id } })
  if (!design || design.ownerId !== user.id) throw new HttpError(404, 'not_found', 'That design does not exist.')
  return { user, design }
}

/** Resolves a share token into an active link + its design, enforcing expiry and password. */
async function sharedContext(req: NextRequest, token: string, options: { needPassword?: boolean } = {}): Promise<{ link: NonNullable<Awaited<ReturnType<typeof db.shareLink.findUnique>>>; design: Design; role: string }> {
  const link = await db.shareLink.findUnique({ where: { token }, include: { design: true } })
  const lockKey = `share_pw:${token}:${clientKey(req)}`
  if (!link || !link.isActive || !link.design || link.design.trashedAt !== null) {
    rateLimit(lockKey, 'global', 10, 15 * 60_000)
    throw new HttpError(404, 'not_found', 'This link does not work. It may have been revoked.')
  }
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    throw new HttpError(404, 'not_found', 'This link has expired.')
  }
  let role = link.role
  const viewer = await currentUser(req)
  if (viewer && viewer.id === link.design.ownerId) role = 'edit'
  if (link.passwordHash && (options.needPassword || role !== 'edit' || !viewer || viewer.id !== link.design.ownerId)) {
    const provided = req.headers.get('x-share-password') ?? ''
    if (!verifyPassword(provided, link.passwordHash)) {
      rateLimit(lockKey, 'attempt', 10, 15 * 60_000)
      throw new HttpError(viewer || provided ? 403 : 401, 'password_required', 'This link is protected with a password.')
    }
  }
  await db.shareLink.update({ where: { id: link.id }, data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() } })
  return { link, design: link.design, role }
}

function serializeComment(row: { id: string; body: string; pageId: string | null; x: number | null; y: number | null; parentId: string | null; resolved: boolean; createdAt: Date; author: { id: string; displayName: string; avatarPath: string | null } }) {
  return {
    id: row.id,
    author: { id: row.author.id, name: row.author.displayName, avatar_url: row.author.avatarPath ? `/media/${row.author.avatarPath}` : null },
    body: row.body,
    page_id: row.pageId,
    x: row.x,
    y: row.y,
    parent: row.parentId,
    resolved: row.resolved,
    created_at: row.createdAt.toISOString(),
  }
}

async function listComments(designId: string) {
  const rows = await db.comment.findMany({ where: { designId }, include: { author: true }, orderBy: { createdAt: 'asc' }, take: 2000 })
  return { count: rows.length, results: rows.map(serializeComment) }
}

async function createComment(designId: string, authorId: string, body: any): Promise<unknown> {
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) throw new HttpError(400, 'validation_error', 'Write a comment first.', { fields: { body: ['Required.'] } })
  if (text.length > 2000) throw new HttpError(400, 'validation_error', 'Comments can be at most 2000 characters.', { fields: { body: ['Too long.'] } })
  const hasPin = typeof body.page_id === 'string' && typeof body.x === 'number' && typeof body.y === 'number'
  const row = await db.comment.create({
    data: {
      designId, authorId, body: text,
      pageId: hasPin ? body.page_id : (typeof body.page_id === 'string' ? body.page_id : null),
      x: hasPin ? body.x : null,
      y: hasPin ? body.y : null,
      parentId: typeof body.parent === 'string' ? body.parent : null,
    },
    include: { author: true },
  })
  return serializeComment(row)
}

export const shareHandlers = {
  async 'GET /designs/:id/share-links'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const { design } = await getOwnedDesign(req, params.id)
    const rows = await db.shareLink.findMany({ where: { designId: design.id }, orderBy: { createdAt: 'desc' } })
    return jsonResponse({ results: rows.map((row) => serializeLink(row, req.nextUrl.origin)), count: rows.length })
  },

  async 'POST /designs/:id/share-links'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design } = await getOwnedDesign(req, params.id)
    const body = await readJson(req)
    const role = typeof body.role === 'string' && ROLES.has(body.role) ? body.role : 'view'
    const activeCount = await db.shareLink.count({ where: { designId: design.id, isActive: true } })
    if (activeCount >= 20) throw new HttpError(400, 'too_many_links', 'A design can have at most 20 active links.')
    const row = await db.shareLink.create({
      data: {
        designId: design.id,
        token: randomToken(24),
        role,
        isActive: true,
        expiresAt: typeof body.expires_at === 'string' && body.expires_at ? new Date(body.expires_at) : null,
        passwordHash: typeof body.password === 'string' && body.password ? hashPassword(body.password) : null,
        createdBy: design.ownerId,
      },
    })
    return jsonResponse(serializeLink(row, req.nextUrl.origin), { status: 201 })
  },

  async 'PATCH /designs/:id/share-links/:lid'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design } = await getOwnedDesign(req, params.id)
    const row = await db.shareLink.findUnique({ where: { id: params.lid } })
    if (!row || row.designId !== design.id) throw new HttpError(404, 'not_found', 'That link does not exist.')
    const body = await readJson(req)
    const data: Record<string, unknown> = {}
    if (typeof body.role === 'string' && ROLES.has(body.role)) data.role = body.role
    if (typeof body.is_active === 'boolean') data.isActive = body.is_active
    if (body.expires_at !== undefined) data.expiresAt = body.expires_at ? new Date(body.expires_at) : null
    if (body.password !== undefined) data.passwordHash = body.password ? hashPassword(body.password) : null
    const updated = await db.shareLink.update({ where: { id: row.id }, data })
    return jsonResponse(serializeLink(updated, req.nextUrl.origin))
  },

  async 'DELETE /designs/:id/share-links/:lid'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design } = await getOwnedDesign(req, params.id)
    const row = await db.shareLink.findUnique({ where: { id: params.lid } })
    if (!row || row.designId !== design.id) throw new HttpError(404, 'not_found', 'That link does not exist.')
    await db.shareLink.delete({ where: { id: row.id } })
    return new NextResponse(null, { status: 204 })
  },

  // ---------- public shared design ----------

  async 'GET /shared/:token'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const { design, role } = await sharedContext(req, params.token)
    const owner = await db.user.findUnique({ where: { id: design.ownerId } })
    // The owner's uploaded fonts the document uses, so guests can draw the text as the owner sees it.
    const doc = readDoc(design.document)
    const usedFamilies = new Set<string>()
    for (const page of doc.pages ?? []) {
      const stack = [...(((page as DocObject)?.objects as unknown[]) ?? [])]
      while (stack.length > 0) {
        const obj = stack.pop() as DocObject
        if (!obj || typeof obj !== 'object') continue
        if (typeof obj.fontFamily === 'string') usedFamilies.add(obj.fontFamily)
        if (Array.isArray(obj.objects)) stack.push(...obj.objects)
      }
    }
    const fontRows = await db.fontFamily.findMany({
      where: { source: 'upload', ownerId: design.ownerId, family: { in: [...usedFamilies] } },
      include: { variants: true },
    })
    const fonts = fontRows.map((family) => ({
      id: family.id, family: family.family, category: family.category, scripts: JSON.parse(family.scripts) as string[],
      is_variable: family.isVariable, is_user_font: true, popularity: family.popularity,
      variants: family.variants.map((v) => ({
        weight: v.weight, style: v.style as 'normal' | 'italic', url: `/media/${v.filePath}`,
        subsets: [{ subset: v.subset, url: `/media/${v.filePath}` }],
      })),
      unicode_ranges: Object.fromEntries(family.variants.map((v) => [v.subset, v.unicodeRange])),
    }))
    return jsonResponse({
      design_id: design.id,
      role,
      title: design.title,
      width: design.width,
      height: design.height,
      revision: design.revision,
      owner: { name: owner?.displayName ?? '', avatar_url: owner?.avatarPath ? `/media/${owner.avatarPath}` : null },
      document: doc,
      fonts,
    })
  },

  async 'PATCH /shared/:token'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design, role } = await sharedContext(req, params.token, { needPassword: true })
    if (role !== 'edit') throw new HttpError(403, 'forbidden', 'This link can view and comment only.')
    const viewer = await currentUser(req)
    if (!viewer) throw new HttpError(401, 'not_authenticated', 'Sign in to save changes through this link.')
    const body = await readJson(req)
    if (typeof body.base_revision === 'number' && body.base_revision !== design.revision) {
      throw new HttpError(409, 'revision_conflict', 'This design changed elsewhere while you were editing.', {
        data: { current: { revision: design.revision, updated_at: design.updatedAt.toISOString() } },
      })
    }
    const document = body.document ?? null
    if (document === null || typeof document !== 'object') throw new HttpError(400, 'invalid_document', 'The design document is malformed.')
    const json = JSON.stringify(document)
    if (json.length > 12 * 1024 * 1024) throw new HttpError(400, 'document_too_large', 'This design is too large to save.')
    const pages = Array.isArray((document as Doc).pages) ? (document as Doc).pages!.length : 1
    const updated = await db.design.update({
      where: { id: design.id },
      data: { document: json, pageCount: pages, revision: { increment: 1 }, ...(typeof body.title === 'string' ? { title: body.title.slice(0, 200) } : {}) },
    })
    return jsonResponse({ revision: updated.revision, updated_at: updated.updatedAt.toISOString() })
  },

  // ---------- comments (owner routes + shared routes) ----------

  async 'GET /designs/:id/comments'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const { design } = await getOwnedDesign(req, params.id)
    return jsonResponse(await listComments(design.id))
  },

  async 'POST /designs/:id/comments'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { user, design } = await getOwnedDesign(req, params.id)
    rateLimit('upload', user.id, 60, 60_000)
    const body = await readJson(req)
    return jsonResponse(await createComment(design.id, user.id, body), { status: 201 })
  },

  async 'PATCH /designs/:id/comments/:cid'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { user, design } = await getOwnedDesign(req, params.id)
    const row = await db.comment.findUnique({ where: { id: params.cid } })
    if (!row || row.designId !== design.id) throw new HttpError(404, 'not_found', 'That comment does not exist.')
    const body = await readJson(req)
    const data: Record<string, unknown> = {}
    if (typeof body.resolved === 'boolean') data.resolved = body.resolved
    if (typeof body.body === 'string' && body.body.trim() && row.authorId === user.id) data.body = body.body.trim().slice(0, 2000)
    if (typeof body.page_id === 'string' && typeof body.x === 'number' && typeof body.y === 'number') {
      data.pageId = body.page_id
      data.x = body.x
      data.y = body.y
    }
    const updated = await db.comment.update({ where: { id: row.id }, data, include: { author: true } })
    return jsonResponse(serializeComment(updated))
  },

  async 'DELETE /designs/:id/comments/:cid'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { user, design } = await getOwnedDesign(req, params.id)
    const row = await db.comment.findUnique({ where: { id: params.cid } })
    if (!row || row.designId !== design.id) throw new HttpError(404, 'not_found', 'That comment does not exist.')
    if (row.authorId !== user.id && design.ownerId !== user.id) throw new HttpError(403, 'forbidden', 'You can delete your own comments only.')
    await db.comment.delete({ where: { id: row.id } })
    return new NextResponse(null, { status: 204 })
  },

  async 'GET /shared/:token/comments'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const { design, role } = await sharedContext(req, params.token)
    if (role === 'view') throw new HttpError(403, 'forbidden', 'This link can view only.')
    return jsonResponse(await listComments(design.id))
  },

  async 'POST /shared/:token/comments'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design, role } = await sharedContext(req, params.token)
    if (role === 'view') throw new HttpError(403, 'forbidden', 'This link can view only.')
    const viewer = await currentUser(req)
    if (!viewer) throw new HttpError(401, 'not_authenticated', 'Sign in to comment through this link.')
    const body = await readJson(req)
    return jsonResponse(await createComment(design.id, viewer.id, body), { status: 201 })
  },

  async 'PATCH /shared/:token/comments/:cid'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design, role } = await sharedContext(req, params.token)
    if (role === 'view') throw new HttpError(403, 'forbidden', 'This link can view only.')
    const viewer = await currentUser(req)
    if (!viewer) throw new HttpError(401, 'not_authenticated', 'Sign in to comment through this link.')
    const row = await db.comment.findUnique({ where: { id: params.cid } })
    if (!row || row.designId !== design.id) throw new HttpError(404, 'not_found', 'That comment does not exist.')
    const body = await readJson(req)
    const data: Record<string, unknown> = {}
    if (typeof body.resolved === 'boolean' && (row.authorId === viewer.id || design.ownerId === viewer.id)) data.resolved = body.resolved
    if (typeof body.page_id === 'string' && typeof body.x === 'number' && typeof body.y === 'number' && row.authorId === viewer.id) {
      data.pageId = body.page_id
      data.x = body.x
      data.y = body.y
    }
    const updated = await db.comment.update({ where: { id: row.id }, data, include: { author: true } })
    return jsonResponse(serializeComment(updated))
  },

  async 'DELETE /shared/:token/comments/:cid'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const { design, role } = await sharedContext(req, params.token)
    if (role === 'view') throw new HttpError(403, 'forbidden', 'This link can view only.')
    const viewer = await currentUser(req)
    if (!viewer) throw new HttpError(401, 'not_authenticated', 'Sign in to comment through this link.')
    const row = await db.comment.findUnique({ where: { id: params.cid } })
    if (!row || row.designId !== design.id) throw new HttpError(404, 'not_found', 'That comment does not exist.')
    if (row.authorId !== viewer.id && design.ownerId !== viewer.id) throw new HttpError(403, 'forbidden', 'You can delete your own comments only.')
    await db.comment.delete({ where: { id: row.id } })
    return new NextResponse(null, { status: 204 })
  },
}

export { listFields }
