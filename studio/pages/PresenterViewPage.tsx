import { useEffect, useState } from 'react'
import { PresenterView } from '@/editor/presenter/view/PresenterView'

/**
 * Hosts the presenter view ("Present with notes") second window. The original app shipped this as
 * a separate HTML entry; here it is a route of the same app, so the window shares the origin,
 * styles and asset pipeline. It reads its session id from the query string.
 */
export default function PresenterViewPage() {
  const [session, setSession] = useState<string | null>(null)

  useEffect(() => {
    setSession(new URLSearchParams(window.location.search).get('session'))
  }, [])

  return <PresenterView session={session} />
}
