import { NextRequest, NextResponse } from 'next/server'
import { createReadStream, existsSync, statSync } from 'fs'
import { Readable } from 'stream'
import path from 'path'
import { MEDIA_DIR } from '@/server/core'

export const runtime = 'nodejs'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.weba': 'audio/webm', '.flac': 'audio/flac',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.onnx': 'application/octet-stream', '.wasm': 'application/wasm', '.mjs': 'text/javascript',
  '.json': 'application/json', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
}

/**
 * Serves the media tree (uploads, thumbnails, fonts, elements, audio, models) with the same
 * defensive headers the backend used: sandboxed, sniff-proof, no direct navigation for SVG.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path: segments } = await context.params
  const relative = (segments ?? []).join('/')
  const resolved = path.resolve(MEDIA_DIR, relative)
  if (!resolved.startsWith(path.resolve(MEDIA_DIR)) || !existsSync(resolved) || !statSync(resolved).isFile()) {
    return NextResponse.json({ error: { code: 'not_found', message: 'No such file.' } }, { status: 404 })
  }
  const ext = path.extname(resolved).toLowerCase()
  const mime = MIME[ext] ?? 'application/octet-stream'
  const headers = new Headers({
    'Content-Type': mime,
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': ext === '.json' ? 'no-cache' : 'public, max-age=3600',
  })
  if (ext === '.svg') headers.set('Content-Disposition', 'inline; filename-sandboxed')
  const stats = statSync(resolved)
  headers.set('Content-Length', String(stats.size))
  const stream = Readable.toWeb(createReadStream(resolved)) as unknown as ReadableStream
  return new NextResponse(stream, { status: 200, headers })
}
