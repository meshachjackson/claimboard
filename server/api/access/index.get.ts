// GET /api/access: the access policy and what the signed-in person can do. `policy` is null until onboarding has run.
// Only admins see the rules; everyone else gets just their own id and groups.
import { groupsOf, visibleBoards } from '~~/shared/access'

export default defineEventHandler(async (event) => {
  const user = await requireAllowedUser(event)
  const policy = readPolicy()
  const you = personId(user.login)
  const boards = visibleBoards(policy, you, (await boardStore().read()).tasks)
  if (!policy) return { policy: null, you, groups: [], admin: true, boards }
  const groups = groupsOf(policy, you)
  const admin = groups.includes('admins')
  return { policy: admin ? policy : null, you, groups, admin, boards }
})
