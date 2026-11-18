// GET /api/board: the board's rows, from fixtures or from gw.gov-board-read (cached 5 minutes).
// `?fresh=1` (the Refresh button) skips the cache and costs one gateway run.
// `writable` says whether board writes can reach gw.gov-board-write (always true in fixtures).
// `liveOps` lists the proposed ops the gateway supports, so the UI only offers those.
// `feed` is true when steps live in Postgres (NUXT_STEP_STORE=postgres): the page polls GET /api/board/feed.
// `saved` says fixtures mode is keeping its rows in NUXT_BOARD_FILE: the page then sends edits here and shows these rows.
// With an access policy (shared/access.ts), the rows are cut down to the cards this person's groups may see.
import type { BoardData, BoardSource } from '~~/app/types/board'
import { filterBoard } from '~~/shared/access'

export default defineEventHandler(async (event): Promise<BoardData & { source: BoardSource, writable: boolean, liveOps: string[], saved: boolean, feed: boolean }> => {
  const user = await requireAllowedUser(event)
  const store = boardStore()
  // With the step store on, steps and notes come from Postgres over the n8n cards (cutover step 6), and a rollup a failed
  // run left behind is written to gov_tasks first, so the cards and their steps agree.
  if (stepStoreOn()) {
    await drainRollups()
    await pruneStepStore() // the 30-day retention, at most once an hour per instance
  }
  const all = await boardRows(getQuery(event).fresh === '1')
  const policy = readPolicy()
  const data = policy ? filterBoard(policy, personId(user.login), all) : all
  // The owner's switches ride on the registry rows so the card rules (takesMessages, canWake) see them.
  const registry = withSwitches(data.registry)
  // `feed` tells the page to poll /api/board/feed for step changes instead of waiting for the next snapshot.
  return { source: store.source(), ...store.capabilities(), ...data, registry, feed: stepStoreOn() }
})
