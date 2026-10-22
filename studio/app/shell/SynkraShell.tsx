import { Clapperboard, Home, PenTool, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { Logo } from '@/ui'
import styles from './SynkraShell.module.css'

export type SynkraSection = 'home' | 'studio' | 'video' | 'ai'

const NAV = [
  { key: 'home', to: '/', label: 'Home', icon: Home },
  { key: 'studio', to: '/dashboard', label: 'Design Studio', icon: PenTool },
  { key: 'video', to: '/video-editor', label: 'Video Editor', icon: Clapperboard },
  { key: 'ai', to: '/ai-studio', label: 'AI Studio', icon: Sparkles },
] as const

const STUDIO_PREFIXES = ['/dashboard', '/create', '/design/', '/local/', '/settings']

function activeKey(pathname: string): SynkraSection {
  if (pathname.startsWith('/video-editor')) return 'video'
  if (pathname.startsWith('/ai-studio')) return 'ai'
  if (STUDIO_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return 'studio'
  return 'home'
}

function initials(user: { name: string; display_name: string; email: string }): string {
  const source = user.name || user.display_name || user.email
  const parts = source.trim().split(/[\s@._-]+/).filter(Boolean)
  const first = parts[0]?.[0] ?? 'S'
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + second).toUpperCase()
}

function SidebarUser() {
  const { status, user } = useAuth()
  if (status !== 'authenticated' || !user) {
    return (
      <Link to="/login" className={styles.signIn}>
        Sign in
      </Link>
    )
  }
  return (
    <Link to="/settings" className={styles.userCard} aria-label="Account settings">
      <span className={styles.userRow}>
        <span className={styles.avatar} aria-hidden="true">
          {user.avatar_url ? <img src={user.avatar_url} alt="" width={36} height={36} /> : initials(user)}
        </span>
        <span className={styles.userMeta}>
          <span className={styles.userName}>{user.name || user.display_name || user.email}</span>
          <span className={styles.userEmail}>{user.email}</span>
        </span>
      </span>
    </Link>
  )
}

/**
 * The SYNKRA Design application shell: a floating obsidian pill sidebar on desktop and a floating
 * bottom pill on small screens, per the Soft Bento Minimalism spec. `active` highlights the current
 * section. Home, Design Studio, Video Editor and AI Studio are the four destinations.
 */
export function SynkraShell({
  active,
  children,
}: {
  active?: SynkraSection
  children: ReactNode
}) {
  const location = useLocation()
  const section = active ?? activeKey(location.pathname)

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link to="/" className={styles.brand} aria-label="Synkra Design home">
          <span className={styles.brandMark} aria-hidden="true">
            <Logo variant="mark" height={26} />
          </span>
          <span className={styles.brandName}>
            Synkra <small>Design</small>
          </span>
        </Link>
        <nav aria-label="Synkra Design" className={styles.nav}>
          {NAV.map(({ key, to, label, icon: Icon }) => (
            <Link key={key} to={to} className={styles.link} data-active={section === key || undefined} aria-current={section === key ? 'page' : undefined}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <SidebarUser />
      </aside>

      <main id="main" tabIndex={-1} className={styles.content}>
        <div className={styles.frame}>{children}</div>
      </main>

      <nav aria-label="Synkra Design" className={styles.mobileNav}>
        {NAV.map(({ key, to, label, icon: Icon }) => (
          <Link key={key} to={to} className={styles.mobileLink} data-active={section === key || undefined} aria-label={label} aria-current={section === key ? 'page' : undefined}>
            <Icon aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </div>
  )
}
