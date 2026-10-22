import { db } from '@/lib/db'

/**
 * The unified Synkra email service. Every transactional email the platform sends goes through here,
 * from the single platform address design@synkra.co.za. Delivery is recorded in the EmailMessage
 * outbox (auditable, survives restarts); when SMTP credentials are configured the message is also
 * handed to the transport. Without credentials the outbox itself is the delivery record.
 */
export const PLATFORM_FROM = 'Synkra Design <design@synkra.co.za>'

export interface OutgoingEmail {
  to: string
  subject: string
  text: string
  html?: string
  kind: string
}

export async function sendEmail(email: OutgoingEmail): Promise<void> {
  const relayUrl = process.env.SYNKRA_SMTP_RELAY_URL
  let status = 'sent'
  if (relayUrl) {
    try {
      const response = await fetch(relayUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SYNKRA_SMTP_RELAY_TOKEN ?? ''}` },
        body: JSON.stringify({ from: PLATFORM_FROM, ...email }),
      })
      status = response.ok ? 'sent' : 'failed'
    } catch {
      status = 'failed'
    }
  }
  await db.emailMessage.create({
    data: {
      toEmail: email.to,
      fromEmail: PLATFORM_FROM,
      subject: email.subject,
      text: email.text,
      html: email.html ?? '',
      kind: email.kind,
      status,
    },
  })
  console.log(`[email:${email.kind}] -> ${email.to} :: ${email.subject}`)
}

export function verifyEmailHtml(link: string): { subject: string; text: string; html: string } {
  return {
    subject: 'Verify your email — Synkra Design',
    text: `Welcome to Synkra Design! Confirm your email address to finish setting up your account:\n\n${link}\n\nThis link works for 24 hours.`,
    html: `<p>Welcome to <strong>Synkra Design</strong>!</p><p>Confirm your email address to finish setting up your account:</p><p><a href="${link}">Verify my email</a></p><p>This link works for 24 hours.</p>`,
  }
}

export function resetEmailHtml(link: string): { subject: string; text: string; html: string } {
  return {
    subject: 'Reset your password — Synkra Design',
    text: `Someone asked to reset the password for your Synkra Design account:\n\n${link}\n\nThis link works for 24 hours. If it wasn't you, you can ignore this email.`,
    html: `<p>Someone asked to reset the password for your <strong>Synkra Design</strong> account:</p><p><a href="${link}">Choose a new password</a></p><p>This link works for 24 hours. If it wasn't you, you can ignore this email.</p>`,
  }
}
