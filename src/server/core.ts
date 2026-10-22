import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto'
import { db } from '@/lib/db'
import type { User } from '@prisma/client'

/** Root directory for every runtime file (uploads, thumbnails, fonts, audio, models). */
export const MEDIA_DIR = process.env.SYNKRA_MEDIA_DIR ?? '/home/z/my-project/media'
/** Shared secret for internal services (the realtime room service) to read/write designs. */
export const SERVICE_TOKEN = process.env.SYNKRA_SERVICE_TOKEN ?? 'synkra-dev-service-token'

export const LIMITS = {
  maxUploadBytes: 25 * 1024 * 1024,
  maxPages: 100,
  maxDocumentBytes: 12 * 1024 * 1024,
  realtimeMaxParticipants: 25,
  bulkFillMaxRows: 100,
  userStorageQuotaBytes: 2 * 1024 * 1024 * 1024,
  maxDesignsPerUser: 5000,
  maxAvatarBytes: 5 * 1024 * 1024,
  maxThumbnailBytes: 2 * 1024 * 1024,
}

export const SESSION_COOKIE = 'synkra_session'
export const CSRF_COOKIE = 'csrftoken'
const SESSION_DAYS = 30

export class HttpError extends Error {
  status: number
  code: string
  fields?: Record<string, string[]>
  fieldCodes?: Record<string, string[]>
  retryAfter?: number
  data?: unknown
  constructor(status: number, code: string, message: string, extra: { fields?: Record<string, string[]>; fieldCodes?: Record<string, string[]>; retryAfter?: number; data?: unknown } = {}) {
    super(message)
    this.status = status
    this.code = code
    Object.assign(this, extra)
  }
}

export function errorBody(err: unknown) {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.fields ? { fields: err.fields } : {}),
          ...(err.fieldCodes ? { field_codes: err.fieldCodes } : {}),
          ...(err.retryAfter ? { retry_after: err.retryAfter } : {}),
        },
        ...(err.data !== undefined ? (err.data as Record<string, unknown>) : {}),
      },
      retryAfter: err.retryAfter,
    }
  }
  console.error('[api] internal error', err)
  return { status: 500, body: { error: { code: 'server_error', message: 'Synkra had a problem on its side. Please try again in a moment.' } }, retryAfter: undefined }
}

export function jsonResponse(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  if (data === undefined) return new NextResponse(null, { status: init.status ?? 204, headers: init.headers })
  return NextResponse.json(data, { status: init.status ?? 200, headers: init.headers })
}

/** Uniform error envelope + no-store for API answers. */
export function errorResponse(err: unknown): NextResponse {
  const { status, body, retryAfter } = errorBody(err)
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (retryAfter) headers['Retry-After'] = String(Math.ceil(retryAfter))
  return NextResponse.json(body, { status, headers })
}

export async function readJson(req: NextRequest): Promise<any> {
  try {
    const text = await req.text()
    if (!text) return {}
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON.')
  }
}

// ---------- passwords ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// ---------- sessions / CSRF ----------

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = randomToken(32)
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({ data: { id, userId, expiresAt } })
  return { id, expiresAt }
}

export function sessionCookie(id: string, expiresAt: Date): string {
  return `${SESSION_COOKIE}=${id}; Path=/; Expires=${expiresAt.toUTCString()}; HttpOnly; SameSite=Lax`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`
}

export function csrfCookie(value: string): string {
  return `${CSRF_COOKIE}=${value}; Path=/; SameSite=Lax`
}

function readCookie(req: NextRequest, name: string): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function checkCsrf(req: NextRequest): void {
  const cookieToken = readCookie(req, CSRF_COOKIE)
  const headerToken = req.headers.get('x-csrftoken')
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw new HttpError(403, 'csrf_failed', 'The request could not be verified. Refresh the page and try again.')
  }
}

/** The signed-in user, or null. Sessions are DB-backed; expired ones are ignored. */
export async function currentUser(req: NextRequest): Promise<User | null> {
  const sessionId = readCookie(req, SESSION_COOKIE)
  if (!sessionId) return null
  const session = await db.session.findUnique({ where: { id: sessionId }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now() || !session.user.isActive) return null
  return session.user
}

export async function requireUser(req: NextRequest): Promise<User> {
  const user = await currentUser(req)
  if (!user) throw new HttpError(401, 'not_authenticated', 'Sign in to continue.')
  return user
}

/** Internal service auth (realtime room service): `Authorization: Bearer <service token>`. */
export function requireService(req: NextRequest): void {
  if (!isService(req)) throw new HttpError(403, 'forbidden', 'Service authentication failed.')
}

export function isService(req: NextRequest): boolean {
  return (req.headers.get('authorization') ?? '') === `Bearer ${SERVICE_TOKEN}`
}

// ---------- rate limiting (in-memory fixed windows per scope+key) ----------

const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(scope: string, key: string, max: number, windowMs: number): void {
  const now = Date.now()
  const id = `${scope}:${key}`
  const bucket = buckets.get(id)
  if (!bucket || bucket.resetAt < now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs })
    return
  }
  bucket.count += 1
  if (bucket.count > max) {
    throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.', { retryAfter: Math.ceil((bucket.resetAt - now) / 1000) })
  }
}

export function clientKey(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}

// ---------- serializers ----------

export function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    name: user.displayName,
    avatar_url: user.avatarPath ? `/media/${user.avatarPath}` : null,
    is_email_verified: user.isEmailVerified,
    has_password: user.passwordHash !== null,
    google_linked: user.googleSub !== null,
    created_at: user.createdAt.toISOString(),
  }
}

/** Validates a design document's size/shape the way the server must before storing it. */
export function assertDocumentSaveable(document: unknown): { pages: number } {
  if (document === null || typeof document !== 'object') throw new HttpError(400, 'invalid_document', 'The design document is malformed.')
  const json = JSON.stringify(document)
  if (json.length > LIMITS.maxDocumentBytes) throw new HttpError(400, 'document_too_large', 'This design is too large to save.')
  const doc = document as { pages?: unknown[] }
  const pages = Array.isArray(doc.pages) ? doc.pages : []
  if (pages.length > LIMITS.maxPages) throw new HttpError(400, 'too_many_pages', `Designs can have at most ${LIMITS.maxPages} pages.`)
  return { pages: pages.length }
}

export function parseJsonColumn<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
