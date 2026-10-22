import { ArrowUpRight, Bug, Lightbulb, Send, ShieldAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Accent, PageIntro } from '@/features/marketing/PageIntro'
import { CONTACT_EMAIL, contactUrl } from '@/lib/links'
import { usePageMeta } from '@/lib/usePageMeta'
import { AnchorButton, Button, Input, Select, Textarea } from '@/ui'
import styles from './ContactPage.module.css'

const TOPICS = [
  { value: 'question', label: 'A question', prefix: 'Question' },
  { value: 'idea', label: 'An idea', prefix: 'Idea' },
  { value: 'bug', label: 'Something is broken', prefix: 'Bug' },
] as const

type Topic = (typeof TOPICS)[number]['value']

const WAYS = [
  {
    tone: 'pink',
    icon: Bug,
    title: 'Found a bug?',
    text: 'Tell us what you did and what went wrong. A screenshot helps a lot.',
    action: 'Report a bug',
    href: contactUrl('Bug: ', 'What I did:\n\nWhat I expected:\n\nWhat happened instead:\n'),
  },
  {
    tone: 'butter',
    icon: Lightbulb,
    title: 'Got an idea?',
    text: 'A feature you miss, a template you’d love, something that could be easier.',
    action: 'Share an idea',
    href: contactUrl('Idea: ', ''),
  },
  {
    tone: 'mint',
    icon: ShieldAlert,
    title: 'A security problem?',
    text: 'Please don’t post it in public. Email us privately and we’ll take it from there.',
    action: 'Report privately',
    href: contactUrl('Security: ', ''),
  },
] as const

export default function ContactPage() {
  usePageMeta({
    title: 'Contact',
    description: 'Get in touch with the Synkra team: report a bug, suggest an idea or report a security problem privately.',
    canonical: '/contact',
  })
  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="say hello"
        title={
          <>
            We’d <Accent>love</Accent> to hear from you.
          </>
        }
        lead="Questions, ideas and bug reports all reach the Synkra team directly — write to us and we’ll get back to you."
        bubble="hello friend!"
      />

      <ul className={styles.ways}>
        {WAYS.map(({ tone, icon: Icon, title, text, action, href }) => (
          <li key={title} className={styles.way} data-tone={tone}>
            <span className={styles.icon} aria-hidden="true">
              <Icon size={22} strokeWidth={2.2} />
            </span>
            <h2 className={styles.wayTitle}>{title}</h2>
            <p className={styles.wayText}>{text}</p>
            <AnchorButton href={href} rightIcon={<ArrowUpRight size={16} aria-hidden="true" />} className={styles.wayAction}>
              {action}
            </AnchorButton>
          </li>
        ))}
      </ul>

      <NoteForm />
    </div>
  )
}

/** Opens the note as a pre-filled email to the Synkra team, so the sender stays in control. */
function NoteForm() {
  const [topic, setTopic] = useState<Topic>('question')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!subject.trim()) {
      setError('Give your note a short subject.')
      return
    }
    const prefix = TOPICS.find((t) => t.value === topic)?.prefix ?? 'Question'
    window.open(contactUrl(`${prefix}: ${subject.trim()}`, message.trim()), '_self', 'noopener,noreferrer')
  }

  return (
    <section className={styles.note} aria-labelledby="note-title">
      <div className={styles.noteHead}>
        <p className={styles.hand}>or write us a note</p>
        <h2 id="note-title" className={styles.noteTitle}>
          Leave a note
        </h2>
        <p className={styles.noteLead}>
          Your note opens as a pre-filled email to <strong>{CONTACT_EMAIL}</strong>, so you can check it before it sends.
        </p>
      </div>
      <form className={styles.form} onSubmit={submit} noValidate>
        <Select label="What’s it about?" value={topic} onChange={(event) => setTopic(event.target.value as Topic)} options={TOPICS.map(({ value, label }) => ({ value, label }))} />
        <Input
          label="Subject"
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value)
            if (error) setError(null)
          }}
          error={error ?? undefined}
          maxLength={120}
          required
        />
        <Textarea label="Your note" value={message} onChange={(event) => setMessage(event.target.value)} rows={5} maxLength={4000} />
        <Button type="submit" rightIcon={<Send size={17} aria-hidden="true" />} className={styles.send}>
          Continue in your email app
        </Button>
      </form>
    </section>
  )
}
