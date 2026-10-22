import type { ApiUser, AppConfig, DesignSummary, Page, TemplateSummary } from '@/types/api'

let counter = 0

function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

export function makeUser(overrides: Partial<ApiUser> = {}): ApiUser {
  const id = nextId('u')
  const created = '2025-01-01T00:00:00Z'
  return {
    id,
    email: 'ada@example.com',
    display_name: 'Ada Lovelace',
    name: 'Ada Lovelace',
    avatar_url: null,
    is_email_verified: true,
    has_password: true,
    google_linked: false,
    created_at: created,
    ...overrides,
  }
}

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    google_client_id: '',
    features: { stock_photos: true, server_pdf: true, google_login: false, email_verification: false, background_removal: true },
    limits: { max_upload_bytes: 25 * 1024 * 1024, max_pages: 100, max_document_bytes: 12 * 1024 * 1024 },
    assets: { background_removal_model: null },
    ...overrides,
  }
}

export function makeDesign(id: string, overrides: Partial<DesignSummary> = {}): DesignSummary {
  const stamp = '2025-03-01T00:00:00Z'
  return {
    id,
    title: `Design ${id}`,
    width: 1080,
    height: 1080,
    preset: '',
    page_count: 1,
    thumbnail_url: null,
    folder: null,
    starred: false,
    revision: 1,
    created_at: stamp,
    updated_at: stamp,
    trashed_at: null,
    ...overrides,
  }
}

export function makeTemplate(slug: string, overrides: Partial<TemplateSummary> = {}): TemplateSummary {
  return {
    id: slug,
    slug,
    title: `Template ${slug}`,
    category: { id: 'c1', slug: 'social', name: 'Social media' },
    tags: [],
    width: 1080,
    height: 1080,
    orientation: 'square',
    preset: '',
    page_count: 1,
    thumbnail_url: null,
    is_featured: false,
    use_count: 0,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  } as TemplateSummary
}

/** Builds the paginated list envelope used by every list endpoint. */
export function page<T>(results: T[], overrides: Partial<Page<T>> = {}): Page<T> {
  return { count: results.length, next: null, previous: null, results, ...overrides }
}
