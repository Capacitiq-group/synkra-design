import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

/** Empty paginated list envelope matching `Page<T>`. */
const emptyPage = () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })

/**
 * Neutral defaults for endpoints a test did not stub, so unrendered widgets never reach the
 * network (vitest's jsdom would resolve relative URLs against the live dev server, whose 401
 * answers sign the session out mid-test). Handlers registered per test always win.
 */
const defaults = [
  http.get('*/api/v1/designs/', emptyPage),
  http.get('*/api/v1/folders/', emptyPage),
  http.get('*/api/v1/assets/', emptyPage),
  http.get('*/api/v1/assets/usage/', () => HttpResponse.json({ used_bytes: 0, quota_bytes: 2 * 1024 * 1024 * 1024 })),
  http.get('*/api/v1/brand-kits/', emptyPage),
  http.get('*/api/v1/fonts/', emptyPage),
  http.get('*/api/v1/fonts/mine/', emptyPage),
  http.get('*/api/v1/templates/', emptyPage),
  http.get('*/api/v1/template-categories/', emptyPage),
  http.get('*/api/v1/comments/', emptyPage),
  http.get('*/api/v1/auth/tokens/', () => HttpResponse.json([])),
  http.get('*/api/v1/auth/tokens/scopes/', () => HttpResponse.json([])),
  http.get('*/api/v1/ai/providers/', () => HttpResponse.json([])),
]

/** Final catch-all: a 404 envelope that keeps queries in their error state instead of the network. */
const apiFallback = http.all('*/api/v1/*', ({ request }) =>
  HttpResponse.json(
    { error: { code: 'not_found', message: `No test handler for ${request.method} ${new URL(request.url).pathname}` } },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  ),
)

/** Shared MSW server for API mocking in tests; lifecycle is managed by `studio/test/setup.ts`. */
export const server = setupServer(...defaults, apiFallback)
