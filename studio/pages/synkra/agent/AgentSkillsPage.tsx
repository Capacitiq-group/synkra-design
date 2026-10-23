import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Layers, Wand2, X } from 'lucide-react'
import { Button, EmptyState, Spinner } from '@/ui'
import { odApi, type OdSkillDetail } from '@/lib/api/od'
import { usePageMeta } from '@/lib/usePageMeta'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import styles from './agent.module.css'

export default function AgentSkillsPage() {
  usePageMeta({ title: 'Agent skills', noindex: true })
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search, 200)
  const [category, setCategory] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['od-skills', debounced, category],
    queryFn: () => odApi.skills({ q: debounced || undefined, category: category || undefined }),
  })
  const detail = useQuery({
    queryKey: ['od-skill', openId],
    queryFn: () => odApi.skill(openId ?? ''),
    enabled: Boolean(openId),
  })

  const categories = list.data?.categories ?? []
  const skills = list.data?.results ?? []
  const open: OdSkillDetail | null = detail.data?.skill ?? null

  const resultsLabel = useMemo(() => `${list.data?.count ?? 0} skills`, [list.data])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <Link to="/ai-studio" className={styles.linkButton} aria-label="Back to Agent Studio"><ArrowLeft size={16} /></Link>
          <h1 className={styles.title} style={{ fontSize: 'clamp(20px, 3.4vw, 26px)' }}>Skills library</h1>
          <span className={styles.byline}>powered by OpenDesign</span>
        </div>
        <p className={styles.lead}>
          Every skill ships as a plain, inspectable file — triggers, workflow, and seeds included.
          Start a project with one and the agent follows its playbook.
        </p>
      </header>

      <div className={styles.filterRow}>
        <input
          className={styles.search}
          placeholder="Search skills — deck, brand, dashboard, animation…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search skills"
        />
        <select className={styles.pillSelect} style={{ color: 'var(--color-text)', background: 'var(--synkra-bone)', borderColor: 'var(--synkra-card-border)' }} value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className={styles.count}>{resultsLabel}</span>
      </div>

      {list.isLoading ? (
        <div className={styles.emptyPane}><Spinner size={20} /> Loading library…</div>
      ) : skills.length === 0 ? (
        <EmptyState icon={<Layers size={26} />} title="No skills match" description="Try a different search or category." />
      ) : (
        <div className={styles.libraryGrid}>
          {skills.map((skill) => (
            <button key={`${skill.source}-${skill.id}`} type="button" className={styles.libCard} onClick={() => setOpenId(skill.id)}>
              <span className={styles.libCardName}>{skill.name}</span>
              <span className={styles.libCardDesc}>{skill.description || 'No description provided.'}</span>
              <span className={styles.tagRow}>
                <span className={styles.tag}>{skill.category}</span>
                <span className={styles.tag}>{skill.source === 'templates' ? 'template' : 'skill'}</span>
                {skill.hasExample ? <span className={styles.tag}>seed</span> : null}
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
                  <span className={styles.tag}>mode: {open.mode}</span>
                  <span className={styles.tag}>{open.source === 'templates' ? 'design template' : 'skill'}</span>
                </div>
              </div>
              <button type="button" className={styles.linkButton} onClick={() => setOpenId(null)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <p className={styles.cardHint} style={{ marginBottom: 0 }}>{open.description}</p>
            {open.triggers.length ? (
              <div className={styles.tagRow}>
                {open.triggers.slice(0, 8).map((trigger) => (
                  <span key={trigger} className={styles.tag}>{trigger}</span>
                ))}
              </div>
            ) : null}
            {detail.isLoading ? (
              <div className={styles.emptyPane}><Spinner size={18} /></div>
            ) : (
              <div className={styles.mdBody}>{open.body}</div>
            )}
            {open.exampleHtml ? (
              <details>
                <summary className={styles.linkButton} style={{ cursor: 'pointer' }}>Seed example preview</summary>
                <iframe
                  className={styles.framePreview}
                  title={`${open.name} example`}
                  sandbox="allow-scripts"
                  srcDoc={open.exampleHtml}
                  style={{ marginTop: 10 }}
                />
              </details>
            ) : null}
            <div className={styles.formActions}>
              {open.upstream ? (
                <a className={styles.linkButton} href={open.upstream} target="_blank" rel="noreferrer">Upstream reference</a>
              ) : null}
              <span className={styles.spacer} />
              <Link to={`/ai-studio?skill=${encodeURIComponent(open.id)}`} style={{ textDecoration: 'none' }} onClick={() => setOpenId(null)}>
                <Button size="sm"><Wand2 size={14} /> Start a project with this skill</Button>
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
