// The access policy file (shared/access.ts, docs/design/permissions.md). A missing file means no policy: nothing is hidden and
// no edit is refused, so existing installs behave as before until the owner finishes onboarding.
// @ts-ignore
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
// @ts-ignore
import { dirname } from 'node:path'
import type { H3Event } from 'h3'
import { atLeast, checkPolicy, levelFor } from '~~/shared/access'
import type { Policy } from '~~/shared/access'

function policyFile(): string {
  return String(useRuntimeConfig().accessPolicyFile)
}

/** The saved policy, or null when onboarding has not run (or the file is unreadable, which fails open only for a missing file). */
export function readPolicy(): Policy | null {
  if (!existsSync(policyFile())) return null
  const policy = JSON.parse(readFileSync(policyFile(), 'utf8')) as unknown
  const problem = checkPolicy(policy)
  // A damaged file must not silently open the board: refuse every request until the owner fixes it.
  if (problem) throw createError({ statusCode: 500, statusMessage: `access policy is invalid: ${problem}` })
  return policy as Policy
}

/** Checked, then written through a temp file so a crash never leaves half a policy. */
export function writePolicy(policy: unknown): string | null {
  const problem = checkPolicy(policy)
  if (problem) return problem
  mkdirSync(dirname(policyFile()), { recursive: true })
  const tmp = `${policyFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(policy, null, 2))
  renameSync(tmp, policyFile())
  return null
}

/** The id a signed-in person has in the policy: person:<github login>. */
export const personId = (login: string): string => `person:${login.toLowerCase()}`

/** 403 unless the signed-in person is in the admins group. With no policy yet, the allowed logins act as admins (so they can onboard). */
export async function requireAdmin(event: H3Event) {
  const user = await requireAllowedUser(event)
  const policy = readPolicy()
  if (policy && !atLeast(levelFor(policy, personId(user.login), {}), 'manage')) {
    throw createError({ statusCode: 403, statusMessage: 'Admins only' })
  }
  return { user, policy }
}
