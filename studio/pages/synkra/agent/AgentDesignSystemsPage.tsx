import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Palette, Wand2, X } from 'lucide-react'
import { Button, EmptyState, Spinner } from '@/ui'
import { odApi, type OdDesignSystemDetail } from '@/lib/api/od'
import { usePageMeta } from '@/lib/usePageMeta'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import styles from './agent.module.css'

export default function AgentDesignSystemsPage() {
  usePageMeta({ title: 'Design systems', noindex: true })
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 200)
  const [category, setCategory] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['od-systems', debounced, category],
    queryFn: () => odApi.designSystems({ q: debounced || undefined, category: category || undefined }),
  })
  const detail = useQuery({
    queryKey: ['od-system', openId],
    queryFn: () => odApi.designSystem(openId ?? ''),
    enabled: Boolean(openId),
  })

  const categories = list.data?.categories ?? []
  const systems = list.data?.results ?? []
  const open: OdDesignSystemDetail | null = detail.data?.system ?? null

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <Link to="/ai-studio" className={styles.linkButton} aria-label="Back to Agent Studio"><ArrowLeft size={16} /></Link>
          <h1 className={styles.title} style={{ fontSize: 'clamp(20px, 3.4vw, 26px)' }}>Design systems</h1>
          <span className={styles.byline}>powered by OpenDesign</span>
        </div>
        <p className={styles.lead}>
          Brand-grade systems — palette, typography, spacing and component rules in one portable
          package. Bind one to a project and every artifact the agent builds follows its rules.
        </p>
      </header>

      <div className={styles.filterRow}>
        <input
          className={styles.search}
          placeholder="Search systems — Linear, Stripe, editorial, brutalism…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search design systems"
        />
        <select className={styles.pillSelect} style={{ color: 'var(--color-text)', background: 'var(--synkra-bone)', borderColor: 'var(--synkra-card-border)' }} value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className={styles.count}>{list.data?.count ?? 0} systems</span>
      </div>

      {list.isLoading ? (
        <div className={styles.emptyPane}><Spinner size={20} /> Loading library…</div>
      ) : systems.length === 0 ? (
        <EmptyState icon={<Palette size={26} />} title="No systems match" description="Try a different search or category." />
      ) : (
        <div className={styles.libraryGrid}>
          {systems.map((system) => (
            <button key={system.id} type="button" className={styles.libCard} onClick={() => setOpenId(system.id)}>
              <span className={styles.libCardName}>{system.name}</span>
              <span className={styles.libCardDesc}>{system.description}</span>
              {system.palette.length ? (
                <span className={styles.swatchRow} aria-hidden="true">
                  {system.palette.slice(0, 6).map((color, index) => (
                    <span key={index} className={styles.swatch} style={{ background: color }} />
                  ))}
                </span>
              ) : null}
              <span className={styles.tagRow}>
                <span className={styles.tag}>{system.category}</span>
                {system.languages.length > 1 ? <span className={styles.tag}>{system.languages.length} languages</span> : null}
              </span>
            </button>
          ))}
        </div>
      )}

      {open ? (
        <div className={styles.overlay} onClick={() => setOpenId(null)} role="dialog" aria-modal="true" aria-label={open.name}>
          <div className={styles.sheet} onClick={(event) => event.stopPropagation()}>
            <div className={styles.sheetHead}>
              <div>
                <h2 className={styles.sheetTitle}>{open.name}</h2>
                <div className={styles.tagRow} style={{ marginTop: 6 }}>
                  <span className={styles.tag}>{open.category}</span>
                </div>
              </div>
              <button type="button" className={styles.linkButton} onClick={() => setOpenId(null)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <p className={styles.cardHint} style={{ marginBottom: 0 }}>{open.description}</p>
            {open.palette.length ? (
              <div className={styles.swatchRow}>
                {open.palette.slice(0, 10).map((color, index) => (
                  <span key={index} className={styles.swatch} style={{ background: color, width: 32, height: 32 }} title={color} />
                ))}
              </div>
            ) : null}
            {detail.isLoading ? (
              <div className={styles.emptyPane}><Spinner size={18} /></div>
            ) : (
              <div className={styles.mdBody}>{open.designMd}</div>
            )}
            {open.componentsHtml ? (
              <details>
                <summary className={styles.linkButton} style={{ cursor: 'pointer' }}>Component reference preview</summary>
                <iframe
                  className={styles.framePreview}
                  title={`${open.name} components`}
                  sandbox="allow-scripts"
                  srcDoc={open.componentsHtml}
                  style={{ marginTop: 10 }}
                />
              </details>
            ) : null}
            <div className={styles.formActions}>
              <span className={styles.spacer} />
              <Link to={`/ai-studio?system=${encodeURIComponent(open.id)}`} style={{ textDecoration: 'none' }} onClick={() => setOpenId(null)}>
                <Button size="sm"><Wand2 size={14} /> Start a project with this system</Button>
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
