import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  HttpError, jsonResponse, readJson, checkCsrf, currentUser, requireUser, createSession,
  sessionCookie, clearSessionCookie, csrfCookie, hashPassword, verifyPassword, randomToken,
  rateLimit, clientKey, serializeUser, LIMITS, isSecureRequest, issueCsrfToken, sessionFromRequest,
} from './core'
import { sendEmail, verifyEmailHtml, resetEmailHtml } from './email'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const COMMON_PASSWORDS = new Set(['password', 'password1', '12345678', '123456789', 'qwertyui', 'qwerty123', 'iloveyou', 'letmein1', '11111111', 'abc12345'])

function validatePasswordFields(newPassword: string): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  if (newPassword.length < 8) fields.password = ['Password must be at least 8 characters.']
  else if (/^\d+$/.test(newPassword) || COMMON_PASSWORDS.has(newPassword.toLowerCase())) fields.password = ['Choose a less common password.']
  return fields
}

async function issueAuthToken(userId: string, kind: 'verify' | 'reset'): Promise<string> {
  const token = randomToken(24)
  await db.authToken.create({ data: { userId, kind, token, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } })
  return token
}

async function consumeAuthToken(uid: string, token: string, kind: 'verify' | 'reset'): Promise<boolean> {
  const row = await db.authToken.findUnique({ where: { token } })
  if (!row || row.userId !== uid || row.kind !== kind || row.usedAt || row.expiresAt.getTime() < Date.now()) return false
  await db.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } })
  return true
}

function siteUrl(req: NextRequest): string {
  return process.env.SYNKRA_SITE_URL || req.nextUrl.origin
}

export const authHandlers = {
  async 'GET /auth/csrf'(req: NextRequest): Promise<NextResponse> {
    const secure = isSecureRequest(req)
    const existing = req.headers.get('cookie')?.match(/csrftoken=([^;]+)/)?.[1]
    // Keep the cookie value stable when present (double-submit), else mint a signed token that
    // also lands in the JSON body for browsers that block cookies in cross-site iframe previews.
    const token = existing ? decodeURIComponent(existing) : issueCsrfToken()
    return jsonResponse({ token }, { headers: { 'Set-Cookie': csrfCookie(token, secure), 'Cache-Control': 'no-store' } })
  },

  async 'GET /auth/me'(req: NextRequest): Promise<NextResponse> {
    const user = await currentUser(req)
    return jsonResponse({ user: user ? serializeUser(user) : null })
  },

  async 'POST /auth/register'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    rateLimit('auth', clientKey(req), 20, 60_000)
    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 80) : ''
    const fields: Record<string, string[]> = {}
    const codes: Record<string, string[]> = {}
    if (!EMAIL_RE.test(email)) {
      fields.email = ['Enter a valid email address.']
      codes.email = ['invalid_email']
    }
    Object.assign(fields, validatePasswordFields(password))
    if (fields.password?.[0]?.startsWith('Choose a less common')) codes.password = ['password_too_common']
    if (Object.keys(fields).length > 0) throw new HttpError(400, 'validation_error', 'Check the highlighted fields.', { fields, fieldCodes: codes })
    const existing = await db.user.findUnique({ where: { email } })
    if (existing) throw new HttpError(400, 'validation_error', 'Check the highlighted fields.', { fields: { email: ['An account with this email already exists.'] }, fieldCodes: { email: ['email_in_use'] } })
    const user = await db.user.create({
      data: { email, passwordHash: hashPassword(password), displayName: displayName || email.split('@')[0], isEmailVerified: true },
    })
    const session = await createSession(user.id)
    const verifyToken = await issueAuthToken(user.id, 'verify')
    const mail = verifyEmailHtml(`${siteUrl(req)}/verify-email?uid=${user.id}&token=${verifyToken}`)
    void sendEmail({ to: user.email, ...mail, kind: 'verify' })
    return jsonResponse({ user: serializeUser(user), session_token: session.id }, { status: 201, headers: { 'Set-Cookie': sessionCookie(session.id, session.expiresAt, isSecureRequest(req)) } })
  },

  async 'POST /auth/login'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    rateLimit('auth', clientKey(req), 20, 60_000)
    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const user = await db.user.findUnique({ where: { email } })
    if (user?.lockoutUntil && user.lockoutUntil.getTime() > Date.now()) {
      throw new HttpError(429, 'account_locked', 'Too many failed attempts. Try again shortly.', { retryAfter: Math.ceil((user.lockoutUntil.getTime() - Date.now()) / 1000) })
    }
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      if (user) {
        const failed = user.failedLogins + 1
        await db.user.update({
          where: { id: user.id },
          data: { failedLogins: failed, lockoutUntil: failed >= 10 ? new Date(Date.now() + 15 * 60 * 1000) : user.lockoutUntil },
        })
      }
      throw new HttpError(400, 'bad_credentials', 'That email and password combination is not right.')
    }
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockoutUntil: null } })
    const session = await createSession(user.id)
    return jsonResponse({ user: serializeUser(user), session_token: session.id }, { headers: { 'Set-Cookie': sessionCookie(session.id, session.expiresAt, isSecureRequest(req)) } })
  },

  async 'POST /auth/logout'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const sessionId = sessionFromRequest(req)
    if (sessionId) await db.session.deleteMany({ where: { id: sessionId } })
    return new NextResponse(null, { status: 204, headers: { 'Set-Cookie': clearSessionCookie(isSecureRequest(req)) } })
  },

  async 'PATCH /auth/me'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const contentType = req.headers.get('content-type') ?? ''
    let data: Record<string, string> = {}
    let avatarPath: string | null | undefined
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const displayName = form.get('display_name')
      if (typeof displayName === 'string') data.displayName = displayName.trim().slice(0, 80)
      const avatar = form.get('avatar')
      if (avatar instanceof File && avatar.size > 0) {
        if (avatar.size > LIMITS.maxAvatarBytes) throw new HttpError(400, 'validation_error', 'The file is too large.', { fields: { avatar: ['Avatars can be at most 5 MB.'] } })
        const { saveUpload } = await import('./files')
        const saved = await saveUpload(avatar, `avatars/${user.id}`, ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
        avatarPath = saved.path
      }
    } else {
      const body = await readJson(req)
      if (typeof body.display_name === 'string') data.displayName = body.display_name.trim().slice(0, 80)
      if (body.remove_avatar === true) avatarPath = null
    }
    const updated = await db.user.update({ where: { id: user.id }, data: { ...data, ...(avatarPath !== undefined ? { avatarPath } : {}) } })
    return jsonResponse({ user: serializeUser(updated) })
  },

  async 'DELETE /auth/me'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const body = await readJson(req)
    if (body.confirm_email !== user.email && !verifyPassword(typeof body.password === 'string' ? body.password : '', user.passwordHash)) {
      throw new HttpError(400, 'validation_error', 'Confirm your password to delete the account.', { fields: { password: ['Wrong password.'] } })
    }
    const staffCount = await db.user.count({ where: { isStaff: true } })
    if (user.isStaff && staffCount <= 1) throw new HttpError(400, 'last_staff', 'The last staff account cannot be deleted.')
    await db.user.delete({ where: { id: user.id } })
    return new NextResponse(null, { status: 204, headers: { 'Set-Cookie': clearSessionCookie(isSecureRequest(req)) } })
  },

  async 'POST /auth/password/change'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const body = await readJson(req)
    const newPassword = typeof body.new_password === 'string' ? body.new_password : ''
    if (user.passwordHash && !verifyPassword(typeof body.old_password === 'string' ? body.old_password : '', user.passwordHash)) {
      throw new HttpError(400, 'validation_error', 'Check the highlighted fields.', { fields: { old_password: ['Wrong password.'] } })
    }
    const fields = validatePasswordFields(newPassword)
    if (Object.keys(fields).length > 0) throw new HttpError(400, 'validation_error', 'Check the highlighted fields.', { fields })
    await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } })
    await db.apiToken.updateMany({ where: { ownerId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
    return new NextResponse(null, { status: 204 })
  },

  async 'POST /auth/password/reset'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    rateLimit('auth', clientKey(req), 20, 60_000)
    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const user = await db.user.findUnique({ where: { email } })
    if (user) {
      const last = await db.authToken.findFirst({ where: { userId: user.id, kind: 'reset' }, orderBy: { createdAt: 'desc' } })
      if (last && Date.now() - last.createdAt.getTime() < 60_000) {
        throw new HttpError(429, 'rate_limited', 'Please wait a minute before asking again.', { retryAfter: 60 })
      }
      const token = await issueAuthToken(user.id, 'reset')
      const mail = resetEmailHtml(`${siteUrl(req)}/reset-password?uid=${user.id}&token=${token}`)
      void sendEmail({ to: user.email, ...mail, kind: 'reset' })
    }
    return new NextResponse(null, { status: 204 })
  },

  async 'POST /auth/password/reset/confirm'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    rateLimit('auth', clientKey(req), 20, 60_000)
    const body = await readJson(req)
    const uid = typeof body.uid === 'string' ? body.uid : ''
    const token = typeof body.token === 'string' ? body.token : ''
    const newPassword = typeof body.new_password === 'string' ? body.new_password : ''
    const fields = validatePasswordFields(newPassword)
    if (Object.keys(fields).length > 0) throw new HttpError(400, 'validation_error', 'Check the highlighted fields.', { fields })
    const valid = await consumeAuthToken(uid, token, 'reset')
    if (!valid) throw new HttpError(400, 'bad_token', 'This reset link does not work any more. Request a new one.')
    await db.user.update({ where: { id: uid }, data: { passwordHash: hashPassword(newPassword), isEmailVerified: true } })
    await db.apiToken.updateMany({ where: { ownerId: uid, revokedAt: null }, data: { revokedAt: new Date() } })
    await db.session.deleteMany({ where: { userId: uid } })
    return new NextResponse(null, { status: 204 })
  },

  async 'POST /auth/email/verify'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const body = await readJson(req)
    const uid = typeof body.uid === 'string' ? body.uid : ''
    const token = typeof body.token === 'string' ? body.token : ''
    const valid = await consumeAuthToken(uid, token, 'verify')
    if (!valid) throw new HttpError(400, 'bad_token', 'This verification link does not work any more.')
    await db.user.update({ where: { id: uid }, data: { isEmailVerified: true } })
    return new NextResponse(null, { status: 204 })
  },

  async 'POST /auth/email/resend'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    if (!user.isEmailVerified) {
      const token = await issueAuthToken(user.id, 'verify')
      const mail = verifyEmailHtml(`${siteUrl(req)}/verify-email?uid=${user.id}&token=${token}`)
      void sendEmail({ to: user.email, ...mail, kind: 'verify' })
    }
    return new NextResponse(null, { status: 204 })
  },

  async 'POST /auth/google'(): Promise<NextResponse> {
    throw new HttpError(404, 'not_found', 'Google sign-in is not available on this installation.')
  },
}

// ---------- personal access tokens (Settings → API access) ----------

export const TOKEN_SCOPES: Array<{ id: string; label: string; description: string }> = [
  { id: 'designs:read', label: 'Read designs', description: 'List and read designs and their documents.' },
  { id: 'designs:write', label: 'Edit designs', description: 'Create designs and edit their contents.' },
  { id: 'designs:trash', label: 'Trash designs', description: 'Move designs to the trash or restore them.' },
  { id: 'assets:write', label: 'Upload files', description: 'Upload images and audio into the uploads library.' },
  { id: 'comments:write', label: 'Write comments', description: 'Add, resolve and edit comments.' },
  { id: 'comments:manage', label: 'Manage comments', description: 'Delete comments by anyone.' },
  { id: 'brand:write', label: 'Edit brand kits', description: 'Create and change brand kits.' },
  { id: 'sharing:write', label: 'Manage sharing', description: 'Create and revoke share links.' },
]

export const tokenHandlers = {
  async 'GET /auth/tokens/scopes'(req: NextRequest): Promise<NextResponse> {
    await requireUser(req)
    return jsonResponse({ scopes: TOKEN_SCOPES })
  },

  async 'GET /auth/tokens'(req: NextRequest): Promise<NextResponse> {
    const user = await requireUser(req)
    const rows = await db.apiToken.findMany({ where: { ownerId: user.id, revokedAt: null }, orderBy: { createdAt: 'desc' } })
    return jsonResponse({
      results: rows.map((row) => ({
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: JSON.parse(row.scopes) as string[],
        created_at: row.createdAt.toISOString(),
        expires_at: row.expiresAt?.toISOString() ?? null,
        last_used_at: row.lastUsedAt?.toISOString() ?? null,
      })),
      count: rows.length,
    })
  },

  async 'POST /auth/tokens'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const body = await readJson(req)
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s: unknown): s is string => typeof s === 'string') : []
    if (!name) throw new HttpError(400, 'validation_error', 'Give the token a name.', { fields: { name: ['Required.'] } })
    const known = new Set(TOKEN_SCOPES.map((s) => s.id))
    const unknown = scopes.filter((s: string) => !known.has(s))
    if (unknown.length > 0) throw new HttpError(400, 'validation_error', 'Unknown scopes.', { fields: { scopes: [`Unknown scope: ${unknown[0]}`] } })
    if (!user.isEmailVerified) throw new HttpError(403, 'email_unverified', 'Verify your email before minting API tokens.')
    const count = await db.apiToken.count({ where: { ownerId: user.id, revokedAt: null } })
    if (count >= 20) throw new HttpError(400, 'too_many_tokens', 'You can have at most 20 active tokens.')
    const prefix = randomToken(6)
    const secret = randomToken(24)
    const { sha256Hex } = await import('./core')
    await db.apiToken.create({
      data: {
        ownerId: user.id, name, prefix,
        secretHash: sha256Hex(`synkra_${prefix}_${secret}`),
        scopes: JSON.stringify(scopes),
        expiresAt: typeof body.expires_in_days === 'number' ? new Date(Date.now() + body.expires_in_days * 86_400_000) : null,
      },
    })
    return jsonResponse({ token: `synkra_${prefix}_${secret}` }, { status: 201 })
  },
}

export async function deleteToken(req: NextRequest, id: string): Promise<NextResponse> {
  checkCsrf(req)
  const user = await requireUser(req)
  await db.apiToken.updateMany({ where: { id, ownerId: user.id }, data: { revokedAt: new Date() } })
  return new NextResponse(null, { status: 204 })
}
