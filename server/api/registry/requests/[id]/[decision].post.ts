// POST /api/registry/requests/<id>/approve | reject { note? }. Approve writes the registry row and the access.json entry and
// answers with the agent's token, once: only its SHA-256 is kept. Signed-in owner only.
import type { AgentRequest } from '~~/app/types/registry'

export default defineEventHandler(async (event): Promise<{ request: AgentRequest, token?: string }> => {
  await requireAllowedUser(event)
  const registration = boardStore().registration
  if (!registration) throw createError({ statusCode: 404, statusMessage: 'This board registers agents through form.gov-register-agent' })
  const decision = getRouterParam(event, 'decision')
  if (decision !== 'approve' && decision !== 'reject') throw createError({ statusCode: 404, statusMessage: 'Unknown decision' })
  const body = await readBody(event).catch(() => null)
  const note = body && typeof body === 'object' && typeof body.note === 'string' ? body.note : ''
  if (decision === 'reject' && !note.trim()) throw createError({ statusCode: 400, statusMessage: 'Say why in a note when you reject' })
  const result = registration.decide(getRouterParam(event, 'id') ?? '', decision, note)
  if (!result.ok) throw createError({ statusCode: 400, statusMessage: result.reason })
  // The token is in this one response and nowhere else. Never log it.
  return { request: result.request, ...(result.token ? { token: result.token } : {}) }
})
