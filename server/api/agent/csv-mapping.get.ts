// GET /api/agent/csv-mapping: the board manager agent reads the CSV files users are importing and waiting on a mapping for.
// Authorization: Bearer <token>. Each request has the file's headers and its first rows. Answer with
// POST /api/agent/csv-mapping/:id. The card fields and the answer's shape are in docs/csv-mapping-proposal.md.
import { IMPORT_FIELDS } from '~~/app/types/board'
import { pendingCsvRequests } from '../../utils/csvRequests.ts'
import { bearerToken, resolveAgent } from '../../utils/agentOps.ts'

export default defineEventHandler(async (event) => {
  const token = bearerToken(event)
  if (!token || !await resolveAgent(token)) throw createError({ statusCode: 401, statusMessage: 'Authorization: Bearer <token> is required' })
  return {
    fields: IMPORT_FIELDS.map(f => ({ field: f.field, label: f.label })),
    guidance: 'Map each card field to one CSV header, or null. Epics go to project_id. Milestones, fix versions, releases and sprints go to tags. Answer as { mapping: { field: header|null }, notes }.',
    requests: await pendingCsvRequests()
  }
})
