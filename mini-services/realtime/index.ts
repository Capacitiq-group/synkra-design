/**
 * SYNKRA Design — realtime room service.
 *
 * Speaks the exact wire protocol the studio's collab client expects: binary y-protocols frames
 * (0 sync, 1 awareness, 2 auth, 3 query-awareness) plus JSON control frames on the same socket
 * (`auth` in, then `ready` / `title` / `saved` / `replaced` / `warning` / `error` out; `ping`
 * and `flush` in). One Y.Doc per design, seeded from the app database on first connect, and
 * flushed back every FLUSH_INTERVAL_MS while it is dirty.
 */
import { WebSocketServer, WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const PORT = Number(process.env.REALTIME_PORT ?? 3010)
const API = process.env.SYNKRA_API_ORIGIN ?? 'http://localhost:3000'
const SERVICE_TOKEN = process.env.SYNKRA_SERVICE_TOKEN ?? 'synkra-dev-service-token'
const FLUSH_INTERVAL_MS = 10_000
const MAX_FRAME_BYTES = 2 * 1024 * 1024
const MAX_CONNECTIONS_PER_DESIGN = 25
const IDLE_TIMEOUT_MS = 120_000

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3

interface SocketMeta {
  room: Room | null
  role: string | null
  userId: string | null
  alive: boolean
  lastSeen: number
}

interface Room {
  id: string // design id
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  sockets: Set<WebSocket & SocketMeta>
  connections: number
  dirty: boolean
  flushTimer: NodeJS.Timeout | null
  title: string
  loaded: boolean
  connecting: Promise<void> | null
}

const rooms = new Map<string, Room>()

async function api(path: string, init: RequestInit = {}, forwardedHeaders?: Headers): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${SERVICE_TOKEN}`)
  if (forwardedHeaders) {
    const cookie = forwardedHeaders.get('cookie')
    if (cookie) headers.set('cookie', cookie)
  }
  return fetch(`${API}${path}`, { ...init, headers })
}

async function whoami(headers: Headers): Promise<{ id: string; name: string; avatar_url: string | null } | null> {
  try {
    const response = await api('/api/v1/internal/whoami', {}, headers)
    if (!response.ok) return null
    const body = (await response.json()) as { user: { id: string; name: string; avatar_url: string | null } | null }
    return body.user
  } catch {
    return null
  }
}

interface SharedResolve {
  ok: boolean
  role?: string
  design_id?: string
  reason?: string
}

async function resolveShare(token: string, password: string | undefined, headers: Headers): Promise<SharedResolve> {
  try {
    const response = await api('/api/v1/internal/shared/' + encodeURIComponent(token) + '/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    }, headers)
    if (!response.ok) return { ok: false, reason: 'not_found' }
    return (await response.json()) as SharedResolve
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Reads the design document from the app and seeds the room's Y.Doc with it. */
async function loadRoom(designId: string): Promise<Room> {
  const existing = rooms.get(designId)
  if (existing) return existing
  const room: Room = {
    id: designId,
    doc: new Y.Doc({ gc: false }),
    awareness: null as unknown as awarenessProtocol.Awareness,
    sockets: new Set(),
    connections: 0,
    dirty: false,
    flushTimer: null,
    title: '',
    loaded: false,
    connecting: null,
  }
  room.awareness = new awarenessProtocol.Awareness(room.doc)
  room.awareness.setLocalState(null)
  room.doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'flush') {
      room.dirty = true
      broadcast(room, encodeSyncUpdate(update), null)
    }
  })
  room.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === 'local-serve') return
    const changed = added.concat(updated, removed)
    if (changed.length === 0) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed))
    broadcast(room, encoding.toUint8Array(encoder), null)
  })
  rooms.set(designId, room)
  return room
}

async function seedRoom(room: Room): Promise<boolean> {
  if (room.loaded) return true
  room.connecting ??= (async () => {
    try {
      const response = await api('/api/v1/internal/designs/' + encodeURIComponent(room.id))
      if (!response.ok) {
        room.connecting = null
        return false
      }
      const body = (await response.json()) as { title: string; document: { pages?: { id: string }[]; [key: string]: unknown } }
      room.title = body.title
      const doc = body.document
      if (doc && Array.isArray(doc.pages)) {
        const ydoc = room.doc
        ydoc.transact(() => {
          const meta = ydoc.getMap('meta')
          const pages = ydoc.getMap('pages')
          const pageOrder = ydoc.getArray<string>('pageOrder')
          for (const [key, value] of Object.entries(doc)) {
            if (key === 'pages') continue
            meta.set(key, value)
          }
          for (const page of doc.pages as Record<string, unknown>[]) {
            const pageId = String(page.id)
            const pageMap = new Y.Map<unknown>()
            for (const [key, value] of Object.entries(page)) {
              if (key === 'objects' || key === 'objectOrder') continue
              pageMap.set(key, value)
            }
            const objects = (page.objects as Record<string, unknown>[]) ?? []
            const objectsMap = new Y.Map<unknown>()
            for (const object of objects) {
              if (typeof object.id !== 'string') continue
              const objectMap = new Y.Map<unknown>()
              for (const [key, value] of Object.entries(object)) objectMap.set(key, value)
              objectsMap.set(object.id, objectMap)
            }
            pageMap.set('objects', objectsMap)
            const order = new Y.Array<string>()
            order.insert(0, objects.map((o) => String(o.id)).filter(Boolean))
            pageMap.set('objectOrder', order)
            pages.set(pageId, pageMap)
          }
          pageOrder.insert(0, (doc.pages as { id: string }[]).map((p) => p.id))
        }, 'seed')
      }
      room.loaded = true
    } catch {
      room.connecting = null
      return false
    }
    room.connecting = null
    return true
  })()
  return room.connecting
}

function readDocumentFromY(room: Room): unknown {
  const meta = room.doc.getMap('meta').toJSON()
  const pageOrder = room.doc.getArray<string>('pageOrder').toArray()
  const pagesRoot = room.doc.getMap('pages')
  const pages: unknown[] = []
  const seen = new Set<string>()
  for (const id of pageOrder) {
    if (seen.has(id) || !pagesRoot.has(id)) continue
    seen.add(id)
    const page = pagesRoot.get(id) as Y.Map<unknown>
    const json = page.toJSON() as { objects?: Record<string, unknown>; objectOrder?: string[]; [key: string]: unknown }
    const objects = json.objects ?? {}
    const order = json.objectOrder ?? Object.keys(objects)
    const ordered: unknown[] = []
    const objectSeen = new Set<string>()
    for (const objectId of order) {
      if (objectSeen.has(objectId) || !(objectId in objects)) continue
      objectSeen.add(objectId)
      ordered.push({ id: objectId, ...objects[objectId] })
    }
    const { objects: _objects, objectOrder: _order, ...rest } = json
    pages.push({ id, ...rest, objects: ordered })
  }
  return { ...meta, pages }
}

function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

function broadcast(room: Room, data: Uint8Array | string, except: WebSocket | null): void {
  for (const socket of room.sockets) {
    if (socket !== except && socket.readyState === WebSocket.OPEN) socket.send(data)
  }
}

function sendJson(socket: WebSocket, frame: Record<string, unknown>): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
}

async function flushRoom(room: Room): Promise<void> {
  if (!room.dirty || !room.loaded) return
  room.dirty = false
  const document = readDocumentFromY(room) as Record<string, unknown>
  try {
    const response = await api('/api/v1/internal/designs/' + encodeURIComponent(room.id), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ document, ...(room.title ? { title: room.title } : {}) }),
    })
    if (!response.ok) {
      room.dirty = true
      return
    }
    const body = (await response.json()) as { revision: number }
    for (const socket of room.sockets) sendJson(socket, { type: 'saved', revision: body.revision })
  } catch {
    room.dirty = true
  }
}

function scheduleFlush(room: Room): void {
  if (room.flushTimer) return
  room.flushTimer = setInterval(() => {
    void flushRoom(room)
  }, FLUSH_INTERVAL_MS)
  room.flushTimer.unref?.()
}

function closeRoomIfIdle(room: Room): void {
  if (room.sockets.size > 0) return
  void flushRoom(room).then(() => {
    if (room.sockets.size === 0) {
      if (room.flushTimer) clearInterval(room.flushTimer)
      room.awareness.destroy()
      room.doc.destroy()
      rooms.delete(room.id)
    }
  })
}

const ROLE_WRITE = new Set(['owner', 'edit'])

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_FRAME_BYTES })

wss.on("connection", async (socket: WebSocket & SocketMeta, request) => {
  console.log("[realtime] connection:", request.url?.slice(0, 80))
  socket.room = null
  socket.role = null
  socket.userId = null
  socket.alive = true
  socket.lastSeen = Date.now()

  const url = new URL(request.url ?? '/', 'http://localhost')
  const roomParam = url.searchParams.get('room') ?? ''
  const match = roomParam.match(/^designs\/([A-Za-z0-9-]+)$/)
  if (!match) {
    socket.close(4404, 'not_found')
    return
  }
  const designId = match[1]
  const headers = new Headers(request.headers as Record<string, string>)
  const shareToken = url.searchParams.get('share')
  const sharePassword = url.searchParams.get('share_password') ?? undefined

  // Authorize: owner session, or a share link (view/comment/edit).
  let role: string | null = null
  let userId: string | null = null
  if (shareToken) {
    const resolve = await resolveShare(shareToken, sharePassword, headers)
    if (!resolve.ok || resolve.design_id !== designId) {
      socket.close(resolve.reason === 'password_required' ? 4403 : 4404, resolve.reason ?? 'not_found')
      return
    }
    role = resolve.role ?? 'view'
    userId = resolve.user_id ?? null
  } else {
    const user = await whoami(headers)
    console.log("[realtime] whoami:", user ? user.id : null, designId)
    if (!user) {
      socket.close(4401, 'signed_out')
      return
    }
    const design = await api('/api/v1/internal/designs/' + encodeURIComponent(designId) + '/revisions', {}, headers)
    if (!design.ok) {
      socket.close(4404, 'not_found')
      return
    }
    role = 'owner'
    userId = user.id
  }

  const room = await loadRoom(designId)
  if (room.sockets.size >= MAX_CONNECTIONS_PER_DESIGN) {
    socket.close(4429, 'busy')
    return
  }
  const seeded = await seedRoom(room)
  if (!seeded) {
    socket.close(4404, 'not_found')
    return
  }

  socket.room = room
  socket.role = role
  socket.userId = userId
  room.sockets.add(socket)
  room.connections += 1
  scheduleFlush(room)

  sendJson(socket, {
    type: 'ready',
    role,
    canWrite: ROLE_WRITE.has(role),
    title: room.title,
    user: role === 'owner' || userId ? { id: userId ?? '', name: role === 'owner' ? 'You' : 'Guest' } : undefined,
    limits: { maxFrameBytes: MAX_FRAME_BYTES },
  })

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    socket.lastSeen = Date.now()
    if (data.byteLength > MAX_FRAME_BYTES) {
      socket.close(4413, 'frame_too_large')
      return
    }
    if (isBinary) {
      if (!ROLE_WRITE.has(socket.role ?? '')) {
        // Read-only peers may send awareness but never document updates.
        const decoder = decoding.createDecoder(new Uint8Array(data))
        try {
          const type = decoding.readVarUint(decoder)
          if (type === MESSAGE_AWARENESS) {
            awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), socket)
          } else if (type === MESSAGE_QUERY_AWARENESS) {
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
            encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(room.awareness.getStates().keys())))
            socket.send(encoding.toUint8Array(encoder))
          } else if (type === MESSAGE_SYNC) {
            // Answer sync step 1 (let them learn the state) but refuse step 2 writes.
            const kind = syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), room.doc, 'readonly')
            void kind
          }
        } catch {
          socket.close(4400, 'bad_frame')
        }
        return
      }
      try {
        const decoder = decoding.createDecoder(new Uint8Array(data))
        const type = decoding.readVarUint(decoder)
        switch (type) {
          case MESSAGE_SYNC: {
            const reply = encoding.createEncoder()
            encoding.writeVarUint(reply, MESSAGE_SYNC)
            syncProtocol.readSyncMessage(decoder, reply, room.doc, socket)
            if (encoding.length(reply) > 1) socket.send(encoding.toUint8Array(reply))
            break
          }
          case MESSAGE_AWARENESS:
            awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), socket)
            break
          case MESSAGE_QUERY_AWARENESS: {
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
            encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(room.awareness.getStates().keys())))
            socket.send(encoding.toUint8Array(encoder))
            break
          }
          default:
            break
        }
      } catch {
        socket.close(4400, 'bad_frame')
      }
      return
    }
    // JSON control frames
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(data.toString('utf8'))
    } catch {
      return
    }
    switch (frame.type) {
      case 'ping':
        sendJson(socket, { type: 'pong' })
        break
      case 'flush':
        void flushRoom(room).then(() => sendJson(socket, { type: 'saved', revision: -1 }))
        break
      case 'title':
        if (role === 'owner' && typeof frame.title === 'string') {
          room.title = frame.title.slice(0, 200)
          room.dirty = true
          for (const other of room.sockets) sendJson(other, { type: 'title', title: room.title })
        }
        break
      case 'auth':
        // Already authenticated at the socket level; a second auth frame cannot escalate.
        sendJson(socket, { type: 'ready', role, canWrite: ROLE_WRITE.has(role), title: room.title, limits: { maxFrameBytes: MAX_FRAME_BYTES } })
        break
      default:
        break
    }
  })

  socket.on('pong', () => {
    socket.alive = true
    socket.lastSeen = Date.now()
  })

  socket.on('close', () => {
    room.sockets.delete(socket)
    room.connections = room.sockets.size
    awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(room.awareness.getStates().keys()).filter((client) => {
      const state = room.awareness.getStates().get(client) as { user?: { id?: string } } | null
      return state?.user?.id === socket.userId && client !== room.doc.clientID
    }), 'close')
    closeRoomIfIdle(room)
  })

  socket.on('error', () => {
    try { socket.close() } catch { /* already closing */ }
  })
})

// Idle connection sweep.
setInterval(() => {
  const now = Date.now()
  for (const socket of wss.clients as Set<WebSocket & SocketMeta>) {
    if (now - socket.lastSeen > IDLE_TIMEOUT_MS) {
      socket.close(1000, 'idle')
      continue
    }
    if (socket.alive === false) {
      socket.terminate()
      continue
    }
    socket.alive = false
    try { socket.ping() } catch { /* closing */ }
  }
}, 30_000).unref()

console.log(`[realtime] SYNKRA realtime room service listening on :${PORT} (api: ${API})`)
