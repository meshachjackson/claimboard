// Optimistic writes. The page shows what the server last said (confirmed) plus every click that has not been answered
// yet (pending), replayed through applyOp, the browser copy of the gateway's rules. A click changes the screen at once;
// the request goes out in the background. When the answer comes back the real rows replace the guess. When it fails,
// the click is dropped and the screen falls back. Pure logic, no Vue: the store wires it up and test/write-queue.test.ts runs it.
import type { BoardColumn, BoardData, Caller, RegistryAgent, WriteResult } from '~/types/board'
import { applyOp, mergeRows } from '~/utils/boardOps'

export type Rows = Pick<BoardData, 'tasks' | 'steps' | 'notes'>

const clone = <T>(rows: T): T => JSON.parse(JSON.stringify(rows)) as T

// A new card gets its id from the server, so a guessed card would only swap itself out a second later.
const NO_GUESS = new Set(['create_task'])

export interface PendingOp {
  id: number
  op: string
  // Without updated_at: the token is read from the row it belongs to each time the op is replayed or sent.
  args: Record<string, unknown>
  withToken: boolean
  caller: Caller
  at: number // replay uses the same instant every time, so the guessed rows stay the same between replays
  lane: string // the card the op belongs to; ops on one lane go out one at a time, in order
  sending: boolean
}

export interface QueueDeps {
  /** Sends one op. Must resolve with a WriteResult: a failed request is `{ ok: false, reason }`, not a throw. */
  send: (op: string, args: Record<string, unknown>, caller: Caller) => Promise<WriteResult>
  /** The registry and columns applyOp reads. Never changed by an op. */
  context: () => { columns: BoardColumn[], registry: RegistryAgent[] }
  /** The shown rows or the pending list changed. */
  onChange: () => void
  /** An op failed. `dropped` are the later ops on the same card that went down with it. */
  onFailure: (failed: PendingOp, result: Extract<WriteResult, { ok: false }>, dropped: PendingOp[]) => void
}

/** The row's own updated_at: the step's when the op names a step, else the task's. */
function tokenFrom(rows: Rows, args: Record<string, unknown>): string | undefined {
  const stepId = String(args.step_id ?? '')
  if (stepId) return rows.steps.find(s => s.step_id === stepId)?.updated_at
  return rows.tasks.find(t => t.task_id === String(args.task_id ?? ''))?.updated_at
}

export function createWriteQueue(deps: QueueDeps) {
  let confirmed: Rows = { tasks: [], steps: [], notes: [] }
  let pending: PendingOp[] = []
  let seq = 0
  const resolvers = new Map<number, (r: WriteResult) => void>()
  const running = new Set<string>()
  // Rows the pending ops made up, so the page can mark them "sending".
  let guessedNotes = new Set<string>()
  let shown: Rows = confirmed

  function laneOf(op: string, args: Record<string, unknown>): string {
    const taskId = String(args.task_id ?? '')
    if (taskId) return taskId
    const stepId = String(args.step_id ?? '')
    if (stepId) {
      const step = [...shown.steps, ...confirmed.steps].find(s => s.step_id === stepId)
      return step?.task_id ?? `step:${stepId}`
    }
    return `${op}:${seq}` // a new card has no lane to wait on
  }

  /** confirmed + every pending op, replayed in the order they were clicked. An op the rules refuse changes nothing. */
  function replay(): Rows {
    let working = clone(confirmed)
    guessedNotes = new Set()
    if (!pending.length) return working
    const { columns, registry } = deps.context()
    for (const p of pending) {
      if (NO_GUESS.has(p.op)) continue
      const trial = clone(working)
      const args = p.withToken ? { ...p.args, updated_at: tokenFrom(trial, p.args) } : p.args
      const result = applyOp({ ...trial, columns, registry }, p.op, args, p.caller, p.at)
      if (!result.ok) continue
      working = trial
      for (const n of result.rows.notes ?? []) guessedNotes.add(n.note_id)
    }
    return working
  }

  function refresh() {
    shown = replay()
    deps.onChange()
  }

  async function drain(lane: string) {
    if (running.has(lane)) return
    const next = pending.find(p => p.lane === lane)
    if (!next) return
    running.add(lane)
    next.sending = true
    // The server knows the confirmed row, not the guessed one, so the token comes from there.
    const args = next.withToken ? { ...next.args, updated_at: tokenFrom(confirmed, next.args) } : next.args
    let result: WriteResult
    try {
      result = await deps.send(next.op, args, next.caller)
    } catch (err) {
      result = { ok: false, op: next.op, reason: err instanceof Error ? err.message : 'no response' }
    }
    pending = pending.filter(p => p !== next)
    let dropped: PendingOp[] = []
    if (result.ok) {
      mergeRows(confirmed, result.rows)
    } else {
      // Later clicks on this card were made on top of the one that failed, so they go too.
      dropped = pending.filter(p => p.lane === lane)
      pending = pending.filter(p => p.lane !== lane)
    }
    running.delete(lane)
    refresh()
    resolvers.get(next.id)?.(result)
    resolvers.delete(next.id)
    for (const d of dropped) {
      resolvers.get(d.id)?.({ ok: false, op: d.op, reason: 'undone' })
      resolvers.delete(d.id)
    }
    if (!result.ok) deps.onFailure(next, result, dropped)
    void drain(lane)
  }

  /** Shows the click now, sends it in turn, and settles with the server's answer. */
  function enqueue(op: string, args: Record<string, unknown>, caller: Caller): Promise<WriteResult> {
    const { updated_at: _token, ...bare } = args
    const entry: PendingOp = { id: ++seq, op, args: bare, withToken: 'updated_at' in args, caller, at: Date.now(), lane: laneOf(op, args), sending: false }
    const done = new Promise<WriteResult>(resolve => resolvers.set(entry.id, resolve))
    pending.push(entry)
    refresh()
    void drain(entry.lane)
    return done
  }

  return {
    enqueue,
    /** The server's rows arrived (a read). Pending clicks stay on screen on top of them. */
    setConfirmed(rows: Rows) {
      confirmed = clone(rows)
      refresh()
    },
    /** Changes the server's rows in place (the event feed). Pending clicks stay on screen on top of the result. */
    mergeConfirmed(change: (rows: Rows) => Rows) {
      confirmed = change(confirmed)
      refresh()
    },
    rows: () => shown,
    pending: () => pending,
    /** Cards with a click the server has not answered. */
    busyLanes: () => new Set(pending.map(p => p.lane)),
    guessedNotes: () => guessedNotes
  }
}
