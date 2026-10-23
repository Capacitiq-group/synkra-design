import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ArrowUpRight, Layers, Palette, Sparkles, Wand2 } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button, EmptyState, Skeleton } from '@/ui'
import { odApi, type OdDirection, type OdDesignSystem } from '@/lib/api/od'
import { usePageMeta } from '@/lib/usePageMeta'
import styles from './agent.module.css'

const KINDS = [
  { value: 'prototype', label: 'Prototype / landing' },
  { value: 'deck', label: 'Slide deck / pitch' },
  { value: 'dashboard', label: 'Dashboard / tool UI' },
  { value: 'document', label: 'Document / editorial' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Motion / HyperFrames' },
  { value: 'other', label: 'Something else' },
]

const EXAMPLES = [
  'A pitch deck for a B2B SaaS that automates freight audits — 10 slides, investor audience',
  'Landing page for a companion-planting garden planner, warm editorial style',
  'A churn-risk dashboard for a subscription box company — KPI cards and two charts',
  'A minimalist portfolio for a ceramic artist with three project case studies',
  'A poster image for a jazz night at a rooftop bar, art-deco palette',
]

function formatKind(kind: string): string {
  return kind.replace(/-/g, ' ')
}

export default function AgentHomePage() {
  usePageMeta({ title: 'Agent Studio', noindex: true })
  const { status, user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [brief, setBrief] = useState('')
  const [kind, setKind] = useState('prototype')
  const [direction, setDirection] = useState('')
  const [designSystemId, setDesignSystemId] = useState(searchParams.get('system') ?? '')
  const [skillId] = useState(searchParams.get('skill') ?? '')
  const [error, setError] = useState<string | null>(null)

  const directions = useQuery({ queryKey: ['od-directions'], queryFn: () => odApi.directions() })
  const systems = useQuery({ queryKey: ['od-systems-index'], queryFn: () => odApi.designSystems() })
  const projects = useQuery({
    queryKey: ['od-projects'],
    queryFn: () => odApi.projects(),
    enabled: status === 'authenticated',
  })

  const directionList: OdDirection[] = directions.data?.results ?? []
  const systemList: OdDesignSystem[] = useMemo(() => systems.data?.results ?? [], [systems.data])
  const recent = projects.data?.results.slice(0, 8) ?? []

  const create = useMutation({
    mutationFn: () =>
      odApi.createProject({
        brief: brief.trim(),
        kind,
        direction: direction || null,
        design_system_id: designSystemId || null,
        skill_id: skillId || null,
      }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['od-projects'] })
      navigate(`/ai-studio/projects/${data.project.id}`)
    },
    onError: (err: Error) => setError(err.message || 'The project could not be created.'),
  })

  const submit = () => {
    setError(null)
    if (!brief.trim()) {
      setError('Describe what you want to make first — one or two sentences is enough.')
      return
    }
    create.mutate()
  }

  const libraryCount = systems.data?.count

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>Agent Studio</h1>
          <span className={styles.byline}>powered by OpenDesign</span>
        </div>
        <p className={styles.lead}>
          Brief a design agent, answer a 30-second form, and watch it plan, build and refine
          prototypes, decks, dashboards, documents and images — then export them.
        </p>
      </header>

      <section className={`${styles.card} ${styles.composerCard}`} aria-labelledby="brief-label">
        <span className={styles.eyebrow}><Sparkles size={12} strokeWidth={2.4} /> New project</span>
        <label htmlFor="od-brief" className={styles.optionLabel} id="brief-label">
          Describe what you want to make
        </label>
        <textarea
          id="od-brief"
          className={styles.brief}
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="e.g. A landing page for our eco-friendly cleaning refill subscription — calm palette, three plans, testimonials"
          rows={4}
          maxLength={8000}
        />
        <div className={styles.optionRow}>
          <span className={styles.optionLabel}>Output</span>
          <select className={styles.pillSelect} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Output type">
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
          <span className={styles.optionLabel}>Direction</span>
          <select className={styles.pillSelect} value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Visual direction">
            <option value="">Pick for me</option>
            {directionList.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <span className={styles.optionLabel}>Brand</span>
          <select className={styles.pillSelect} value={designSystemId} onChange={(e) => setDesignSystemId(e.target.value)} aria-label="Design system">
            <option value="">No design system</option>
            {systemList.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className={styles.composerActions}>
          <div className={styles.exampleChips}>
            {EXAMPLES.slice(0, 3).map((example) => (
              <button key={example} type="button" className={styles.chip} onClick={() => setBrief(example)}>
                {example.length > 64 ? `${example.slice(0, 61)}…` : example}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.composerActions}>
          <span className={styles.count} style={{ color: 'rgb(251 251 252 / 0.55)' }}>
            {skillId ? `Skill bound: ${skillId}. ` : ''}
            {designSystemId ? `Design system bound: ${designSystemId}. ` : ''}
            The agent will ask a quick brief form when details matter.
          </span>
          {status === 'authenticated' ? (
            <Button onClick={submit} disabled={create.isPending}>
              <Wand2 size={15} strokeWidth={2.2} /> {create.isPending ? 'Starting…' : 'Create with agent'}
            </Button>
          ) : (
            <Link to="/login?next=%2Fai-studio" style={{ textDecoration: 'none' }}>
              <Button><Wand2 size={15} strokeWidth={2.2} /> Sign in to create</Button>
            </Link>
          )}
        </div>
        {error ? (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: '#ffb4a0' }}>{error}</p>
        ) : null}
      </section>

      {status === 'authenticated' ? (
        <section className={styles.card} aria-labelledby="recent-projects">
          <h2 id="recent-projects" className={styles.cardTitle}>Recent projects</h2>
          <p className={styles.cardHint}>Everything you and the agent have built together.</p>
          {projects.isLoading ? (
            <div className={styles.projectGrid} aria-hidden="true">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={styles.projectTile}><Skeleton height={52} radius="12px" /></div>
              ))}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Sparkles size={26} />}
              title="No agent projects yet"
              description="Write a brief above and the agent will take it from there — plan, build, refine."
            />
          ) : (
            <div className={styles.projectGrid}>
              {recent.map((project) => (
                <Link key={project.id} to={`/ai-studio/projects/${project.id}`} className={styles.projectTile}>
                  <span className={styles.projectTileTitle}>{project.title}</span>
                  <span className={styles.projectTileMeta}>
                    <span className={styles.kindBadge}>{formatKind(project.kind)}</span>
                    <span className={`${styles.statusBadge} ${project.status === 'running' ? styles.statusRunning : ''}`}>
                      {project.status}
                    </span>
                    <span>{new Date(project.updated_at).toLocaleDateString()}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <div className={styles.grid12}>
        <Link to="/ai-studio/skills" className={`${styles.card} ${styles.span6}`} style={{ textDecoration: 'none' }}>
          <span className={styles.row}>
            <Layers size={18} strokeWidth={2.2} />
            <h2 className={styles.cardTitle} style={{ margin: 0 }}>Skills library</h2>
            <span className={styles.spacer} />
            <ArrowUpRight size={16} />
          </span>
          <p className={styles.cardHint} style={{ marginBottom: 0 }}>
            284 scenario skills — decks, brand kits, dashboards, motion, copywriting, data reports and
            more. Browse the catalogue, inspect how each one works, and start a project with it.
          </p>
        </Link>
        <Link to="/ai-studio/design-systems" className={`${styles.card} ${styles.span6}`} style={{ textDecoration: 'none' }}>
          <span className={styles.row}>
            <Palette size={18} strokeWidth={2.2} />
            <h2 className={styles.cardTitle} style={{ margin: 0 }}>Design systems</h2>
            <span className={styles.spacer} />
            <ArrowUpRight size={16} />
          </span>
          <p className={styles.cardHint} style={{ marginBottom: 0 }}>
            {libraryCount ?? 152} brand-grade design systems with tokens, typography and component
            references. Bind one to a project and every artifact follows its rules.
          </p>
        </Link>
      </div>

      <footer className={styles.row} style={{ justifyContent: 'space-between', padding: '0 6px' }}>
        <span className={styles.count}>
          Agent engine adapted from OpenDesign (nexu-io/open-design) under the Apache-2.0 license.
        </span>
        <Link to="/dashboard" className={styles.linkButton}>
          Dashboard <ArrowRight size={14} />
        </Link>
      </footer>
    </div>
  )
}
