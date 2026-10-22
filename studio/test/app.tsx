import { render, type RenderResult } from '@testing-library/react'
import { http as mswHttp, HttpResponse, type RequestHandler } from 'msw'
import { RouterProvider, type Router } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { AppProviders } from '@/app/AppProviders'
import { createTestRouter } from '@/app/router'
import { useAuth } from '@/features/auth/AuthProvider'
import type { ApiUser, AppConfig } from '@/types/api'
import { makeConfig } from './factories'
import { server } from './msw'
import { createTestQueryClient } from './utils'

export interface RenderAppOptions {
  /** Signed-in user served by the default `GET /auth/me` handler (anonymous when omitted). */
  user?: ApiUser
  /** Instance config served by the default `GET /config` handler. */
  config?: AppConfig
  /** Extra MSW handlers; registered after the defaults so they win. */
  handlers?: RequestHandler[]
}

export interface RenderAppResult extends RenderResult {
  router: Router
  client: QueryClient
  /** Replaces the cached user inside the running AuthProvider (`null` forgets the session). */
  setUser: (user: ApiUser | null) => void
}

let authBridge: { setUser: (user: ApiUser | null) => void } | null = null

/** Exposes the live AuthProvider actions to the test helper. */
function AuthBridge() {
  const { setUser, clearSession } = useAuth()
  useEffect(() => {
    authBridge = { setUser: (user) => (user ? setUser(user) : clearSession()) }
    return () => {
      authBridge = null
    }
  }, [setUser, clearSession])
  return null
}

/** Boots the real application (providers + router) at `path` inside a memory router. */
export function renderApp(path: string, { user, config, handlers }: RenderAppOptions = {}): RenderAppResult {
  // Handlers first: within one `server.use()` call the earlier entries win, so a test's own
  // /auth/me or /config stub must rank above the bootstrap defaults below.
  server.use(
    ...(handlers ?? []),
    mswHttp.get('*/api/v1/auth/me/', () => HttpResponse.json({ user: user ?? null })),
    mswHttp.get('*/api/v1/config/', () => HttpResponse.json(config ?? makeConfig())),
  )
  const client = createTestQueryClient()
  const router = createTestRouter([path])
  const result = render(
    <AppProviders client={client}>
      <AuthBridge />
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { router, client, setUser: (next) => authBridge?.setUser(next), ...result }
}
