import { mkdir, writeFile, stat } from 'fs/promises'
import path from 'path'
import { MEDIA_DIR, HttpError } from './core'
import { createHash } from 'crypto'

export interface SavedUpload {
  /** Path relative to MEDIA_DIR, e.g. `assets/<owner>/<id>.png`. */
  path: string
  bytes: number
  mime: string
}

export function safeJoin(dir: string, name: string): string {
  const resolved = path.resolve(dir, name)
  if (!resolved.startsWith(path.resolve(dir))) throw new HttpError(400, 'invalid_path', 'Bad file path.')
  return resolved
}

/** Writes an uploaded file into the media tree under `folder`, returning its relative path. */
export async function saveUpload(file: File, folder: string, allowedMimes?: string[], maxBytes?: number): Promise<SavedUpload> {
  const buffer = Buffer.from(await file.arrayBuffer())
  if (maxBytes && buffer.byteLength > maxBytes) throw new HttpError(400, 'file_too_large', 'The file is too large.')
  const mime = file.type || 'application/octet-stream'
  if (allowedMimes && allowedMimes.length > 0 && !allowedMimes.includes(mime)) {
    throw new HttpError(400, 'unsupported_type', 'That file type is not supported.')
  }
  const ext = extensionFor(mime, file.name)
  const name = `${Date.now().toString(36)}-${createHash('sha1').update(buffer).digest('hex').slice(0, 10)}${ext}`
  const dir = safeJoin(MEDIA_DIR, folder)
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, name)
  await writeFile(target, buffer)
  return { path: `${folder}/${name}`, bytes: buffer.byteLength, mime }
}

function extensionFor(mime: string, filename: string): string {
  const fromName = path.extname(filename).toLowerCase()
  if (fromName) return fromName
  const map: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/avif': '.avif',
    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/webm': '.weba',
    'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf', 'application/octet-stream': '',
  }
  return map[mime] ?? ''
}

export async function fileSize(relativePath: string): Promise<number | null> {
  try {
    const info = await stat(safeJoin(MEDIA_DIR, relativePath))
    return info.size
  } catch {
    return null
  }
}
