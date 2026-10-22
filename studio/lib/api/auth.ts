import type { ApiUser, GoogleLoginResult, RegisterInput } from '@/types/api'
import { http, setSessionToken } from './client'

/** Register/login payloads also carry a session token fallback for cookie-blocked contexts. */
type AuthSession = { user: ApiUser; session_token?: string }

function persistSession(payload: AuthSession): AuthSession {
  if (payload.session_token) setSessionToken(payload.session_token)
  return payload
}

export const authApi = {
  csrf: () => http.get<void>('/auth/csrf/'),
  /** Never rejects with 401: `user` is null for anonymous visitors. */
  me: (signal?: AbortSignal) => http.get<{ user: ApiUser | null }>('/auth/me/', { signal, silentUnauthorized: true }),
  register: (input: RegisterInput) =>
    http.post<AuthSession>('/auth/register/', { json: input, silentUnauthorized: true }).then(persistSession),
  login: (input: { email: string; password: string }) =>
    http.post<AuthSession>('/auth/login/', { json: input, silentUnauthorized: true }).then(persistSession),
  logout: () => http.post<void>('/auth/logout/', { silentUnauthorized: true }).then((result) => {
    setSessionToken(null)
    return result
  }),
  google: (credential: string) => http.post<GoogleLoginResult>('/auth/google/', { json: { credential }, silentUnauthorized: true }),
  updateProfile: (input: { display_name: string }) => http.patch<{ user: ApiUser }>('/auth/me/', { json: input }),
  uploadAvatar: (file: Blob, filename = 'avatar') => {
    const form = new FormData()
    form.append('avatar', file, filename)
    return http.patch<{ user: ApiUser }>('/auth/me/', { form })
  },
  removeAvatar: () => http.patch<{ user: ApiUser }>('/auth/me/', { json: { remove_avatar: true } }),
  deleteAccount: (input: { password?: string; confirm_email?: string }) =>
    http.delete<void>('/auth/me/', { json: input }).then((result) => {
      setSessionToken(null)
      return result
    }),
  changePassword: (input: { old_password?: string; new_password: string }) => http.post<void>('/auth/password/change/', { json: input }),
  requestPasswordReset: (email: string) => http.post<void>('/auth/password/reset/', { json: { email }, silentUnauthorized: true }),
  confirmPasswordReset: (input: { uid: string; token: string; new_password: string }) =>
    http.post<void>('/auth/password/reset/confirm/', { json: input, silentUnauthorized: true }),
  verifyEmail: (input: { uid: string; token: string }) => http.post<void>('/auth/email/verify/', { json: input, silentUnauthorized: true }),
  resendVerification: () => http.post<void>('/auth/email/resend/'),
}
