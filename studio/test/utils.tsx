import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { onTestFinished } from 'vitest'

export interface CapturedRequest {
  method: string
  url: URL
  body: unknown
  headers: Headers
}

/**
 * Replaces `globalThis.fetch` with a capturing stub that answers every call with `respond(request)`.
 * Returns the live array of captured requests (mutated in place as calls happen; the object handed
 * to `respond` is the same entry); the original fetch is restored when the current test finishes.
 */
export function captureFetch(respond: (request: CapturedRequest) => Response): CapturedRequest[] {
  const calls: CapturedRequest[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: CapturedRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url: new URL(String(input), 'http://localhost'),
      body: init?.body ?? null,
      headers: new Headers(init?.headers),
    }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  onTestFinished(() => {
    globalThis.fetch = original
  })
  return calls
}

/** Deterministic query client for tests: no retries, cache lives for the whole test. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
}

/** Renders a component under the query client and a memory router (dialogs may navigate). */
export function renderWithProviders(ui: ReactElement, options: { client?: QueryClient } & Omit<RenderOptions, 'wrapper'> = {}): RenderResult {
  const { client, ...renderOptions } = options
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client ?? createTestQueryClient()}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
  return render(ui, { wrapper: Wrapper, ...renderOptions })
}
