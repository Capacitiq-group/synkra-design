/** The unified Synkra contact address. Support, ideas and security reports all land here. */
export const CONTACT_EMAIL = 'design@synkra.co.za'

/** The address of a pre-filled email to the Synkra team. */
export function contactUrl(subject: string, body = ''): string {
  const params = new URLSearchParams()
  if (subject) params.set('subject', subject)
  if (body) params.set('body', body)
  const query = params.toString()
  return `mailto:${CONTACT_EMAIL}${query ? `?${query}` : ''}`
}
