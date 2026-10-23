/**
 * SYNKRA Agent Studio — agent engine.
 *
 * Adapted from OpenDesign's agent loop (nexu-io/open-design, Apache-2.0):
 * the model streams a reply; the host extracts structured blocks using the
 * same wire formats OD's host parses —
 *   <artifact identifier="…" type="…" title="…">…</artifact>
 *   <question-form id="…">{json}</question-form>
 *   <todo-list id="…">[json]</todo-list>
 * — renders prose as markdown, and persists artifacts with versions.
 *
 * The engine is BYO-agent by design: today it drives the built-in SYNKRA LLM
 * (z-ai-web-dev-sdk, GLM). The same block protocol is what OD's 21 external
 * coding-agent adapters emit, so swapping in an external adapter later does
 * not require touching consumers.
 */
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'
import path from 'node:path'
import { composeSystemPrompt } from './prompts'
import { getDesignSystem, getSkill, listDirections, odMediaDir, type OdDirection } from './library'

export interface AgentChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'text'; delta: string }
  | { type: 'todos'; todos: Array<{ content: string; status: string }> }
  | { type: 'form'; id: string; form: unknown }
  | { type: 'artifact-start'; identifier: string; kind: string; title: string }
  | { type: 'artifact-chunk'; identifier: string; delta: string }
  | { type: 'artifact-end'; identifier: string; kind: string; title: string; content: string }
  | { type: 'media'; identifier: string; kind: string; title: string; mediaPath: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

const OPEN_TAGS = ['<artifact', '<question-form', '<todo-list'] as const

interface OpenBlock {
  tag: 'artifact' | 'question-form' | 'todo-list'
  start: number
  attrs: Record<string, string>
}

function findNextBlock(buffer: string, from: number): OpenBlock | { tag: null; start: number } | null {
  let earliest: { tag: OpenBlock['tag']; start: number } | null = null
  for (const tag of OPEN_TAGS) {
    const idx = buffer.indexOf(tag, from)
    if (idx === -1) continue
    if (earliest === null || idx < earliest.start) earliest = { tag: tag.slice(1) as OpenBlock['tag'], start: idx }
  }
  if (!earliest) return null
  // parse attrs from the open tag if fully present
  const gt = buffer.indexOf('>', earliest.start)
  const header = gt === -1 ? buffer.slice(earliest.start) : buffer.slice(earliest.start, gt + 1)
  const attrs: Record<string, string> = {}
  const attrRe = /(\w+)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(header)) !== null) attrs[m[1]] = m[2]
  if (gt === -1) return { tag: null, start: earliest.start } // open tag not complete yet
  return { tag: earliest.tag, start: earliest.start, attrs }
}

function closeTagFor(tag: OpenBlock['tag']): string {
  return `</${tag}>`
}

export interface RunTurnInput {
  projectId?: string
  brief: string
  projectKind: string
  skillId: string | null
  designSystemId: string | null
  direction: string | null
  locale?: string | null
  history: AgentChatMessage[]
  userMessage: string
  /** Called with the whole conversation for context-building before the LLM call. */
}

/**
 * Runs one agent turn and yields events as they stream.
 * Image generation (`type="image"` artifacts) is executed here — the model
 * composes the prompt, the host runs the media model and saves the file.
 */
export async function* runAgentTurn(input: RunTurnInput): AsyncGenerator<AgentEvent> {
  const skill = input.skillId ? getSkill(input.skillId) : null
  const designSystem = input.designSystemId ? getDesignSystem(input.designSystemId) : null
  const direction: OdDirection | null =
    (input.direction ? listDirections().find((d) => d.id === input.direction) : null) ?? null

  const system = composeSystemPrompt({
    skill,
    designSystem,
    direction,
    projectKind: input.projectKind,
    locale: input.locale ?? null,
  })

  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'system', content: system },
    ...input.history.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 24000) })),
    { role: 'user', content: input.userMessage.slice(0, 24000) },
  ]

  yield { type: 'status', message: 'Thinking' }

  let zai: Awaited<ReturnType<typeof ZAI.create>>
  try {
    zai = await ZAI.create()
  } catch (error) {
    yield { type: 'error', message: 'The agent engine is unavailable. Please try again shortly.' }
    return
  }

  let stream: ReadableStream<Uint8Array>
  try {
    stream = (await zai.chat.completions.create({
      messages,
      stream: true,
      thinking: { type: 'disabled' },
    })) as ReadableStream<Uint8Array>
  } catch {
    yield { type: 'error', message: 'The agent engine could not be reached. Please try again shortly.' }
    return
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let sseBuffer = ''
  let full = '' // full assistant text (with structured blocks)

  // Block-extraction state
  let outsidePos = 0 // how much of `full` has been emitted as prose
  let inside: { tag: OpenBlock['tag']; attrs: Record<string, string>; content: string } | null = null

  const emitProse = function* (upTo: number): Generator<AgentEvent> {
    if (upTo <= outsidePos) return
    const chunk = full.slice(outsidePos, upTo)
    outsidePos = upTo
    if (chunk) yield { type: 'text', delta: chunk }
  }

  streamLoop: while (true) {
    const { done, value } = await reader.read()
    if (done) break
    sseBuffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = sseBuffer.indexOf('\n')) !== -1) {
      const line = sseBuffer.slice(0, nl).trim()
      sseBuffer = sseBuffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const delta: string | undefined = json?.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) full += delta
      } catch {
        // partial JSON line — the next chunk completes it
      }
    }

    // Extract blocks from the accumulated text
    while (true) {
      if (inside) {
        const close = full.indexOf(closeTagFor(inside.tag))
        if (close === -1) break // wait for more
        inside.content += full.slice(0, close)
        const blockContent = inside.content
        const attrs = inside.attrs
        const tag = inside.tag
        // consume through close tag
        full = full.slice(close + closeTagFor(tag).length)
        inside = null
        outsidePos = 0
        if (tag === 'todo-list') {
          try {
            const todos = JSON.parse(blockContent.trim())
            if (Array.isArray(todos)) yield { type: 'todos', todos: todos.slice(0, 12) }
          } catch { /* malformed todo json — ignore */ }
        } else if (tag === 'question-form') {
          try {
            const form = JSON.parse(blockContent.trim())
            yield { type: 'form', id: String(attrs.id ?? 'discovery'), form }
          } catch { /* malformed form json — surface as prose instead */ }
        } else {
          // artifact
          const identifier = attrs.identifier || 'artifact'
          const kind = attrs.type || 'html'
          const title = attrs.title || identifier
          yield { type: 'artifact-end', identifier, kind, title, content: blockContent }
          if (kind === 'image') {
            yield { type: 'status', message: 'Generating image' }
            try {
              const base64 = await generateImage(blockContent.trim().slice(0, 4000))
              if (base64) {
                const mediaPath = saveImageArtifact(input.projectId ?? 'unknown', base64, identifier)
                yield { type: 'media', identifier, kind, title, mediaPath }
              } else {
                yield { type: 'text', delta: '\n\nThe image model could not complete this request. Try rephrasing the prompt.' }
              }
            } catch {
              yield { type: 'text', delta: '\n\nThe image model could not complete this request. Try rephrasing the prompt.' }
            }
          }
        }
        continue
      }
      // outside a block — find the next one
      const next = findNextBlock(full, outsidePos)
      if (!next) {
        // No block open — stream prose out, holding back any tail that could
        // still resolve into a structured block (a trailing '<').
        const lt = full.lastIndexOf('<', Math.max(outsidePos, full.length - 1))
        const safeEnd = lt > outsidePos ? lt : full.length
        yield* emitProse(safeEnd)
        break
      }
      if (next.tag === null) {
        // open tag exists but incomplete — emit prose before it and wait
        yield* emitProse(next.start)
        break
      }
      const openTagEnd = full.indexOf('>', next.start)
      if (openTagEnd === -1) {
        yield* emitProse(next.start)
        break
      }
      yield* emitProse(next.start)
      inside = { tag: next.tag, attrs: (next as OpenBlock).attrs ?? {}, content: '' }
      // skip an opening line-break right after the open tag
      let contentStart = openTagEnd + 1
      if (full[contentStart] === '\n') contentStart += 1
      full = full.slice(contentStart)
      outsidePos = 0
      if (inside.tag === 'artifact') {
        yield {
          type: 'artifact-start',
          identifier: inside.attrs.identifier ?? 'artifact',
          kind: inside.attrs.type ?? 'html',
          title: inside.attrs.title ?? inside.attrs.identifier ?? 'Artifact',
        }
      }
    }
  }

  // flush trailing prose / unterminated block content
  if (inside) {
    const tag = inside.tag
    const attrs = inside.attrs
    const blockContent = inside.content + full
    inside = null
    full = ''
    if (tag === 'todo-list') {
      try {
        const todos = JSON.parse(blockContent.trim())
        if (Array.isArray(todos)) yield { type: 'todos', todos: todos.slice(0, 12) }
      } catch { /* ignore */ }
    } else if (tag === 'question-form') {
      try {
        const form = JSON.parse(blockContent.trim())
        yield { type: 'form', id: String(attrs.id ?? 'discovery'), form }
      } catch {
        yield { type: 'text', delta: blockContent }
      }
    } else if (blockContent.trim()) {
      const identifier = attrs.identifier || 'artifact'
      const kind = attrs.type || 'html'
      yield { type: 'artifact-end', identifier, kind, title: attrs.title || identifier, content: blockContent }
      if (kind === 'image') {
        try {
          const mediaPath = await generateImage(blockContent.trim().slice(0, 4000))
          if (mediaPath) yield { type: 'media', identifier, kind, title: attrs.title || identifier, mediaPath }
        } catch { /* surfaced via prose already */ }
      }
    }
  }
  yield* emitProse(full.length)
  if (outsidePos < full.length) {
    const chunk = full.slice(outsidePos)
    outsidePos = full.length
    if (chunk) yield { type: 'text', delta: chunk }
  }

  try { reader.releaseLock() } catch { /* noop */ }
  yield { type: 'done' }
}

/** Runs the media model for an image artifact; returns PNG bytes as base64. */
async function generateImage(prompt: string): Promise<string | null> {
  if (!prompt) return null
  const zai = await ZAI.create()
  const response = (await zai.images.generations.create({ prompt, size: '1024x1024' })) as {
    data?: Array<{ base64?: string }>
  }
  const base64 = response?.data?.[0]?.base64
  if (!base64) return null
  return base64
}

/** Saves generated image bytes under media/od/<projectId>/ and returns the web path. */
export function saveImageArtifact(projectId: string, base64: string, identifier: string): string {
  const dir = odMediaDir(projectId)
  fs.mkdirSync(dir, { recursive: true })
  const safeId = identifier.replace(/[^a-z0-9-_]/gi, '-').slice(0, 60) || 'image'
  const file = `${safeId}-${Date.now()}.png`
  fs.writeFileSync(path.join(dir, file), Buffer.from(base64, 'base64'))
  return `/media/od/${path.basename(projectId)}/${file}`
}

/** Convenience wrapper used by tests / CLI probes. */
export async function probeAgent(): Promise<string> {
  const chunks: string[] = []
  for await (const event of runAgentTurn({
    brief: 'test', projectKind: 'prototype', skillId: null, designSystemId: null, direction: null,
    history: [], userMessage: 'Reply with the single word: ready',
  })) {
    if (event.type === 'text') chunks.push(event.delta)
    if (event.type === 'error') return `error: ${event.message}`
  }
  return chunks.join('')
}
