/** Check font/element/stock counts in the DB and list missing font families. */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const db = new PrismaClient()

async function main(): Promise<void> {
  const fams = await db.fontFamily.findMany({ select: { slug: true, source: true } })
  const slugs = new Set(fams.map((f) => f.slug))
  const fonts = JSON.parse(readFileSync('/home/z/my-project/content/fontsource-fonts.json', 'utf8')) as { id: string }[]
  const missing = fonts.filter((f) => !slugs.has(f.id))
  const bySource = fams.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.source]: (acc[f.source] ?? 0) + 1 }), {})
  console.log('font families:', fams.length, bySource, '| variants:', await db.fontVariant.count())
  console.log('elements:', await db.element.count(), '| packs:', await db.elementPack.count())
  const packs = await db.elementPack.findMany({ select: { slug: true, _count: { select: { elements: true } } } })
  for (const p of packs) console.log(`  pack ${p.slug}: ${p._count.elements}`)
  console.log('missing fontsource families:', missing.length)
  if (missing.length) console.log(missing.map((f) => f.id).join(', '))
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
