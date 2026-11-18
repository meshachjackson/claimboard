// The "Nudge dispatcher" stamp. The button writes the time here; board-run polls /api/agent/dispatch every 5 seconds
// and starts a cycle when the stamp changes. It lives in the shared runtime cache, so it costs no gateway run and works on
// Vercel, where the push stream does not. Not a table: the app never writes n8n tables directly.
import { cacheGet, cacheSet } from './runtimeCache.ts'

const KEY = 'dispatcher-nudge'
const DAY = 24 * 60 * 60

export async function nudgeStamp(): Promise<number> {
  return (await cacheGet<number>(KEY)) ?? 0
}

export async function nudgeDispatcher(): Promise<number> {
  const stamp = Date.now()
  await cacheSet(KEY, stamp, DAY)
  return stamp
}
