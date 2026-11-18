// Glue for the error log (errorLogStore.ts): picks the backend, and gives the rest of the server three calls.
//   logError(e)       write one fault. Never throws and never waits on anything but the write itself.
//   readErrors(q)     the grouped report the orchestrator's board_errors tool and the board manager's recent_errors tool answer with.
//   pruneErrorLog()   drops rows older than 30 days; stepStore.ts calls it with the hourly event prune.
// With NUXT_STEP_STORE=postgres the rows go in the step store's database, so every Vercel instance writes to and reads
// from one log. Without it they go to a ring in this process (fine for local dev; the report says so).
import { createMemoryErrorLog, createPgErrorLog, readErrorReport, scrub, type ErrorInput, type ErrorLog, type ErrorQuery, type ErrorReport } from './errorLogStore'
import { stepDb, stepStoreOn } from './stepStore'

let pg: Promise<ErrorLog> | null = null
let memory: ErrorLog | null = null

function errorLog(): Promise<ErrorLog> | ErrorLog {
  if (stepStoreOn()) return (pg ??= stepDb().then(createPgErrorLog))
  return (memory ??= createMemoryErrorLog())
}

/** Writes one fault. A failure is reported to the console (scrubbed) and swallowed: the log must never break what it describes. */
export async function logError(e: ErrorInput): Promise<void> {
  try {
    await (await errorLog()).record(e)
  } catch (err) {
    console.error(`[error-log] could not record an error: ${scrub((err as Error)?.message)}`)
  }
}

/** Errors in a window, grouped by fault. Throws on a bad timestamp; the callers turn that into a refusal. */
export async function readErrors(q: ErrorQuery): Promise<ErrorReport> {
  return readErrorReport(await errorLog(), stepStoreOn() ? 'postgres' : 'memory', q)
}

export async function pruneErrorLog(): Promise<void> {
  try {
    await (await errorLog()).prune()
  } catch (err) {
    console.error(`[error-log] prune failed: ${scrub((err as Error)?.message)}`)
  }
}
