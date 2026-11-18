// POST /api/agent/:op: the agent REST contract. Authorization: Bearer <token>.
// No GitHub session here: the token is the caller, and gw.gov-board-write decides what it may do.
export default defineEventHandler(async (event) => {
  const token = bearerToken(event)
  if (!token) throw createError({ statusCode: 401, statusMessage: 'Authorization: Bearer <token> is required' })
  const args = await readBody(event).catch(() => null) ?? {}
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw createError({ statusCode: 400, statusMessage: 'The body must be a JSON object of op args' })
  }
  return runAgentOp(getRouterParam(event, 'op') ?? '', args as Record<string, unknown>, token)
})
