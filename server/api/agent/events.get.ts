// GET /api/agent/events: the push stream for an agent's local listener (os/scripts/board_listen.py). The same "changed"
// signal as /api/board/events, but the caller is an agent's bearer token, not the owner's GitHub login, because a
// script on the laptop has no browser session. Like the owner's stream it is for the local board; on Vercel the
// route answers 404. The event carries no rows: the listener asks list_claimable, and the gateway decides what it sees.
import { mayWatch } from '~~/shared/access'
import { onBoardChange } from '../../utils/boardEvents.ts'
import { bearerToken, resolveAgent } from '../../utils/agentOps.ts'
import { agentSwitchedOff } from '../../utils/switchStore.ts'

export default defineEventHandler(async (event) => {
  // The repo has no @types/node; Nitro runs on Node, so `process` exists at run time.
  // @ts-ignore
  if (process.env.VERCEL) throw createError({ statusCode: 404, statusMessage: 'No push stream on this host' })
  const token = bearerToken(event)
  const agentId = token ? await resolveAgent(token) : ''
  if (!agentId) throw createError({ statusCode: 401, statusMessage: 'Authorization: Bearer <token> is required' })
  if (!mayWatch(readPolicy(), agentId)) throw createError({ statusCode: 403, statusMessage: 'This agent can see no board' })
  // The owner's Off switch: no push for a switched-off agent, so its listener has nothing to wake on.
  if (await agentSwitchedOff(agentId)) throw createError({ statusCode: 403, statusMessage: 'This agent is switched off on the board' })
  const stream = createEventStream(event)
  void stream.push({ event: 'ready', data: '1' }) // not awaited: the stream flows only after this handler returns
  const off = onBoardChange(async () => {
    // Switched off while connected: stay quiet (pings continue) until it is switched on again.
    if (await agentSwitchedOff(agentId)) return
    void stream.push({ event: 'changed', data: String(Date.now()) })
  })
  // A ping every 25 seconds keeps the connection from being closed as idle.
  const beat = setInterval(() => { void stream.push({ event: 'ping', data: '1' }) }, 25_000)
  stream.onClosed(() => { off(); clearInterval(beat) })
  return stream.send()
})
