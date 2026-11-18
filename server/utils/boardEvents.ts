// "The board changed" signal for the push stream (GET /api/board/events). One Node process keeps one set of listeners,
// so this works on the local board and any single-process host. On Vercel each request may run in another instance,
// so the stream route is off there and browsers fall back to the live-refresh interval.
import { AGENT_WRITE_OPS, OWNER_OPS } from '../../app/types/board.ts'

const listeners = new Set<() => void>()

/** Calls `fn` on every board change until the returned function is called. */
export function onBoardChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Tells every open stream to re-read. */
export function announceBoardChange(): void {
  for (const fn of listeners) fn()
}

/** Whether a finished op changed rows. Reads (whoami, my_steps, read_brief) and refusals do not. */
export function changesBoard(op: string, ok: boolean): boolean {
  return ok && ((OWNER_OPS as readonly string[]).includes(op) || (AGENT_WRITE_OPS as readonly string[]).includes(op))
}
