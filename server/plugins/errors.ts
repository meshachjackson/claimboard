// Writes every server fault to the error log (server/utils/errorLog.ts) so the orchestrator can read it back.
// Faults only: a 4xx is the board refusing a request (bad token, stale row, unknown card), which happens all day and is
// not something to file a ticket about. A 5xx, or an error with no status, is a bug or an outage.
import { waitUntil } from '@vercel/functions'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, ctx) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500
    if (status < 500) return
    const data = (error as { data?: { error?: unknown } }).data
    // A gateway failure carries its reason in data.error; the status text alone would just say "Bad Gateway".
    const message = typeof data?.error === 'string' ? data.error : (error as Error).message || 'server error'
    waitUntil(logError({ source: 'http', message, path: ctx?.event?.path, status }))
  })
})
