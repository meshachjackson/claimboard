// POST /api/access/onboard: the onboarding flow's last step. The first allowed person names their groups, for example
// executives and developers, and becomes the admin. It runs once; after that the policy is changed through PUT /api/access.
// Body: { groups: [{ name, members?: ["person:login" | "agt-id"] }] }
import { startingPolicy } from '~~/shared/access'

export default defineEventHandler(async (event) => {
  const user = await requireAllowedUser(event)
  if (readPolicy()) throw createError({ statusCode: 409, statusMessage: 'Onboarding already ran; change the policy with PUT /api/access' })
  const body = await readBody(event).catch(() => null)
  const groups = Array.isArray(body?.groups) ? body.groups : []
  const policy = startingPolicy(personId(user.login), groups.map((g: { name?: unknown, members?: unknown }) => ({
    name: String(g.name ?? ''),
    members: Array.isArray(g.members) ? g.members.map(String) : []
  })))
  if (typeof policy === 'string') throw createError({ statusCode: 400, statusMessage: policy })
  writePolicy(policy)
  return { ok: true, policy }
})
