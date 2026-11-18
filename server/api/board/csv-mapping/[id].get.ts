// GET /api/board/csv-mapping/:id: { proposal } is null until the board manager agent has answered.
import { getCsvRequest } from '../../../utils/csvRequests.ts'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const request = await getCsvRequest(getRouterParam(event, 'id') ?? '')
  if (!request) throw createError({ statusCode: 404, statusMessage: 'Unknown or expired request' })
  return { proposal: request.proposal }
})
