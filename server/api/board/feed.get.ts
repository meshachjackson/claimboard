// GET /api/board/feed?since=<seq>: the event feed. Returns board_events after `seq` plus the current step
// rows and notes those events name. Without `since` it replays the last 10 minutes and the page keeps the cursor.
// Only exists with NUXT_STEP_STORE=postgres; the n8n path keeps the cached snapshot. Cards the caller may not see are cut out.
import { filterBoard, mayWatch } from '~~/shared/access'

export default defineEventHandler(async (event) => {
  const user = await requireAllowedUser(event)
  const policy = readPolicy()
  if (!mayWatch(policy, personId(user.login))) throw createError({ statusCode: 403, statusMessage: 'Your groups can see no board' })
  if (!stepStoreOn()) throw createError({ statusCode: 404, statusMessage: 'No event feed: the step store is off' })
  const raw = getQuery(event).since
  const since = raw === undefined || raw === '' ? null : Number(raw)
  if (since !== null && (!Number.isInteger(since) || since < 0)) throw createError({ statusCode: 400, statusMessage: 'since must be a whole number' })
  const feed = await readStepFeed(since)
  if (!policy) return feed
  const visible = new Set(filterBoard(policy, personId(user.login), await boardStore().read()).tasks.map(t => t.task_id))
  return { ...feed, events: feed.events.filter(e => visible.has(e.task_id)), steps: feed.steps.filter(s => visible.has(s.task_id)), notes: feed.notes.filter(n => visible.has(n.task_id)) }
})
