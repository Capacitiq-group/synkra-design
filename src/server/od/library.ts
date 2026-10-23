/**
 * SYNKRA Agent Studio — OpenDesign content library.
 *
 * Scans the vendored OpenDesign libraries under `content/opendesign/`
 * (nexu-io/open-design, Apache-2.0 — see content/opendesign/ATTRIBUTION.md):
 *   - skills/            agent skills (SKILL.md + YAML frontmatter)
 *   - design-templates/  scenario templates (SKILL.md + seed example.html)
 *   - design-systems/    brand-grade design systems (manifest.json, DESIGN.md, tokens)
 *   - prompt-templates/  community media prompt cards (image/, video/)
 *
 * All reads are filesystem-based; results are cached in-memory per process so
 * browsing stays fast while still picking up library changes on restart.
 */
import fs from 'node:fs'
import path from 'node:path'
import { MEDIA_DIR } from '../core'

const OD_CONTENT = process.env.SYNKRA_OD_CONTENT_DIR ?? '/home/z/my-project/content/opendesign'

export interface OdSkillSummary {
  id: string
  name: string
  description: string
  category: string
  mode: string
  triggers: string[]
  source: 'skills' | 'templates'
  hasExample: boolean
}

export interface OdSkillDetail extends OdSkillSummary {
  body: string
  exampleHtml: string | null
  upstream: string | null
}

export interface OdDesignSystemSummary {
  id: string
  name: string
  category: string
  description: string
  accent: string | null
  palette: string[]
  languages: string[]
}

export interface OdDesignSystemDetail extends OdDesignSystemSummary {
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

// ---------- minimal YAML frontmatter parsing (subset used by SKILL.md) ----------

function parseFrontmatter(raw: string): { data: Record<string, any>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return { data: {}, body: normalized }
  const body = normalized.slice(match[0].length)
  const data: Record<string, any> = {}
  let currentKey: string | null = null
  for (const line of match[1].split('\n')) {
    if (/^\s+-\s/.test(line) && currentKey) {
      const list = data[currentKey]
      if (Array.isArray(list)) list.push(line.replace(/^\s+-\s?/, '').trim().replace(/^['"]|['"]$/g, ''))
      continue
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (kv) {
      currentKey = kv[1]
      const value = kv[2].trim()
      if (value === '' || value === '|' || value === '>') {
        data[currentKey] = ''
        continue
      }
      data[currentKey] = value.replace(/^['"]|['"]$/g, '')
    } else if (currentKey && line.startsWith('  ') && data[currentKey] === '') {
      // fold multi-line scalars (|) into a single string
      data[currentKey] = line.trim()
    }
  }
  return { data, body }
}

function odValue(data: Record<string, any>, key: string): string {
  const od = data.od
  return od && typeof od === 'object' ? String((od as Record<string, unknown>)[key] ?? '') : ''
}

function readSkillFile(filePath: string, id: string, source: 'skills' | 'templates'): OdSkillSummary | null {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  const { data } = parseFrontmatter(raw)
  // The minimal parser cannot nest `od:` — pull its keys from the raw frontmatter block.
  const odMatch = raw.match(/^od:\n((?:  .*\n?)+)/m)
  const odRaw = odMatch?.[1] ?? ''
  const odKey = (key: string): string => {
    const m = odRaw.match(new RegExp(`^\\s+${key}:\\s*(.+)$`, 'm'))
    return m ? m[1].trim().replace(/^['"]|['"]$/, '').trim() : ''
  }
  void odValue
  const name = String(data.name ?? id)
  const description = String(data.description ?? '').trim()
  const triggers = Array.isArray(data.triggers) ? data.triggers.map(String) : []
  return {
    id,
    name,
    description,
    category: odKey('category') || 'general',
    mode: odKey('mode') || 'prototype',
    triggers,
    source,
    hasExample: false,
  }
}

// ---------- skills ----------

let skillsCache: OdSkillSummary[] | null = null

export function listSkills(): OdSkillSummary[] {
  if (skillsCache) return skillsCache
  const out: OdSkillSummary[] = []
  const skillsDir = path.join(OD_CONTENT, 'skills')
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      const file = path.join(skillsDir, entry.name, 'SKILL.md')
      if (!fs.existsSync(file)) continue
      const skill = readSkillFile(file, entry.name, 'skills')
      if (skill) out.push(skill)
    }
  }
  const templatesDir = path.join(OD_CONTENT, 'design-templates')
  if (fs.existsSync(templatesDir)) {
    for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      const file = path.join(templatesDir, entry.name, 'SKILL.md')
      if (!fs.existsSync(file)) continue
      const skill = readSkillFile(file, entry.name, 'templates')
      if (skill) {
        skill.hasExample = fs.existsSync(path.join(templatesDir, entry.name, 'example.html'))
        out.push(skill)
      }
    }
  }
  skillsCache = out
  return out
}

export function getSkill(id: string): OdSkillDetail | null {
  const base = path.basename(id)
  const skillsFile = path.join(OD_CONTENT, 'skills', base, 'SKILL.md')
  const templatesFile = path.join(OD_CONTENT, 'design-templates', base, 'SKILL.md')
  const file = fs.existsSync(skillsFile) ? skillsFile : fs.existsSync(templatesFile) ? templatesFile : null
  if (!file) return null
  const source = file === skillsFile ? 'skills' : 'templates'
  const summary = readSkillFile(file, base, source)
  if (!summary) return null
  const raw = fs.readFileSync(file, 'utf8')
  const { data, body } = parseFrontmatter(raw)
  let exampleHtml: string | null = null
  const examplePath = path.join(path.dirname(file), 'example.html')
  if (fs.existsSync(examplePath)) {
    try { exampleHtml = fs.readFileSync(examplePath, 'utf8') } catch { exampleHtml = null }
  }
  return {
    ...summary,
    body,
    exampleHtml,
    upstream: typeof data.upstream === 'string' ? data.upstream : null,
  }
}

// ---------- design systems ----------

interface DesignSystemManifest {
  id: string
  name: string
  category: string
  description: string
  files?: Record<string, string>
  usage?: string
}

interface DesignSystemTokens {
  tokens?: Array<{ name?: string; value?: string; layer?: string } & Record<string, unknown>>
}

let designSystemsCache: OdDesignSystemSummary[] | null = null

function designSystemDir(id: string): string {
  return path.join(OD_CONTENT, 'design-systems', path.basename(id))
}

function readTokensPalette(dir: string): { accent: string | null; palette: string[] } {
  try {
    const tokens = JSON.parse(fs.readFileSync(path.join(dir, 'design-tokens.json'), 'utf8')) as DesignSystemTokens
    const list = Array.isArray(tokens.tokens) ? tokens.tokens : []
    const colors = list
      .map((t) => (typeof t?.value === 'string' && /(^#[0-9a-fA-F]{3,8}$)|oklch|rgb|hsl/.test(t.value) ? t.value : null))
      .filter((v): v is string => Boolean(v))
    const accentToken = list.find((t) => /accent|brand|primary/.test(String(t?.name ?? '')) && typeof t?.value === 'string')
    return { accent: (accentToken?.value as string) ?? colors[0] ?? null, palette: colors.slice(0, 8) }
  } catch {
    return { accent: null, palette: [] }
  }
}

function designSystemLanguages(dir: string): string[] {
  const out: string[] = ['en']
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^DESIGN-([a-z-]+)\.md$/)
      if (m) out.push(m[1])
    }
  } catch { /* best-effort */ }
  return out
}

export function listDesignSystems(): OdDesignSystemSummary[] {
  if (designSystemsCache) return designSystemsCache
  const dir = path.join(OD_CONTENT, 'design-systems')
  const out: OdDesignSystemSummary[] = []
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      const manifestPath = path.join(dir, entry.name, 'manifest.json')
      if (!fs.existsSync(manifestPath)) continue
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as DesignSystemManifest
        const { accent, palette } = readTokensPalette(path.join(dir, entry.name))
        out.push({
          id: manifest.id ?? entry.name,
          name: manifest.name ?? entry.name,
          category: manifest.category ?? 'General',
          description: manifest.description ?? '',
          accent,
          palette,
          languages: designSystemLanguages(path.join(dir, entry.name)),
        })
      } catch {
        // skip malformed manifests
      }
    }
  }
  designSystemsCache = out
  return out
}

export function getDesignSystem(id: string): OdDesignSystemDetail | null {
  const dir = designSystemDir(id)
  const manifestPath = path.join(dir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as DesignSystemManifest
    const read = (name: string): string => {
      try { return fs.readFileSync(path.join(dir, name), 'utf8') } catch { return '' }
    }
    const { accent, palette } = readTokensPalette(dir)
    const componentsFile = manifest.files?.components ?? 'components.html'
    return {
      id: manifest.id ?? id,
      name: manifest.name ?? id,
      category: manifest.category ?? 'General',
      description: manifest.description ?? '',
      accent,
      palette,
      languages: designSystemLanguages(dir),
      designMd: read(manifest.files?.design ?? 'DESIGN.md'),
      tokensCss: read(manifest.files?.tokens ?? 'tokens.css'),
      tokensJson: read('design-tokens.json'),
      componentsHtml: fs.existsSync(path.join(dir, componentsFile)) ? read(componentsFile) : null,
      usage: manifest.usage && fs.existsSync(path.join(dir, manifest.usage)) ? read(manifest.usage) : null,
    }
  } catch {
    return null
  }
}

/** Serves a design-system preview asset (preview/<file>) with a safe extension allow-list. */
export function readDesignSystemPreviewAsset(id: string, file: string): { data: Buffer; mime: string } | null {
  const dir = designSystemDir(id)
  const previewDir = path.join(dir, 'preview')
  const target = path.resolve(previewDir, path.basename(file))
  if (!target.startsWith(path.resolve(previewDir))) return null
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null
  const ext = path.extname(target).toLowerCase()
  const mimes: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.gif': 'image/gif',
  }
  const mime = mimes[ext]
  if (!mime) return null
  return { data: fs.readFileSync(target), mime }
}

// ---------- visual directions (vendored from apps/daemon/src/prompts/directions.ts) ----------

let directionsCache: OdDirection[] | null = null

export function listDirections(): OdDirection[] {
  if (directionsCache) return directionsCache
  const file = path.join(OD_CONTENT, 'directions.json')
  let list: OdDirection[] = []
  if (fs.existsSync(file)) {
    try { list = JSON.parse(fs.readFileSync(file, 'utf8')) as OdDirection[] } catch { list = [] }
  }
  directionsCache = list
  return directionsCache
}

// ---------- prompt templates ----------

let promptTemplatesCache: OdPromptTemplate[] | null = null

export function listPromptTemplates(surface?: string): OdPromptTemplate[] {
  if (!promptTemplatesCache) {
    const out: OdPromptTemplate[] = []
    const base = path.join(OD_CONTENT, 'prompt-templates')
    for (const group of ['image', 'video']) {
      const dir = path.join(base, group)
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir).sort()) {
        if (!f.endsWith('.json')) continue
        try {
          const card = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, unknown>
          out.push({
            id: String(card.id ?? f.replace(/\.json$/, '')),
            surface: String(card.surface ?? group),
            title: String(card.title ?? ''),
            summary: String(card.summary ?? ''),
            category: String(card.category ?? ''),
            tags: Array.isArray(card.tags) ? card.tags.map(String) : [],
            aspect: typeof card.aspect === 'string' ? card.aspect : null,
            prompt: String(card.prompt ?? ''),
          })
        } catch { /* skip malformed */ }
      }
    }
    promptTemplatesCache = out
  }
  return surface ? promptTemplatesCache.filter((t) => t.surface === surface) : promptTemplatesCache
}

// ---------- generated artifact media ----------

export function odMediaDir(projectId: string): string {
  return path.join(MEDIA_DIR, 'od', path.basename(projectId))
}
