import { http, API_BASE } from './client'

/**
 * SYNKRA Agent Studio (powered by OpenDesign) — typed API seam.
 * Library reads are public; projects are session-scoped. Agent turns stream
 * server-sent events over a raw fetch (the JSON seam cannot stream).
 */

export interface OdSkill {
  id: string
  name: string
  description: string
  category: string
  mode: string
  triggers: string[]
  source: 'skills' | 'templates'
  hasExample: boolean
}

export interface OdSkillDetail extends OdSkill {
  body: string
  exampleHtml: string | null
  upstream: string | null
}

export interface OdDesignSystem {
  id: string
  name: string
  category: string
  description: string
  accent: string | null
  palette: string[]
  languages: string[]
}

export interface OdDesignSystemDetail extends OdDesignSystem {
  designMd: string
  tokensCss: string
  tokensJson: string
  componentsHtml: string | null
  usage: string | null
}

export interface OdDirection {
  id: string
  label: string
  mood: string
  references: string[]
  displayFont: string
  bodyFont: string
  palette: { bg: string; surface: string; fg: string; muted: string; border: string; accent: string }
  posture: string[]
}

export interface OdPromptTemplate {
  id: string
  surface: string
  title: string
  summary: string
  category: string
  tags: string[]
  aspect: string | null
  prompt: string
}

export interface OdArtifactRef {
  id: string
  identifier: string
  kind: string
  title: string
  version: number
  status: string
  media_path: string | null
  updated_at: string
}

export interface OdTodo {
  content: string
  status: string
}

export interface OdMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  form_answers: { id?: string; form?: unknown } | null
  todos: OdTodo[]
  artifacts: Array<{ identifier: string; kind: string; title: string; artifact_id?: string }>
  error: string | null
  created_at: string
}

export interface OdProjectSummary {
  id: string
  title: string
  brief: string
  kind: string
  skill_id: string | null
  design_system_id: string | null
  direction: string | null
  status: string
  updated_at: string
  latest_artifact: { id: string; identifier: string; kind: string; title: string; media_path: string | null } | null
}

export interface OdProjectDetail {
  project: {
    id: string
    title: string
    brief: string
    kind: string
    skill_id: string | null
    design_system_id: string | null
    direction: string | null
    status: string
    created_at: string
    updated_at: string
  }
  messages: OdMessage[]
  artifacts: OdArtifactRef[]
}

export interface OdQuestionForm {
  id?: string
  title?: string
  lang?: string
  questions?: Array<{
    id: string
    label: string
    type: string
    required?: boolean
    options?: Array<string | { label: string; value?: string }>
    placeholder?: string
    default?: string | string[] | boolean | number
    maxSelections?: number
  }>
}

export type OdAgentEvent =
  | { type: 'status'; message: string }
  | { type: 'text'; delta: string }
  | { type: 'todos'; todos: OdTodo[] }
  | { type: 'form'; id: string; form: OdQuestionForm }
  | { type: 'artifact-start'; identifier: string; kind: string; title: string }
  | { type: 'artifact-chunk'; identifier: string; delta: string }
  | { type: 'artifact'; identifier: string; kind: string; title: string; artifact_id: string; version?: number; media_path?: string }
  | { type: 'artifact-end'; identifier: string; kind: string; title: string; content: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export const odApi = {
  skills: (query: { q?: string; category?: string; source?: string } = {}) =>
    http.get<{ count: number; categories: string[]; results: OdSkill[] }>('/od/library/skills/', { query }),
  skill: (id: string) => http.get<{ skill: OdSkillDetail }>(`/od/library/skills/${encodeURIComponent(id)}/`),
  designSystems: (query: { q?: string; category?: string } = {}) =>
    http.get<{ count: number; categories: string[]; results: OdDesignSystem[] }>('/od/library/design-systems/', { query }),
  designSystem: (id: string) => http.get<{ system: OdDesignSystemDetail }>(`/od/library/design-systems/${encodeURIComponent(id)}/`),
  directions: () => http.get<{ results: OdDirection[] }>('/od/library/directions/'),
  promptTemplates: (surface?: string) =>
    http.get<{ count: number; results: OdPromptTemplate[] }>('/od/library/prompt-templates/', { query: { surface } }),

  projects: () => http.get<{ results: OdProjectSummary[] }>('/od/projects/'),
  project: (id: string) => http.get<OdProjectDetail>(`/od/projects/${encodeURIComponent(id)}/`),
  createProject: (input: { brief: string; kind?: string; skill_id?: string | null; design_system_id?: string | null; direction?: string | null }) =>
    http.post<{ project: { id: string; title: string; kind: string } }>('/od/projects/', { json: input }),
  patchProject: (id: string, input: { title?: string; trashed?: boolean }) =>
    http.patch<{ ok: boolean }>(`/od/projects/${encodeURIComponent(id)}/`, { json: input }),
  deleteProject: (id: string) => http.delete<{ ok: boolean }>(`/od/projects/${encodeURIComponent(id)}/`),
}

/** Web path for an artifact's authed raw content (HTML/markdown/svg/image). */
export function odArtifactRawUrl(artifactId: string, download = false): string {
  return `${API_BASE}/od/artifacts/${encodeURIComponent(artifactId)}/raw${download ? '?download=1' : ''}`
}

/**
 * Streams one agent turn. Reads the SSE response line-by-line and dispatches
 * parsed events; resolves when the stream closes.
 */
export async function streamAgentTurn(
  projectId: string,
  input: { content: string; form_id?: string; form_answers?: Record<string, unknown> },
  onEvent: (event: OdAgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1]
    ?? localStorage.getItem('synkra.csrf')
  if (csrf) headers['X-CSRFToken'] = decodeURIComponent(csrf)
  const response = await fetch(`${API_BASE}/od/projects/${encodeURIComponent(projectId)}/messages/`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok || !response.body) {
    let message = 'The agent turn could not be started.'
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      if (body?.error?.message) message = body.error.message
    } catch { /* keep default */ }
    onEvent({ type: 'error', message })
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const line = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as OdAgentEvent)
      } catch { /* ignore malformed frame */ }
    }
  }
}
