// POST /api/board/csv-mapping: the import dialog asks the board manager agent for a mapping. Body: { table } (header row
// first). Returns { id }; the dialog then polls GET /api/board/csv-mapping/:id.
import { createCsvRequest } from '../../utils/csvRequests.ts'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const body = await readBody(event).catch(() => null)
  const id = await createCsvRequest(body?.table)
  if (!id) throw createError({ statusCode: 400, statusMessage: 'The file has no header row' })
  return { id }
})
