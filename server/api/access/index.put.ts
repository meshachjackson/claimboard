// PUT /api/access: an admin replaces the whole policy (groups, members, rules). The body is checked before it is saved.
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody(event).catch(() => null)
  const problem = writePolicy(body)
  if (problem) throw createError({ statusCode: 400, statusMessage: problem })
  return { ok: true }
})
