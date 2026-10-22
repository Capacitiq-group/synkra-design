import { ArrowRight, ArrowUpRight, Clapperboard, Folder, LayoutTemplate, Palette, PenTool, Sparkles, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SynkraShell } from '@/app/shell/SynkraShell'
import { DesignTile } from '@/features/dashboard/DesignTile'
import { UsageMeter } from '@/features/uploads/UsageMeter'
import { useAuth } from '@/features/auth/AuthProvider'
import { useDesignsList } from '@/lib/api/hooks'
import { usePageMeta } from '@/lib/usePageMeta'
import { Button, EmptyState, Skeleton } from '@/ui'
import styles from './SynkraHomePage.module.css'

const QUICK_LINKS = [
  { to: '/dashboard/designs', label: 'My designs', icon: Folder },
  { to: '/dashboard/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/dashboard/brand', label: 'Brand kits', icon: Palette },
  { to: '/dashboard/uploads', label: 'Uploads', icon: Upload },
]

function RecentSkeletons() {
  return (
    <div className={styles.skeletonRow} aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className={styles.skeletonItem}>
          <Skeleton height="7.5rem" radius="var(--radius-inner)" />
          <Skeleton width="60%" height={14} />
        </div>
      ))}
    </div>
  )
}

/** The SYNKRA Design home dashboard — the page users land on after signing up or logging in. */
export default function SynkraHomePage() {
  const { user } = useAuth()
  const recent = useDesignsList({ ordering: '-updated_at', page_size: 8 })
  const recentItems = recent.data?.pages[0]?.results ?? []
  const firstName = (user?.name || user?.display_name || '').split(' ')[0]

  usePageMeta({ title: 'Home', noindex: true })

  return (
    <SynkraShell active="home">
      <header className={styles.header}>
        <h1 className={styles.title}>{firstName ? `Welcome back, ${firstName}` : 'Welcome to Synkra Design'}</h1>
        <p className={styles.lead}>Pick up where you left off, or start something new.</p>
      </header>

      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.studioCard}`} aria-labelledby="home-studio">
          <div>
            <span className={`${styles.cardEyebrow} ${styles.studioEyebrow}`}>Main workspace</span>
            <h2 id="home-studio" className={styles.cardTitle}>
              Design Studio
            </h2>
            <p className={styles.cardText}>
              The complete editor: templates, brand kits, layers, animation, background removal and exports to PNG, JPG, SVG, PDF, MP4 or GIF.
            </p>
            <div className={styles.studioActions}>
              <Link to="/dashboard" className={styles.limeButton}>
                Open Design Studio
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link to="/create" className={styles.ghostButton}>
                Start a new design
              </Link>
            </div>
          </div>
        </section>

        <section className={`${styles.card} ${styles.videoCard}`} aria-labelledby="home-video">
          <span className={styles.iconCircle} aria-hidden="true">
            <Clapperboard size={22} />
          </span>
          <h2 id="home-video" className={styles.cardTitle}>
            Video Editor
          </h2>
          <span className={`${styles.cardEyebrow} ${styles.soonBadge}`}>Coming soon</span>
          <p className={styles.cardText}>A dedicated video editing workspace is being prepared for Synkra Design.</p>
          <Link to="/video-editor" className={styles.cardLink}>
            See what’s planned
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </section>

        <section className={`${styles.card} ${styles.aiCard}`} aria-labelledby="home-ai">
          <span className={styles.iconCircle} aria-hidden="true">
            <Sparkles size={22} />
          </span>
          <h2 id="home-ai" className={styles.cardTitle}>
            AI Studio
          </h2>
          <span className={`${styles.cardEyebrow} ${styles.soonBadge}`}>Coming soon</span>
          <p className={styles.cardText}>AI-assisted design tools are on their way to Synkra Design.</p>
          <Link to="/ai-studio" className={styles.cardLink}>
            See what’s planned
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </section>

        <section className={`${styles.card} ${styles.recentCard}`} aria-labelledby="home-recent">
          <div className={styles.recentHead}>
            <h2 id="home-recent">Recent designs</h2>
            <Link to="/dashboard/designs" className={styles.viewAll}>
              View all
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          {recent.isPending ? (
            <RecentSkeletons />
          ) : recent.isError ? (
            <EmptyState
              compact
              title="Your designs didn’t load"
              role="alert"
              action={<Button onClick={() => void recent.refetch()}>Try again</Button>}
            />
          ) : recentItems.length === 0 ? (
            <EmptyState
              compact
              icon={<PenTool size={24} aria-hidden="true" />}
              title="No designs yet"
              description="Everything you make in the Design Studio shows up here."
              action={
                <Link to="/dashboard" className={styles.limeButton}>
                  Open Design Studio
                  <ArrowRight aria-hidden="true" />
                </Link>
              }
            />
          ) : (
            <ul className={styles.tileGrid}>
              {recentItems.map((design) => (
                <li key={design.id}>
                  <DesignTile design={design} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className={styles.sideColumn}>
          <section className={styles.card} aria-labelledby="home-quick">
            <div className={styles.recentHead}>
              <h2 id="home-quick">Quick access</h2>
            </div>
            <nav aria-label="Design Studio shortcuts" className={styles.quickGrid}>
              {QUICK_LINKS.map(({ to, label, icon: Icon }) => (
                <Link key={to} to={to} className={styles.quickLink}>
                  <Icon aria-hidden="true" />
                  <span className={styles.quickLabel}>{label}</span>
                </Link>
              ))}
            </nav>
          </section>

          <section className={`${styles.card} ${styles.storageCard}`} aria-labelledby="home-storage">
            <div className={styles.storageHead}>
              <h2 id="home-storage">Storage</h2>
            </div>
            <UsageMeter />
          </section>
        </div>
      </div>
    </SynkraShell>
  )
}
