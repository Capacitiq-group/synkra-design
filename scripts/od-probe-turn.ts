import { runAgentTurn } from '/home/z/my-project/src/server/od/agent'

const history = [
  { role: 'user' as const, content: 'A pitch deck for my startup' },
  { role: 'assistant' as const, content: 'Got it — a pitch deck for your startup. Let me gather some key details.' },
  { role: 'user' as const, content: '[form answers — discovery]\noutput: Slide deck / pitch\naudience: early-stage investors in climate tech\nbrand: pick_direction\nscale: 8 slides' },
]

const events: string[] = []
for await (const ev of runAgentTurn({
  projectId: 'probe',
  brief: 'A pitch deck for my startup',
  projectKind: 'deck',
  skillId: null,
  designSystemId: null,
  direction: null,
  history: history.slice(0, 2),
  userMessage: history[2].content,
})) {
  if (ev.type === 'text') { process.stdout.write(ev.delta); continue }
  events.push(ev.type + (ev.type === 'artifact-end' ? ` ${ev.identifier} len=${ev.content.length}` : ''))
}
console.log('\n--- events:', events.join(', ') || '(none)')
process.exit(0)
