'use client'

/**
 * Client island host. The whole studio SPA (landing, auth, dashboard, editor, presenter view)
 * mounts here on the client only — none of it renders on the server, mirroring the original
 * single-page app while Next.js serves every URL through one catch-all route.
 */
import { useEffect, useState } from 'react'
import type StudioIsland from '@/island'

export default function StudioApp() {
  const [Island, setIsland] = useState<typeof StudioIsland | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    import('@/island')
      .then((module) => {
        if (!cancelled) setIsland(() => module.default)
      })
      .catch((error) => {
        console.error('The studio failed to load.', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#F4F3F0', fontFamily: 'Outfit, sans-serif', color: '#15161A' }}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.5rem' }}>The studio could not start</p>
          <p style={{ fontSize: '0.875rem', opacity: 0.7 }}>Reload the page to try again.</p>
        </div>
      </div>
    )
  }

  if (!Island) {
    return (
      <div style={{ minHeight: '100dvh', background: '#F4F3F0' }} aria-busy="true" aria-live="polite">
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading the studio…</span>
      </div>
    )
  }

  return <Island />
}
