import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { SynkraShell, type SynkraSection } from '@/app/shell/SynkraShell'
import { usePageMeta } from '@/lib/usePageMeta'
import { LinkButton } from '@/ui'
import styles from './ComingSoon.module.css'

export interface ComingSoonProps {
  section: Extract<SynkraSection, 'video' | 'ai'>
  /** Browser title (· Synkra is appended). */
  title: string
  metaDescription: string
  icon: ReactNode
  tint: 'sky' | 'peach'
  /** What this area will become — kept honest: it is not available yet. */
  description: string
  /** A pointer to the closest capability that exists today, if any. */
  note?: string
}

/**
 * Polished placeholder for a future SYNKRA product area. It renders in the application shell so
 * navigation keeps working, and it says plainly that the functionality is not available yet.
 */
export function ComingSoonPage({ section, title, metaDescription, icon, tint, description, note }: ComingSoonProps) {
  usePageMeta({ title, description: metaDescription })

  return (
    <SynkraShell active={section}>
      <div className={styles.wrap}>
        <section className={styles.card} aria-labelledby="coming-soon-title">
          <span className={styles.iconCircle} data-tint={tint} aria-hidden="true">
            {icon}
          </span>
          <span className={styles.eyebrow}>Coming soon</span>
          <h1 id="coming-soon-title" className={styles.title}>
            {title}
          </h1>
          <p className={styles.text}>{description}</p>
          {note ? <p className={styles.note}>{note}</p> : null}
          <div className={styles.actions}>
            <Link to="/" className={styles.homeButton}>
              Back to Home
            </Link>
            <LinkButton to="/dashboard" variant="secondary" size="lg" rightIcon={<ArrowRight size={16} aria-hidden="true" />}>
              Open Design Studio
            </LinkButton>
          </div>
        </section>
      </div>
    </SynkraShell>
  )
}
