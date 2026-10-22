import { lazy, Suspense } from 'react'
import { PageLoader } from '@/app/PageLoader'
import { MarketingLayout } from '@/app/layouts/MarketingLayout'
import { useAuth } from '@/features/auth/AuthProvider'
import SynkraHomePage from './SynkraHomePage'

const LandingPage = lazy(() => import('@/pages/LandingPage'))

/**
 * The `/` route. Signed-in users get the SYNKRA Design home dashboard (the default landing page
 * after signup and login); everyone else sees the marketing landing page at the same address.
 */
export default function HomeGate() {
  const { status } = useAuth()

  if (status === 'loading') return <PageLoader label="Loading Synkra Design" />
  if (status === 'authenticated') return <SynkraHomePage />

  return (
    <MarketingLayout>
      <Suspense fallback={<PageLoader />}>
        <LandingPage />
      </Suspense>
    </MarketingLayout>
  )
}
