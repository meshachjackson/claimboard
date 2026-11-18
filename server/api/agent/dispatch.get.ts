// GET /api/agent/dispatch: what the one dispatcher (scripts/board-run.mjs) polls every few seconds. The nudge stamp, and how many
// steps are open for each target (laptop, cloud, actions), so it knows when to wake the cloud target. Counts only: no card text.
// Reads the cached board, so a class-scoped caller is refused, as with board_report.
import { openByTarget } from '~~/app/utils/dispatch'
import { nudgeStamp } from '../../utils/dispatcher.ts'
import { bearerToken, resolveAgent } from '../../utils/agentOps.ts'
import { readsNeedClassRule, unscopedAgentList } from '../../utils/classScope.ts'
import { openStepRows } from '../../utils/stepStore.ts'

export default defineEventHandler(async (event) => {
  const token = bearerToken(event)
  const agentId = token ? await resolveAgent(token) : ''
  if (!agentId) throw createError({ statusCode: 401, statusMessage: 'Authorization: Bearer <token> is required' })
  if (readsNeedClassRule(agentId, unscopedAgentList(useRuntimeConfig().unscopedAgents))) {
    throw createError({ statusCode: 403, statusMessage: 'dispatch status is not available to class-scoped callers' })
  }
  const steps = await openStepRows() // only the open steps once the flag is on, else the n8n read
  return { ok: true, nudge: await nudgeStamp(), targets: openByTarget(steps) }
})
