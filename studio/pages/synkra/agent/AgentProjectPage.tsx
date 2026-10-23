import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowUpRight, Check, Download, FileText, Image as ImageIcon, Loader2,
  MonitorPlay, Printer, Presentation, RefreshCw, Send, SquareCode,
} from 'lucide-react'
import { Button, Spinner } from '@/ui'
import { odApi, odArtifactRawUrl, streamAgentTurn, type OdAgentEvent, type OdQuestionForm, type OdTodo } from '@/lib/api/od'
import { usePageTitle } from '@/lib/usePageTitle'
import styles from './agent.module.css'

function kindIcon(kind: string, size = 13) {
  if (kind === 'deck') return <Presentation size={size} />
  if (kind === 'image') return <ImageIcon size={size} />
  if (kind === 'markdown-document' || kind === 'design-system') return <FileText size={size} />
  if (kind === 'svg') return <ImageIcon size={size} />
  return <SquareCode size={size} />
}

/** Tiny inline markdown: paragraphs + **bold** + `code` — enough for agent prose. */
function Prose({ text }: { text: string }) {
  const nodes = useMemo(() => {
    const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim())
    return paragraphs.map((paragraph, pIndex) => {
      const parts = paragraph.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
      return (
        <p key={pIndex} style={{ margin: paragraph === paragraphs[0] ? 0 : undefined, marginTop: pIndex === 0 ? 0 : 6 }}>
          {parts.map((part, partIndex) => {
            if (part.startsWith('**') && part.endsWith('**')) return <strong key={partIndex}>{part.slice(2, -2)}</strong>
            if (part.startsWith('`') && part.endsWith('`')) {
              return <code key={partIndex} style={{ background: 'rgb(0 0 0 / 0.06)', borderRadius: 6, padding: '1px 5px', fontSize: '0.92em' }}>{part.slice(1, -1)}</code>
            }
            return <span key={partIndex}>{part}</span>
          })}
        </p>
      )
    })
  }, [text])
  return <div>{nodes}</div>
}

function TodoCard({ todos }: { todos: OdTodo[] }) {
  if (!todos.length) return null
  return (
    <div className={styles.todoCard}>
      <span className={styles.todoTitle}>Plan</span>
      {todos.map((todo, index) => {
        const done = todo.status === 'completed'
        const active = todo.status === 'in_progress'
        return (
          <div key={index} className={`${styles.todoItem} ${done ? styles.todoDone : ''} ${active ? styles.todoActive : ''}`}>
            <span className={styles.todoCheck} aria-hidden="true">{done ? <Check size={10} strokeWidth={3.4} /> : null}</span>
            <span style={done ? { textDecoration: 'line-through', color: 'var(--color-text-muted)' } : undefined}>{todo.content}</span>
          </div>
        )
      })}
    </div>
  )
}

type FormAnswers = Record<string, string | string[]>

function QuestionFormCard({
  form,
  locked,
  onSubmit,
  busy,
}: {
  form: OdQuestionForm
  locked: boolean
  onSubmit: (formId: string, answers: FormAnswers, note: string) => void
  busy: boolean
}) {
  const questions = form.questions ?? []
  const initial = useMemo<FormAnswers>(() => {
    const out: FormAnswers = {}
    for (const question of questions) {
      if (question.default === undefined || question.default === null) continue
      out[question.id] = Array.isArray(question.default) ? question.default : String(question.default)
    }
    return out
  }, [form])
  const [answers, setAnswers] = useState<FormAnswers>(initial)
  const [note, setNote] = useState('')

  useEffect(() => {
    setAnswers(initial)
  }, [initial])

  const formId = form.id ?? 'discovery'
  const ready = questions.every((question) => {
    if (!question.required) return true
    const value = answers[question.id]
    return Array.isArray(value) ? value.length > 0 : Boolean(value)
  })

  const optionLabel = (option: string | { label: string; value?: string }): { label: string; value: string } => {
    if (typeof option === 'string') return { label: option, value: option }
    return { label: option.label, value: option.value ?? option.label }
  }

  const setAnswer = (id: string, value: string | string[]) => setAnswers((prev) => ({ ...prev, [id]: value }))

  if (!questions.length) return null

  return (
    <div className={styles.formCard}>
      <h3 className={styles.formTitle}>{form.title ?? 'Quick brief — 30 seconds'}</h3>
      {questions.map((question) => {
        const value = answers[question.id]
        const options = (question.options ?? []).map(optionLabel)
        if (question.type === 'radio') {
          return (
            <div key={question.id} className={styles.formQuestion}>
              <span className={styles.formQuestionLabel}>{question.label}{question.required ? ' *' : ''}</span>
              <div className={styles.optionChips}>
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={locked}
                    className={`${styles.optionChip} ${value === option.value ? styles.optionChipSelected : ''}`}
                    onClick={() => setAnswer(question.id, option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )
        }
        if (question.type === 'checkbox') {
          const list = Array.isArray(value) ? value : []
          return (
            <div key={question.id} className={styles.formQuestion}>
              <span className={styles.formQuestionLabel}>{question.label}</span>
              <div className={styles.optionChips}>
                {options.map((option) => {
                  const selected = list.includes(option.value)
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={locked}
                      className={`${styles.optionChip} ${selected ? styles.optionChipSelected : ''}`}
                      onClick={() => {
                        if (selected) setAnswer(question.id, list.filter((v) => v !== option.value))
                        else if (!question.maxSelections || list.length < question.maxSelections) setAnswer(question.id, [...list, option.value])
                      }}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        }
        if (question.type === 'select') {
          return (
            <div key={question.id} className={styles.formQuestion}>
              <span className={styles.formQuestionLabel}>{question.label}</span>
              <select
                className={styles.formInput}
                value={typeof value === 'string' ? value : ''}
                disabled={locked}
                onChange={(event) => setAnswer(question.id, event.target.value)}
              >
                <option value="">Choose…</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          )
        }
        if (question.type === 'switch') {
          const on = value === 'true'
          return (
            <div key={question.id} className={styles.formQuestion}>
              <span className={styles.formQuestionLabel}>{question.label}</span>
              <div className={styles.optionChips}>
                <button type="button" disabled={locked} className={`${styles.optionChip} ${on ? styles.optionChipSelected : ''}`} onClick={() => setAnswer(question.id, on ? 'false' : 'true')}>
                  {on ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          )
        }
        // text / textarea / number / date / email / url / color …
        const isTextarea = question.type === 'textarea'
        return (
          <div key={question.id} className={styles.formQuestion}>
            <span className={styles.formQuestionLabel}>{question.label}</span>
            {isTextarea ? (
              <textarea
                className={styles.formInput}
                rows={3}
                placeholder={question.placeholder}
                value={typeof value === 'string' ? value : ''}
                disabled={locked}
                onChange={(event) => setAnswer(question.id, event.target.value)}
              />
            ) : (
              <input
                className={styles.formInput}
                type={question.type === 'number' ? 'number' : question.type === 'date' ? 'date' : question.type === 'color' ? 'color' : 'text'}
                placeholder={question.placeholder}
                value={typeof value === 'string' ? value : ''}
                disabled={locked}
                onChange={(event) => setAnswer(question.id, event.target.value)}
              />
            )}
          </div>
        )
      })}
      {locked ? (
        <span className={styles.lockedNote}>Answers submitted — the conversation continues below.</span>
      ) : (
        <div className={styles.formActions}>
          <input
            className={styles.formInput}
            style={{ flex: 1 }}
            placeholder="Optional note for the agent…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button size="sm" disabled={!ready || busy} onClick={() => onSubmit(formId, answers, note)}>
            {busy ? <Spinner size={14} /> : <Send size={13} />} Submit
          </Button>
        </div>
      )}
    </div>
  )
}

interface LiveTurn {
  status: string | null
  userContent: string | null
  text: string
  todos: OdTodo[]
  form: OdQuestionForm | null
  formId: string | null
  artifacts: Array<{ identifier: string; kind: string; title: string; artifact_id?: string }>
  error: string | null
}

export default function AgentProjectPage() {
  const { id = '' } = useParams()
  usePageTitle('Agent project')
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [live, setLive] = useState<LiveTurn | null>(null)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [formBusy, setFormBusy] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const streamRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const project = useQuery({
    queryKey: ['od-project', id],
    queryFn: () => odApi.project(id),
    refetchOnWindowFocus: false,
  })

  const messages = project.data?.messages ?? []
  const artifacts = project.data?.artifacts ?? []
  const activeArtifact = useMemo(
    () => artifacts.find((a) => a.id === activeArtifactId) ?? artifacts[0] ?? null,
    [artifacts, activeArtifactId],
  )

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight })
  }, [live?.text, live?.todos, live?.status, messages.length])

  const runTurn = useCallback(async (content: string, formId?: string, formAnswers?: FormAnswers) => {
    setGlobalError(null)
    setFormBusy(true)
    setLive({ status: 'Thinking', userContent: formId ? null : content, text: '', todos: [], form: null, formId: null, artifacts: [], error: null })
    const controller = new AbortController()
    abortRef.current = controller
    let lastForm: OdQuestionForm | null = null
    let lastFormId: string | null = null
    try {
      await streamAgentTurn(
        id,
        { content, form_id: formId, form_answers: formAnswers },
        (event: OdAgentEvent) => {
          setLive((prev) => {
            const base: LiveTurn = prev ?? { status: null, userContent: formId ? null : content, text: '', todos: [], form: null, formId: null, artifacts: [], error: null }
            switch (event.type) {
              case 'status': return { ...base, status: event.message }
              case 'text': return { ...base, status: null, text: base.text + event.delta }
              case 'todos': return { ...base, todos: event.todos }
              case 'form':
                lastForm = event.form
                lastFormId = event.id
                return { ...base, form: event.form, formId: event.id }
              case 'artifact':
                return {
                  ...base,
                  artifacts: base.artifacts.some((a) => a.artifact_id === event.artifact_id)
                    ? base.artifacts
                    : [...base.artifacts, { identifier: event.identifier, kind: event.kind, title: event.title, artifact_id: event.artifact_id }],
                }
              case 'error': return { ...base, error: event.message, status: null }
              default: return base
            }
          })
        },
        controller.signal,
      )
    } catch {
      setGlobalError('The agent turn was interrupted.')
    }
    setFormBusy(false)
    // The refetched server snapshot carries the assistant message (and its
    // form when the model asked one) — drop the live turn to avoid double
    // rendering, then refresh.
    setLive(null)
    await queryClient.invalidateQueries({ queryKey: ['od-project', id] })
    await queryClient.invalidateQueries({ queryKey: ['od-projects'] })
  }, [id, queryClient])

  const send = () => {
    const content = input.trim()
    if (!content || formBusy) return
    setInput('')
    void runTurn(content)
  }

  const submitForm = (formId: string, answers: FormAnswers, note: string) => {
    void runTurn(note || 'Submit', formId, answers)
  }

  useEffect(() => () => abortRef.current?.abort(), [])

  // Auto-run the first agent turn from the project brief when the conversation is empty.
  const autoRanRef = useRef(false)
  const messagesCount = project.data?.messages.length ?? -1
  useEffect(() => {
    if (autoRanRef.current) return
    if (!project.data || project.isError) return
    if (messagesCount !== 0) return
    autoRanRef.current = true
    void runTurn(project.data.project.brief)
  }, [project.data, project.isError, messagesCount, runTurn])

  if (project.isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyPane}><Loader2 size={22} className={styles.spin} /> Loading project…</div>
      </div>
    )
  }
  if (project.isError || !project.data) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.cardHint}>This project does not exist or is not yours.</p>
          <Link to="/ai-studio" className={styles.linkButton}><ArrowLeft size={14} /> Back to Agent Studio</Link>
        </div>
      </div>
    )
  }

  const info = project.data.project

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <Link to="/ai-studio" className={styles.linkButton} aria-label="Back to Agent Studio"><ArrowLeft size={16} /></Link>
          <h1 className={styles.title} style={{ fontSize: 'clamp(18px, 3vw, 24px)' }}>{info.title}</h1>
          <span className={styles.kindBadge}>{info.kind}</span>
          {info.design_system_id ? <span className={styles.tag}>{info.design_system_id}</span> : null}
          {info.direction ? <span className={styles.tag}>{info.direction}</span> : null}
        </div>
      </header>

      <div className={styles.studioGrid}>
        <section className={`${styles.card} ${styles.chatColumn}`} aria-label="Conversation">
          <div className={styles.stream} ref={streamRef}>
            {messages.map((message) => {
              if (message.role === 'user') {
                const isFormAnswer = message.content.startsWith('[form answers')
                return (
                  <div key={message.id} className={styles.turn}>
                    <div className={`${styles.bubble} ${styles.bubbleUser}`}>
                      <Prose text={isFormAnswer ? message.content.split('\n\n').slice(1).join('\n\n') || message.content : message.content} />
                    </div>
                  </div>
                )
              }
              const isLast = message.id === messages[messages.length - 1]?.id
              const messageForm = message.form_answers?.form as OdQuestionForm | undefined
              return (
                <div key={message.id} className={styles.turn}>
                  {message.content ? (
                    <div className={`${styles.bubble} ${styles.bubbleAgent}`}><Prose text={message.content} /></div>
                  ) : null}
                  {message.todos?.length ? <TodoCard todos={message.todos} /> : null}
                  {message.artifacts?.length ? (
                    <div className={styles.artifactChipRow}>
                      {message.artifacts.map((ref, index) => (
                        <button
                          key={`${ref.identifier}-${index}`}
                          type="button"
                          className={styles.artifactChip}
                          onClick={() => ref.artifact_id && setActiveArtifactId(ref.artifact_id)}
                        >
                          {kindIcon(ref.kind)} {ref.title || ref.identifier} <ArrowUpRight size={12} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {messageForm && isLast ? (
                    <QuestionFormCard
                      form={messageForm}
                      locked={formBusy}
                      busy={formBusy}
                      onSubmit={submitForm}
                    />
                  ) : null}
                  {message.error ? (
                    <div className={`${styles.bubble} ${styles.bubbleAgent}`} style={{ borderColor: '#f2b8a2' }}>
                      <Prose text={message.error} />
                    </div>
                  ) : null}
                </div>
              )
            })}

            {live ? (
              <div className={styles.turn}>
                {live.userContent ? (
                  <div className={`${styles.bubble} ${styles.bubbleUser}`}><Prose text={live.userContent} /></div>
                ) : null}
                {live.status ? (
                  <span className={styles.statusLine}><Loader2 size={13} className={styles.spin} /> {live.status}…</span>
                ) : null}
                {live.text ? <div className={`${styles.bubble} ${styles.bubbleAgent}`}><Prose text={live.text} /></div> : null}
                {live.todos.length ? <TodoCard todos={live.todos} /> : null}
                {live.form ? (
                  <QuestionFormCard form={live.form} locked={false} busy={formBusy} onSubmit={submitForm} />
                ) : null}
                {live.artifacts.length ? (
                  <div className={styles.artifactChipRow}>
                    {live.artifacts.map((ref) => (
                      <button key={ref.artifact_id ?? ref.identifier} type="button" className={styles.artifactChip}
                        onClick={() => ref.artifact_id && setActiveArtifactId(ref.artifact_id)}>
                        {kindIcon(ref.kind)} {ref.title || ref.identifier} <ArrowUpRight size={12} />
                      </button>
                    ))}
                  </div>
                ) : null}
                {live.error ? <div className={`${styles.bubble} ${styles.bubbleAgent}`}><Prose text={live.error} /></div> : null}
              </div>
            ) : null}

            {messages.length === 0 && !live ? (
              <div className={styles.emptyPane}>
                The agent will start from the brief. It may ask a 30-second form first —
                then it plans, builds, and refines with you.
              </div>
            ) : null}
          </div>

          <div className={styles.composerBar}>
            <textarea
              className={styles.composerInput}
              placeholder="Refine, redirect, or ask for a new artifact… (Enter to send)"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
              disabled={formBusy}
              rows={1}
            />
            <Button onClick={send} disabled={formBusy || !input.trim()} aria-label="Send">
              {formBusy ? <Spinner size={15} /> : <Send size={15} />}
            </Button>
          </div>
          {globalError ? <p role="alert" style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: '#b3591e' }}>{globalError}</p> : null}
        </section>

        <section className={`${styles.card} ${styles.artifactPane}`} aria-label="Artifact preview">
          <div className={styles.artifactHead}>
            <h2 className={styles.artifactName}>
              {activeArtifact ? kindIcon(activeArtifact.kind, 15) : <MonitorPlay size={15} />}
              <span>{activeArtifact ? activeArtifact.title || activeArtifact.identifier : 'Artifact preview'}</span>
              {activeArtifact ? <span className={styles.tag}>v{activeArtifact.version}</span> : null}
            </h2>
            {activeArtifact ? (
              <div className={styles.artifactActions}>
                <a className={styles.linkButton} href={odArtifactRawUrl(activeArtifact.id)} target="_blank" rel="noreferrer">
                  <ArrowUpRight size={13} /> Open
                </a>
                {activeArtifact.kind === 'deck' || activeArtifact.kind === 'html' ? (
                  <button type="button" className={styles.linkButton} onClick={() => {
                    const win = window.open(odArtifactRawUrl(activeArtifact.id), '_blank')
                    win?.addEventListener('load', () => win.print())
                  }}>
                    <Printer size={13} /> PDF
                  </button>
                ) : null}
                <a className={styles.linkButton} href={odArtifactRawUrl(activeArtifact.id, true)}>
                  <Download size={13} /> Download
                </a>
              </div>
            ) : null}
          </div>

          {artifacts.length > 1 ? (
            <div className={styles.artifactRail} role="tablist" aria-label="Project artifacts">
              {artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  type="button"
                  role="tab"
                  aria-selected={artifact.id === activeArtifact?.id}
                  className={`${styles.railItem} ${artifact.id === activeArtifact?.id ? styles.railItemActive : ''}`}
                  onClick={() => setActiveArtifactId(artifact.id)}
                >
                  {kindIcon(artifact.kind, 12)} {artifact.title || artifact.identifier}
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.artifactFrameWrap}>
            {!activeArtifact ? (
              <div className={styles.emptyPane}>
                Artifacts appear here as the agent builds them — previews render live and stay
                interactive while you refine.
              </div>
            ) : activeArtifact.kind === 'image' ? (
              <img
                src={odArtifactRawUrl(activeArtifact.id)}
                alt={activeArtifact.title || activeArtifact.identifier}
                style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'inherit' }}
              />
            ) : activeArtifact.kind === 'markdown-document' || activeArtifact.kind === 'design-system' ? (
              <MarkdownFrame artifactId={activeArtifact.id} />
            ) : (
              <iframe
                key={activeArtifact.id}
                className={styles.artifactFrame}
                src={odArtifactRawUrl(activeArtifact.id)}
                title={activeArtifact.title || activeArtifact.identifier}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              />
            )}
          </div>
        </section>
      </div>

      <footer className={styles.row} style={{ padding: '0 6px' }}>
        <span className={styles.count}>
          {artifacts.length} artifact{artifacts.length === 1 ? '' : 's'} · engine adapted from OpenDesign (Apache-2.0)
        </span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => {
            const title = window.prompt('Rename project', info.title)
            if (title && title.trim()) {
              void odApi.patchProject(id, { title: title.trim() }).then(() => queryClient.invalidateQueries({ queryKey: ['od-project', id] }))
            }
          }}
        >
          <RefreshCw size={12} /> Rename
        </button>
      </footer>
    </div>
  )
}

/** Fetches a markdown artifact and renders it as preformatted text (safe, no raw HTML). */
function MarkdownFrame({ artifactId }: { artifactId: string }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(odArtifactRawUrl(artifactId), { credentials: 'include' })
      .then((response) => response.text())
      .then((body) => { if (!cancelled) setText(body) })
      .catch(() => { if (!cancelled) setText('Could not load the document.') })
    return () => { cancelled = true }
  }, [artifactId])
  if (text === null) return <div className={styles.emptyPane}><Spinner size={18} /></div>
  return <div className={styles.mdBody} style={{ maxHeight: 'none', flex: 1 }}><Prose text={text} /></div>
}
