// POST /api/agent-switches { agent_id, mode }: the owner turns an agent on, off or auto (Settings > Agents).
// Where the switch is kept depends on the host (server/utils/switchStore.ts). Tells open pages to re-read, so every tab shows it.
import { isSwitchMode } from '~~/app/utils/availability'

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const body = await readBody(event).catch(() => null) as { agent_id?: unknown, mode?: unknown } | null
  const agentId = String(body?.agent_id ?? '')
  if (!/^agt-[a-z0-9-]+$/.test(agentId) || !isSwitchMode(body?.mode)) {
    throw createError({ statusCode: 400, statusMessage: 'Send { agent_id: "agt-…", mode: "on" | "auto" | "off" }' })
  }
  const problem = await saveSwitch(agentId, body.mode)
  if (problem) throw createError({ statusCode: 409, statusMessage: problem })
  announceBoardChange()
  return { ok: true }
})
