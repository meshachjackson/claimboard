// POST /api/manager: one turn with the board manager agent (server/utils/boardManager.ts), behind the owner's login.
// The body is { messages: [{ role, content }] }, the whole conversation so far. The answer is { reply, actions }.
import { boardOwner } from '~~/app/types/board'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const { anthropicApiKey, managerModel } = useRuntimeConfig()
  if (!anthropicApiKey) {
    throw createError({ statusCode: 503, statusMessage: 'The board manager needs NUXT_ANTHROPIC_API_KEY set on the server' })
  }
  const body = await readBody(event).catch(() => null)
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const clean = messages
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-40)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 8000) }))
  if (clean.length === 0 || clean[clean.length - 1].role !== 'user') {
    throw createError({ statusCode: 400, statusMessage: 'The last message must be from the user' })
  }
  const store = boardStore()
  const deps = {
    // The owner's switches ride on the registry rows, as in GET /api/board, so no_taker sees a switched-off agent.
    read: async () => {
      const data = await store.read(true)
      return { ...data, registry: withSwitches(data.registry) }
    },
    write: (op: string, args: Record<string, unknown>) => store.write(op, args, { person: boardOwner() }),
    errors: readErrors
  }
  try {
    return await runManager(clean, deps, anthropicCall(String(anthropicApiKey)), String(managerModel))
  } catch (e) {
    throw createError({ statusCode: 502, statusMessage: (e as Error).message })
  }
})
