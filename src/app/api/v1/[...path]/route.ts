import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, jsonResponse, readJson, requireService, currentUser } from '@/server/core'
import { authHandlers, tokenHandlers, deleteToken } from '@/server/auth'
import { designHandlers, folderHandlers } from '@/server/designs'
import { shareHandlers } from '@/server/sharing'
import { assetHandlers, brandHandlers, templateHandlers, elementHandlers, fontHandlers, miscHandlers } from '@/server/library'
import { db } from '@/lib/db'
import { readDoc } from '@/server/designs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Handler = (req: NextRequest, params: Record<string, string>) => Promise<NextResponse>

const TABLES: Array<Record<string, Handler>> = [
  authHandlers as unknown as Record<string, Handler>,
  tokenHandlers as unknown as Record<string, Handler>,
  designHandlers as unknown as Record<string, Handler>,
  folderHandlers as unknown as Record<string, Handler>,
  shareHandlers as unknown as Record<string, Handler>,
  assetHandlers as unknown as Record<string, Handler>,
  brandHandlers as unknown as Record<string, Handler>,
  templateHandlers as unknown as Record<string, Handler>,
  elementHandlers as unknown as Record<string, Handler>,
  fontHandlers as unknown as Record<string, Handler>,
  miscHandlers as unknown as Record<string, Handler>,
]

/** Internal endpoints for the realtime room service (Bearer service token). */
const internalHandlers: Record<string, Handler> = {
  async 'GET /internal/designs/:id'(req, params) {
    requireService(req)
    const design = await db.design.findUnique({ where: { id: params.id } })
    if (!design) throw Object.assign(new Error('not found'), { status: 404 })
    return jsonResponse({ id: design.id, title: design.title, revision: design.revision, document: readDoc(design.document), updated_at: design.updatedAt.toISOString() })
  },
  async 'PATCH /internal/designs/:id'(req, params) {
    requireService(req)
    const body = await readJson(req)
    const design = await db.design.findUnique({ where: { id: params.id } })
    if (!design) throw Object.assign(new Error('not found'), { status: 404 })
    const document = body.document ?? null
    if (document === null || typeof document !== 'object') throw Object.assign(new Error('bad document'), { status: 400 })
    const pages = Array.isArray(document.pages) ? document.pages.length : 1
    const updated = await db.design.update({
      where: { id: design.id },
      data: {
        document: JSON.stringify(document),
        pageCount: pages,
        revision: { increment: 1 },
        ...(typeof body.title === 'string' ? { title: body.title.slice(0, 200) } : {}),
      },
    })
    return jsonResponse({ revision: updated.revision, updated_at: updated.updatedAt.toISOString() })
  },
  async 'GET /internal/designs/:id/revisions'(req, params) {
    requireService(req)
    const design = await db.design.findUnique({ where: { id: params.id } })
    if (!design) throw Object.assign(new Error('not found'), { status: 404 })
    return jsonResponse({ revision: design.revision, updated_at: design.updatedAt.toISOString() })
  },
  /** Resolves the caller's session from forwarded cookies (used by the realtime room service). */
  async 'GET /internal/whoami'(req) {
    requireService(req)
    const user = await currentUser(req)
    return jsonResponse({ user: user ? { id: user.id, name: user.displayName, avatar_url: user.avatarPath ? `/media/${user.avatarPath}` : null, is_staff: user.isStaff } : null })
  },
  /** Resolves a share token for a live room: role + the credentials the client presented. */
  async 'POST /internal/shared/:token/resolve'(req, params) {
    requireService(req)
    const body = await readJson(req)
    const link = await db.shareLink.findUnique({ where: { token: params.token }, include: { design: true } })
    if (!link || !link.isActive || !link.design || link.design.trashedAt !== null) {
      return jsonResponse({ ok: false, reason: 'not_found' })
    }
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return jsonResponse({ ok: false, reason: 'expired' })
    const user = await currentUser(req)
    if (user && user.id === link.design.ownerId) return jsonResponse({ ok: true, role: 'owner', design_id: link.design.id, user_id: user.id })
    if (link.passwordHash) {
      const provided = typeof body.password === 'string' ? body.password : ''
      const { verifyPassword } = await import('@/server/core')
      if (!verifyPassword(provided, link.passwordHash)) return jsonResponse({ ok: false, reason: 'password_required' })
    }
    return jsonResponse({ ok: true, role: link.role, design_id: link.design.id, user_id: user?.id ?? null })
  },
}

function matchKey(method: string, segments: string[]): { key: string; params: Record<string, string>; table: Record<string, Handler> } | null {
  for (const table of [...TABLES, internalHandlers]) {
    for (const key of Object.keys(table)) {
      const [keyMethod, ...keyParts] = key.split(' ')
      if (keyMethod !== method) continue
      const pathParts = keyParts.join(' ').split('/').filter(Boolean)
      if (pathParts.length !== segments.length) continue
      const params: Record<string, string> = {}
      let ok = true
      for (let i = 0; i < pathParts.length; i += 1) {
        const part = pathParts[i]
        if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segments[i])
        else if (part !== segments[i]) { ok = false; break }
      }
      if (ok) return { key, params, table }
    }
  }
  return null
}

async function dispatch(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const match = matchKey(req.method, segments)

  if (!match) {
    return NextResponse.json({ error: { code: 'not_found', message: 'This endpoint does not exist.' } }, { status: 404 })
  }
  try {
    return await match.table[match.key](req, match.params)
  } catch (error) {
    return errorResponse(error)
  }
}

async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await context.params
  return dispatch(req, path ?? [])
}

export const GET = handle
export const POST = handle
export const PATCH = handle
export const PUT = handle
export const DELETE = handle
