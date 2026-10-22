import { useState } from 'react'
import { PresenterView } from '@/editor/presenter/view/PresenterView'
import { usePageMeta } from '@/lib/usePageMeta'

/**
 * Hosts the presenter view ("Present with notes") second window. The original app shipped this as
 * a separate HTML entry; here it is a route of the same app, so the window shares the origin,
 * styles and asset pipeline. It reads its session id from the query string.
 */
export default function PresenterViewPage() {
  // Read synchronously: `useShow` freezes its phase at first render, so a session that only
  // arrives after mount would leave the view stuck on "not a presenter view link".
  const [session] = useState(() => new URLSearchParams(window.location.search).get('session'))

  // A presenter link grants view access to a live session: it must never be indexed.
  usePageMeta({ title: 'Presenter view', noindex: true })

  return <PresenterView session={session} />
}
