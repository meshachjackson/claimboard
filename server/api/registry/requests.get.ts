// GET /api/registry/requests: the agent requests on a reference install, newest first. Signed-in owner only.
// Adapters without their own approval path (n8n-gateway) answer 404: there, registration is form.gov-register-agent.
import type { AgentRequest } from '~~/app/types/registry'

export default defineEventHandler(async (event): Promise<{ requests: AgentRequest[] }> => {
  await requireAllowedUser(event)
  const registration = boardStore().registration
  if (!registration) throw createError({ statusCode: 404, statusMessage: 'This board registers agents through form.gov-register-agent' })
  return { requests: registration.list().reverse() }
})
