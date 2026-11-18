// POST /api/agent/csv-mapping/:id: the board manager agent's proposed mapping for one waiting CSV.
// Body: { mapping: { <card field>: <CSV header> | null }, notes? }. Nothing is imported; the user approves in the dialog.
import { answerCsvRequest } from '../../../utils/csvRequests.ts'
import { bearerToken, resolveAgent } from '../../../utils/agentOps.ts'

export default defineEventHandler(async (event) => {
  const token = bearerToken(event)
  if (!token || !await resolveAgent(token)) throw createError({ statusCode: 401, statusMessage: 'Authorization: Bearer <token> is required' })
  const body = await readBody(event).catch(() => null)
  return answerCsvRequest(getRouterParam(event, 'id') ?? '', body)
})
