// POST /api/registry/requests { agent_id, name, webhook_url, classes }: files a pending request. The agent has no registry
// row and no token until the owner approves it (/api/registry/requests/<id>/approve).
import type { AgentRequest } from '~~/app/types/registry'
import { boardOwner } from '~~/app/types/board'

export default defineEventHandler(async (event): Promise<{ request: AgentRequest }> => {
  await requireAllowedUser(event)
  const registration = boardStore().registration
  if (!registration) throw createError({ statusCode: 404, statusMessage: 'This board registers agents through form.gov-register-agent' })
  const result = registration.file(await readBody(event).catch(() => null), boardOwner())
  if (!result.ok) throw createError({ statusCode: 400, statusMessage: result.reason })
  return { request: result.request }
})
