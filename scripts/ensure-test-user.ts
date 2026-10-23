/** Ensure the sandbox test user exists (idempotent). */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/server/core'

const db = new PrismaClient()

async function main(): Promise<void> {
  const email = 'sandbox@synkra.test'
  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    await db.user.update({ where: { email }, data: { passwordHash: hashPassword('SandboxTest2026!'), isActive: true, isEmailVerified: true } })
    console.log('test user password reset:', existing.id)
  } else {
    const user = await db.user.create({ data: { email, passwordHash: hashPassword('SandboxTest2026!'), displayName: 'Sandbox Tester', isEmailVerified: true, isActive: true } })
    console.log('test user created:', user.id)
  }
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
