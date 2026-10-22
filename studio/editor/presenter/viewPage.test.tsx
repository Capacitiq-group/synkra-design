/**
 * The presenter view is a route of the same app (`/presenter-view`), so the second window shares
 * this origin, styles and asset pipeline instead of shipping its own HTML entry. Its promise to
 * the user: it connects with the session from the query string and is never indexed, so a
 * session link cannot leak into a search engine.
 */
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderApp } from '@/test/app'

const SESSION = 'abc123def456ghi789jklmno'

describe('presenter view route', () => {
  beforeEach(() => {
    // The page reads the real address (`window.location.search`), like the second window will.
    window.history.replaceState(null, '', `/presenter-view?session=${SESSION}`)
  })

  it('is reachable without an account and connects with the session from the query', async () => {
    renderApp('/presenter-view')
    expect(await screen.findByTestId('view-connecting')).toBeInTheDocument()
  })

  it('is marked noindex, so a session link is never listed', async () => {
    renderApp('/presenter-view')
    await screen.findByTestId('view-connecting')
    const robots = document.querySelector('meta[name="robots"]')
    expect(robots?.getAttribute('content')).toMatch(/noindex/)
  })
})
