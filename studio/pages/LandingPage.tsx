import { Hero } from '@/features/landing/Hero'
import { LocalDesignsStrip } from '@/features/landing/LocalDesignsStrip'
import { usePageMeta } from '@/lib/usePageMeta'

const DESCRIPTION = 'Synkra Design is a browser-based design studio. Make social posts, slides, posters and logos in your browser — no account needed to start.'

export default function LandingPage() {
  usePageMeta({ description: DESCRIPTION, canonical: '/', image: '/og-image.png' })
  return (
    <>
      <Hero />
      <LocalDesignsStrip />
    </>
  )
}
