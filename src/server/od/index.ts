/**
 * SYNKRA Agent Studio — API handlers (registered in the /api/v1 gateway).
 *
 * Library endpoints (skills / design systems / directions / prompt templates)
 * are public reads over the vendored OpenDesign content. Project endpoints are
 * session-authenticated and CSRF-protected, mirroring the rest of the app.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  HttpError, jsonResponse, readJson, checkCsrf, requireUser, rateLimit, clientKey,
} from '../core'
import {
  listSkills, getSkill, listDesignSystems, getDesignSystem, listDirections,
  listPromptTemplates, readDesignSystemPreviewAsset,
} from './library'
import { runAgentTurn, type AgentChatMessage, type AgentEvent } from './agent'

const PROJECT_KINDS = new Set(['prototype', 'deck', 'dashboard', 'document', 'image', 'video', 'other'])

export const odHandlers = {
  // ---------- library (public reads) ----------

  async 'GET /od/library/skills'(req: NextRequest): Promise<NextResponse> {
    const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? ''
    const category = req.nextUrl.searchParams.get('category')?.trim() ?? ''
    const source = req.nextUrl.searchParams.get('source')?.trim() ?? ''
    let skills = listSkills()
    if (category) skills = skills.filter((s) => s.category === category)
    if (source) skills = skills.filter((s) => s.source === source)
    if (q) {
      skills = skills.filter((s) =>
        s.name.toLowerCase().includes(q)
        || s.description.toLowerCase().includes(q)
        || s.id.toLowerCase().includes(q)
        || s.triggers.some((t) => t.toLowerCase().includes(q)),
      )
    }
    const categories = [...new Set(listSkills().map((s) => s.category))].sort()
    return jsonResponse({ count: skills.length, categories, results: skills.map((s) => ({ ...s, name: s.name, description: s.description.slice(0, 240) })) })
  },

  async 'GET /od/library/skills/:id'(_req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const skill = getSkill(params.id)
    if (!skill) throw Object.assign(new Error('skill not found'), { status: 404 })
    return jsonResponse({ skill })
  },

  async 'GET /od/library/design-systems'(req: NextRequest): Promise<NextResponse> {
    const q = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? ''
    const category = req.nextUrl.searchParams.get('category')?.trim() ?? ''
    let systems = listDesignSystems()
    if (category) systems = systems.filter((s) => s.category === category)
    if (q) {
      systems = systems.filter((s) =>
        s.name.toLowerCase().includes(q)
        || s.description.toLowerCase().includes(q)
        || s.id.toLowerCase().includes(q),
      )
    }
    const categories = [...new Set(listDesignSystems().map((s) => s.category))].sort()
    return jsonResponse({ count: systems.length, categories, results: systems })
  },

  async 'GET /od/library/design-systems/:id'(_req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const system = getDesignSystem(params.id)
    if (!system) throw Object.assign(new Error('design system not found'), { status: 404 })
    return jsonResponse({ system })
  },

  async 'GET /od/library/design-systems/:id/preview/:file'(_req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const asset = readDesignSystemPreviewAsset(params.id, params.file)
    if (!asset) throw Object.assign(new Error('preview asset not found'), { status: 404 })
    return new NextResponse(new Uint8Array(asset.data), {
      headers: { 'content-type': asset.mime, 'cache-control': 'public, max-age=86400' },
    })
  },

  async 'GET /od/library/directions'(): Promise<NextResponse> {
    return jsonResponse({ results: listDirections() })
  },

  async 'GET /od/library/prompt-templates'(req: NextRequest): Promise<NextResponse> {
    const surface = req.nextUrl.searchParams.get('surface') ?? undefined
    const templates = listPromptTemplates(surface)
    return jsonResponse({ count: templates.length, results: templates })
  },

  // ---------- projects (authed) ----------

  async 'GET /od/projects'(req: NextRequest): Promise<NextResponse> {
    const user = await requireUser(req)
    const trashed = req.nextUrl.searchParams.get('trashed') === '1'
    const projects = await db.odProject.findMany({
      where: { ownerId: user.id, trashedAt: trashed ? { not: null } : null },
      orderBy: { updatedAt: 'desc' },
      include: { artifacts: { orderBy: { updatedAt: 'desc' }, take: 1 } },
    })
    return jsonResponse({
      results: projects.map((p) => ({
        id: p.id,
        title: p.title,
        brief: p.brief.slice(0, 200),
        kind: p.kind,
        skill_id: p.skillId,
        design_system_id: p.designSystemId,
        direction: p.direction,
        status: p.status,
        updated_at: p.updatedAt.toISOString(),
        latest_artifact: p.artifacts[0]
          ? { id: p.artifacts[0].id, identifier: p.artifacts[0].identifier, kind: p.artifacts[0].kind, title: p.artifacts[0].title, media_path: p.artifacts[0].mediaPath }
          : null,
      })),
    })
  },

  async 'POST /od/projects'(req: NextRequest): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    rateLimit(`od-create:${clientKey(req)}`, user.id, 30, 60_000)
    const body = await readJson(req)
    const brief = String(body.brief ?? '').trim()
    if (!brief) throw new HttpError(400, 'invalid', 'A brief is required to start a project.')
    if (brief.length > 8000) throw new HttpError(400, 'invalid', 'The brief is too long (8000 characters max).')
    const kind = PROJECT_KINDS.has(String(body.kind ?? '')) ? String(body.kind) : 'prototype'
    const skillId = typeof body.skill_id === 'string' && body.skill_id ? body.skill_id : null
    const designSystemId = typeof body.design_system_id === 'string' && body.design_system_id ? body.design_system_id : null
    if (skillId && !getSkill(skillId)) throw new HttpError(400, 'invalid', 'Unknown skill.')
    if (designSystemId && !getDesignSystem(designSystemId)) throw new HttpError(400, 'invalid', 'Unknown design system.')
    const direction = typeof body.direction === 'string' && body.direction ? body.direction : null
    const project = await db.odProject.create({
      data: { ownerId: user.id, brief, kind, skillId, designSystemId, direction, title: brief.slice(0, 80) },
    })
    return jsonResponse({ project: { id: project.id, title: project.title, kind: project.kind } }, { status: 201 })
  },

  async 'GET /od/projects/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const user = await requireUser(req)
    const project = await db.odProject.findUnique({
      where: { id: params.id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        artifacts: { orderBy: { updatedAt: 'desc' } },
      },
    })
    if (!project || project.ownerId !== user.id) throw new HttpError(404, 'not_found', 'Project not found.')
    return jsonResponse({
      project: {
        id: project.id,
        title: project.title,
        brief: project.brief,
        kind: project.kind,
        skill_id: project.skillId,
        design_system_id: project.designSystemId,
        direction: project.direction,
        status: project.status,
        created_at: project.createdAt.toISOString(),
        updated_at: project.updatedAt.toISOString(),
      },
      messages: project.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        form_answers: m.formAnswers ? JSON.parse(m.formAnswers) : null,
        todos: m.todos ? JSON.parse(m.todos) : [],
        artifacts: m.artifacts ? JSON.parse(m.artifacts) : [],
        error: m.error || null,
        created_at: m.createdAt.toISOString(),
      })),
      artifacts: project.artifacts.map((a) => ({
        id: a.id,
        identifier: a.identifier,
        kind: a.kind,
        title: a.title,
        version: a.version,
        status: a.status,
        media_path: a.mediaPath,
        updated_at: a.updatedAt.toISOString(),
      })),
    })
  },

  async 'PATCH /od/projects/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const project = await db.odProject.findUnique({ where: { id: params.id } })
    if (!project || project.ownerId !== user.id) throw new HttpError(404, 'not_found', 'Project not found.')
    const body = await readJson(req)
    const data: Record<string, unknown> = {}
    if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim().slice(0, 120)
    if (typeof body.trashed === 'boolean') data.trashedAt = body.trashed ? new Date() : null
    if (typeof body.kind === 'string' && PROJECT_KINDS.has(body.kind)) data.kind = body.kind
    const updated = await db.odProject.update({ where: { id: project.id }, data })
    return jsonResponse({ ok: true, title: updated.title, trashed: Boolean(updated.trashedAt) })
  },

  async 'DELETE /od/projects/:id'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    const project = await db.odProject.findUnique({ where: { id: params.id } })
    if (!project || project.ownerId !== user.id) throw new HttpError(404, 'not_found', 'Project not found.')
    await db.odProject.delete({ where: { id: project.id } })
    return jsonResponse({ ok: true })
  },

  // ---------- agent turn (SSE) ----------

  async 'POST /od/projects/:id/messages'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    checkCsrf(req)
    const user = await requireUser(req)
    rateLimit(`od-turn:${clientKey(req)}`, user.id, 20, 60_000)
    const project = await db.odProject.findUnique({ where: { id: params.id } })
    if (!project || project.ownerId !== user.id) throw new HttpError(404, 'not_found', 'Project not found.')
    const body = await readJson(req)
    const content = String(body.content ?? '').trim()
    if (!content) throw new HttpError(400, 'invalid', 'Message content is required.')
    if (content.length > 16000) throw new HttpError(400, 'invalid', 'Message is too long (16000 characters max).')
    const formAnswers = body.form_answers && typeof body.form_answers === 'object' ? JSON.stringify(body.form_answers) : ''

    // Persist the user turn first (with rendered form answers when present)
    const priorCount = await db.odMessage.count({ where: { projectId: project.id } })
    let userContent = content
    if (formAnswers) {
      const entries = Object.entries(JSON.parse(formAnswers) as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
        .join('\n')
      userContent = `[form answers — ${String(body.form_id ?? 'discovery')}]\n${entries}\n\n${content}`
    }
    const userMessage = await db.odMessage.create({
      data: { projectId: project.id, role: 'user', content: userContent, formAnswers },
    })
    if (priorCount === 0 && project.title === project.brief.slice(0, 80)) {
      await db.odProject.update({
        where: { id: project.id },
        data: { title: content.replace(/\s+/g, ' ').slice(0, 80) },
      })
    }

    const historyRows = await db.odMessage.findMany({
      where: { projectId: project.id, id: { not: userMessage.id } },
      orderBy: { createdAt: 'asc' },
    })
    const history: AgentChatMessage[] = historyRows.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))

    await db.odProject.update({ where: { id: project.id }, data: { status: 'running' } })

    const encoder = new TextEncoder()
    const projectId = project.id
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: AgentEvent | { type: string; [k: string]: unknown }) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)) } catch { /* closed */ }
        }
        let assistantText = ''
        let lastTodos: Array<{ content: string; status: string }> = []
        let lastForm: unknown = null
        let lastFormId: string | null = null
        const artifactRefs: Array<{ identifier: string; kind: string; title: string; artifact_id?: string }> = []
        let errored = ''

        try {
          for await (const event of runAgentTurn({
            projectId,
            brief: project.brief,
            projectKind: project.kind,
            skillId: project.skillId,
            designSystemId: project.designSystemId,
            direction: project.direction,
            history,
            userMessage: userContent,
          })) {
            switch (event.type) {
              case 'text':
                assistantText += event.delta
                send(event)
                break
              case 'todos':
                lastTodos = event.todos
                send(event)
                break
              case 'form':
                lastForm = event.form
                lastFormId = event.id
                send(event)
                break
              case 'artifact-end': {
                // Upsert artifact with version bump
                const existing = await db.odArtifact.findFirst({
                  where: { projectId, identifier: event.identifier },
                  orderBy: { version: 'desc' },
                })
                const isImage = event.kind === 'image'
                const record = await db.odArtifact.create({
                  data: {
                    projectId,
                    identifier: event.identifier,
                    kind: event.kind,
                    title: event.title,
                    content: isImage ? event.content.slice(0, 4000) : event.content.slice(0, 800_000),
                    version: (existing?.version ?? 0) + 1,
                    status: 'complete',
                  },
                })
                artifactRefs.push({ identifier: event.identifier, kind: event.kind, title: event.title, artifact_id: record.id })
                send({ type: 'artifact', identifier: event.identifier, kind: event.kind, title: event.title, artifact_id: record.id, version: record.version })
                break
              }
              case 'media': {
                // Agent already saved the image under media/od/<projectId>/;
                // attach the web path to the newest artifact with this identifier.
                const record = await db.odArtifact.findFirst({
                  where: { projectId, identifier: event.identifier },
                  orderBy: { version: 'desc' },
                })
                if (record) {
                  await db.odArtifact.update({ where: { id: record.id }, data: { mediaPath: event.mediaPath } })
                  artifactRefs.push({ identifier: event.identifier, kind: event.kind, title: event.title, artifact_id: record.id })
                  send({ type: 'artifact', identifier: event.identifier, kind: event.kind, title: event.title, artifact_id: record.id, media_path: event.mediaPath })
                }
                break
              }
              case 'status':
                send(event)
                break
              case 'error':
                errored = event.message
                send(event)
                break
              case 'done':
                break
            }
          }
        } catch (error) {
          errored = 'The agent turn failed unexpectedly. Please try again.'
          send({ type: 'error', message: errored })
        }

        await db.odMessage.create({
          data: {
            projectId,
            role: 'assistant',
            content: assistantText,
            formAnswers: lastForm ? JSON.stringify({ id: lastFormId ?? 'discovery', form: lastForm }) : '',
            todos: JSON.stringify(lastTodos),
            artifacts: JSON.stringify(artifactRefs),
            error: errored,
          },
        })
        await db.odProject.update({
          where: { id: projectId },
          data: { status: errored ? 'error' : 'ready' },
        })
        send({ type: 'done' })
        controller.close()
      },
    })

    return new NextResponse(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  },

  // ---------- artifacts ----------

  async 'GET /od/artifacts/:id/raw'(req: NextRequest, params: Record<string, string>): Promise<NextResponse> {
    const user = await requireUser(req)
    const artifact = await db.odArtifact.findUnique({ where: { id: params.id }, include: { project: true } })
    if (!artifact || artifact.project.ownerId !== user.id) throw new HttpError(404, 'not_found', 'Artifact not found.')
    if (artifact.mediaPath) {
      // Image artifacts — binary lives under media/, serve it through the
      // same authed endpoint (fs read, not an internal fetch).
      const fs = await import('node:fs')
      const path = await import('node:path')
      const MEDIA_ROOT = process.env.SYNKRA_MEDIA_DIR ?? '/home/z/my-project/media'
      const abs = path.join(MEDIA_ROOT, artifact.mediaPath.replace(/^\/media\//, ''))
      try {
        const data = fs.readFileSync(abs)
        return new NextResponse(new Uint8Array(data), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } })
      } catch {
        throw new HttpError(404, 'not_found', 'Artifact media is missing.')
      }
    }
    const kind = artifact.kind
    const mime = kind === 'svg' ? 'image/svg+xml'
      : kind === 'markdown-document' || kind === 'design-system' ? 'text/markdown; charset=utf-8'
      : 'text/html; charset=utf-8'
    const download = req.nextUrl.searchParams.get('download')
    const headers: Record<string, string> = { 'content-type': mime, 'cache-control': 'no-store' }
    if (download) headers['content-disposition'] = `attachment; filename="${artifact.identifier}.${kind === 'deck' || kind === 'html' ? 'html' : kind === 'markdown-document' || kind === 'design-system' ? 'md' : kind === 'svg' ? 'svg' : 'txt'}"`
    return new NextResponse(artifact.content, { headers })
  },
}
