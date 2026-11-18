// GET /api/board/events: a server-sent-event stream. The browser gets a "changed" event after every board write,
// then re-reads /api/board. It is for the local board; on Vercel the route answers 404 and the page polls instead.
import { mayWatch } from '~~/shared/access'
import { onBoardChange } from '../../utils/boardEvents.ts'

export default defineEventHandler(async (event) => {
  const user = await requireAllowedUser(event)
  if (!mayWatch(readPolicy(), personId(user.login))) throw createError({ statusCode: 403, statusMessage: 'Your groups can see no board' })
  // The repo has no @types/node; Nitro runs on Node, so `process` exists at run time.
  // @ts-ignore
  if (process.env.VERCEL) throw createError({ statusCode: 404, statusMessage: 'No push stream on this host' })
  const stream = createEventStream(event)
  void stream.push({ event: 'ready', data: '1' }) // not awaited: the stream flows only after this handler returns
  const off = onBoardChange(() => { void stream.push({ event: 'changed', data: String(Date.now()) }) })
  // A ping every 25 seconds keeps proxies from closing an idle stream.
  const beat = setInterval(() => { void stream.push({ event: 'ping', data: '1' }) }, 25_000)
  stream.onClosed(() => { off(); clearInterval(beat) })
  return stream.send()
})
