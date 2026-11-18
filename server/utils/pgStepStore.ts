// The Postgres step store: steps, notes and events live here, not in gov_task_steps / gov_task_notes.
// It answers the agent step ops (claim_step, heartbeat, update_step, complete_step, add_note, list_claimable, get_task)
// and reuses the op rules in app/utils/boardOps.ts, so every refusal reason matches the n8n path. What changes is the
// write: each op runs in one transaction and every step row is saved with a compare-and-swap UPDATE guarded by the
// updated_at the rules read. Of two writers on the same snapshot, one UPDATE matches a row and the other matches none.
// Ids come from sequences (server/db/step-store.sql), never max+1. gov_tasks, gov_registry and gov_access stay in n8n:
// they arrive through `context` (the read cache), and a card rollup the op computes is queued in task_rollups.
// No Nitro auto-imports and no driver import: the caller hands in a `Db`, so tests use pglite and production a pooled driver.
import type { BoardData, Caller, GovTask, GovTaskNote, GovTaskStep, WriteResult } from '~~/app/types/board'
import type { AccessRow } from '~~/app/types/registry'
import { boardOwner } from '~~/app/types/board'
import { applyOp, claimableSteps, parentOf, ROLLUP_FIELDS } from '~~/app/utils/boardOps'
import { finishRefusal } from '~~/app/utils/dispatch'
import { CARD_OPS, STORE_OPS, classesOf, classOk, classRefusal, storeRefusal } from '~~/shared/agentAccess'

/** The slice of a Postgres client the store needs. pglite, node-postgres and the Neon pool all fit with a thin adapter. */
export interface Db {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[], rowCount: number }>
  transaction: <T>(work: (tx: Db) => Promise<T>) => Promise<T>
  /** Runs several statements with no parameters (the migration). */
  exec: (sql: string) => Promise<unknown>
}

/** What n8n still owns, as the read cache last saw it. */
export interface StepContext {
  tasks: GovTask[]
  columns: BoardData['columns']
  registry: BoardData['registry']
  access: AccessRow[]
  board_async?: boolean
}

export interface PgStepStore {
  /** True for the ops this store answers. */
  handles: (op: string) => boolean
  write: (op: string, args: Record<string, unknown>, agentId: string) => Promise<WriteResult>
  /** True for the owner ops that create, cancel or retarget steps (CARD_OPS). */
  handlesCard: (op: string) => boolean
  /** One owner card op, answered from Postgres by the same rules. */
  writeCard: (op: string, args: Record<string, unknown>) => Promise<WriteResult>
  /** Events after `since` (null: the recent window), with the current rows they name. */
  feed: (since: number | null, limit?: number) => Promise<Feed>
  /** Every step and note the store holds: the board snapshot's steps and notes once the flag is on (cutover step 6). */
  rows: (sinceIso?: string) => Promise<{ steps: GovTaskStep[], notes: GovTaskNote[] }>
  /** Only the open steps' routing fields (no notes, no text columns): what the dispatcher's 5-second poll needs to count work. */
  openSteps: () => Promise<{ assignee: string, role: string, step_state: string, cancelled: boolean, acked_at: null }[]>
  /**
   * Retention: deletes board_events older than EVENT_RETENTION_DAYS and task_rollups applied that long ago. Steps and
   * notes are never pruned. The events trigger refuses anything younger, so a wrong clock cannot take live rows.
   */
  prune: () => Promise<{ events: number, rollups: number }>
  /**
   * Cutover step 4: applies the card changes queued in task_rollups through `apply` (the gateway's apply_rollup), one call per
   * card with its pending rollups merged. Rows are claimed first so two instances never spend two runs on one rollup; a
   * refusal or a thrown gateway error is kept on the row and tried again later, up to ROLLUP_MAX_ATTEMPTS.
   */
  drainRollups: (apply: RollupApply, limit?: number) => Promise<Drained>
  /**
   * split_task on path B: the children are cards, so each is made through `createCard` (gateway create_task); the parent's
   * status note is written here. Refused with the rules' own reason before any card is made.
   */
  splitCard: (args: Record<string, unknown>, caller: Caller, createCard: (fields: Record<string, string>) => Promise<WriteResult>) => Promise<WriteResult>
}

/** One gateway call for one card: the merged ROLLUP_FIELDS as text (the gateway takes every arg as text). */
export type RollupApply = (taskId: string, fields: Record<string, string>) => Promise<WriteResult>
/** What a drain did: the cards the gateway now holds, and the cards whose rollup was refused this time. */
export interface Drained { applied: GovTask[], refused: { task_id: string, reason: string }[] }
/** A rollup refused or failed this many times stays in the table for a person to look at; the drain stops retrying it. */
export const ROLLUP_MAX_ATTEMPTS = 5
/** A claimed rollup the claimer never settled (a crashed instance) is claimable again after this long. */
export const ROLLUP_RECLAIM_MS = 60_000
/** How long events and applied rollups are kept. Matches the interval in server/db/step-store.sql's board_events_guard. */
export const EVENT_RETENTION_DAYS = 30

/** One board_events row as the feed returns it. `seq` is the cursor a client sends back as `since`. */
export interface FeedEvent { seq: number, event_id: string, task_id: string, step_id: string, job_id: string, actor: string, kind: string, old_value: string, new_value: string, created_at: string }
/** A feed read: events in seq order, the current step rows and notes they name, and the cursor for the next read. */
export interface Feed { cursor: number, events: FeedEvent[], steps: GovTaskStep[], notes: GovTaskNote[] }

/** Without a cursor the feed replays this much history: twice the 5-minute snapshot cache, so a page that loaded from a stale snapshot catches up. */
export const FEED_WINDOW_MS = 10 * 60_000
/** A read with a cursor also returns events this young, even at or below the cursor. seq is taken at INSERT, not COMMIT, so a
 *  slow transaction can commit seq 5 after a reader has already seen seq 6; the overlap hands it over. mergeFeed ignores repeats. */
export const FEED_OVERLAP_MS = 30_000
const FEED_LIMIT = 500

type EventRow = Omit<FeedEvent, 'seq' | 'event_id' | 'created_at'>
/** The event kind for a step op. update_step always moves the step to needs_input or failed, so it reads as a status change. */
function eventKind(op: string): string {
  return ({ claim_step: 'dispatch', heartbeat: 'heartbeat', update_step: 'status_change', complete_step: 'complete' } as Record<string, string>)[op] ?? 'status_change'
}
async function appendEvent(q: Db, e: EventRow, nowMs: number): Promise<void> {
  await q.query('INSERT INTO board_events (task_id, step_id, job_id, actor, kind, old_value, new_value, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)',
    [e.task_id, e.step_id, e.job_id, e.actor, e.kind, e.old_value, e.new_value, new Date(nowMs).toISOString()])
}

/** Thrown inside a transaction when a compare-and-swap UPDATE matched no row; rolls the transaction back. */
class StaleWrite extends Error {}

const STEP_COLS = [
  'task_id', 'step_no', 'assignee', 'goal', 'input_ref', 'target_action', 'target_ticket_ref', 'step_state', 'stop_reason', 'verdict',
  'budget_used', 'output_ref', 'output_summary', 'vera_ticket_ref', 'created_at', 'dispatched_at', 'ended_at', 'updated_at', 'claim_key',
  'lease_owner', 'lease_expires_at', 'acked_at', 'cancelled', 'claim_count', 'last_claimed_at', 'role', 'activity', 'heartbeat_at',
  'job_id', 'timeout_sec', 'tokens_in', 'tokens_out'
] as const
const DATE_COLS = new Set(['created_at', 'dispatched_at', 'ended_at', 'updated_at', 'lease_expires_at', 'acked_at', 'last_claimed_at', 'heartbeat_at'])
const NUM_COLS = new Set(['step_no', 'claim_count', 'timeout_sec', 'tokens_in', 'tokens_out'])

const iso = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : new Date(v as string).toISOString())

/** A database row as the board's GovTaskStep: dates as ISO strings, counts as numbers. */
export function stepFromRow(row: Record<string, unknown>): GovTaskStep {
  const out: Record<string, unknown> = { step_id: row.step_id }
  for (const c of STEP_COLS) {
    const v = row[c]
    out[c] = DATE_COLS.has(c) ? iso(v) : NUM_COLS.has(c) && v !== null && v !== undefined ? Number(v) : v
  }
  // The n8n rows carry updated_at as an ISO string and blank dates as null; the rules treat both the same.
  return out as unknown as GovTaskStep
}

function noteFromRow(row: Record<string, unknown>): GovTaskNote {
  return { note_id: String(row.note_id), task_id: String(row.task_id), step_id: String(row.step_id), author_id: String(row.author_id), kind: row.kind as GovTaskNote['kind'], body: String(row.body), created_at: iso(row.created_at)! }
}

/** Creates the tables, sequences and triggers. Idempotent. The SQL text comes from server/db/step-store.sql. */
export async function applySchema(db: Db, sql: string): Promise<void> {
  await db.exec(sql)
}

/** Loads rows exported from the n8n tables (cutover step 2) and moves each sequence past the highest live id. */
export async function importSnapshot(db: Db, input: { steps: GovTaskStep[], notes: GovTaskNote[] }): Promise<{ steps: number, notes: number }> {
  await db.transaction(async (tx) => {
    for (const st of input.steps) {
      const cols = ['step_id', ...STEP_COLS]
      const vals = cols.map(c => (DATE_COLS.has(c) ? iso((st as unknown as Record<string, unknown>)[c]) : (st as unknown as Record<string, unknown>)[c] ?? defaultFor(c)))
      await tx.query(
        `INSERT INTO gov_task_steps (${cols.join(',')}) VALUES (${cols.map((c, i) => DATE_COLS.has(c) ? `$${i + 1}::timestamptz` : `$${i + 1}`).join(',')}) ON CONFLICT (step_id) DO NOTHING`,
        vals
      )
    }
    for (const n of input.notes) {
      // Notes are append-only in the table, so a re-run skips ids it already has.
      await tx.query('INSERT INTO gov_task_notes (note_id, task_id, step_id, author_id, kind, body, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz) ON CONFLICT (note_id) DO NOTHING',
        [n.note_id, n.task_id, n.step_id ?? '', n.author_id, n.kind, n.body, iso(n.created_at)])
    }
    // setval to the highest numeric suffix so the next nextval() is one past it (the rows keep their live ids).
    await tx.query(`SELECT setval('step_id_seq', COALESCE(m, 1), m IS NOT NULL) FROM (SELECT max(substr(step_id, 5)::bigint) AS m FROM gov_task_steps WHERE step_id ~ '^STP-[0-9]+$') x`)
    await tx.query(`SELECT setval('note_id_seq', COALESCE(m, 1), m IS NOT NULL) FROM (SELECT max(substr(note_id, 5)::bigint) AS m FROM gov_task_notes WHERE note_id ~ '^NTE-[0-9]+$') x`)
  })
  return { steps: input.steps.length, notes: input.notes.length }
}

function defaultFor(col: string): unknown {
  if (col === 'cancelled') return false
  if (col === 'claim_count') return 0
  if (NUM_COLS.has(col)) return null
  return ''
}

export function createPgStepStore(options: { db: Db, context: () => Promise<StepContext>, now?: () => number }): PgStepStore {
  const { db } = options
  const clock = options.now ?? (() => Date.now())

  const stepsOfTask = async (q: Db, taskId: string) =>
    (await q.query('SELECT * FROM gov_task_steps WHERE task_id = $1 ORDER BY step_no', [taskId])).rows.map(stepFromRow)
  const stepById = async (q: Db, stepId: string) => {
    const r = (await q.query('SELECT * FROM gov_task_steps WHERE step_id = $1', [stepId])).rows[0]
    return r ? stepFromRow(r) : null
  }

  /** The compare-and-swap: save one changed step only if updated_at is still what the rules read. */
  async function saveStep(q: Db, step: GovTaskStep, readAt: string | null, claim: boolean): Promise<void> {
    const rec = step as unknown as Record<string, unknown>
    const sets = STEP_COLS.map((c, i) => `${c} = $${i + 3}${DATE_COLS.has(c) ? '::timestamptz' : ''}`)
    const vals = STEP_COLS.map(c => (DATE_COLS.has(c) ? iso(rec[c]) : rec[c] ?? defaultFor(c)))
    // A claim also insists the step is still unacked and unclaimed since the read: the one-statement claim guard.
    const guard = claim ? ' AND acked_at IS NULL AND NOT cancelled' : ''
    const res = await q.query(`UPDATE gov_task_steps SET ${sets.join(', ')} WHERE step_id = $1 AND updated_at = $2::timestamptz${guard}`, [step.step_id, readAt, ...vals])
    if (res.rowCount !== 1) throw new StaleWrite()
  }

  /**
   * Saves what an op's rules produced, inside the caller's transaction. Changed steps go through the compare-and-swap;
   * a step the rules created (a retry, a builder step on Start, a chat step) is inserted and takes the next id from the
   * sequence. The rules mint placeholder ids (STP-9000xx, NTE-9000xx): notes and step input refs are rewritten to the real
   * ones before they are saved. Card changes (stage, work_state) are queued in task_rollups, never written to gov_tasks.
   */
  async function persist(tx: Db, result: Extract<WriteResult, { ok: true }>, before: GovTaskStep[], tasks: GovTask[], actor: string, op: string, nowMs: number, named?: GovTaskStep | null): Promise<WriteResult> {
    const rows = result.rows
    const readAt = new Map(before.map(s => [s.step_id, s.updated_at]))
    const idMap = new Map<string, string>()
    const created: GovTaskStep[] = []
    const stamp = new Date(nowMs).toISOString()
    const event = (st: GovTaskStep, stepId: string, kind: string, old: string) =>
      tx.query(`INSERT INTO board_events (task_id, step_id, job_id, actor, kind, old_value, new_value, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)`,
        [st.task_id, stepId, st.job_id ?? '', actor, kind, old, st.step_state, stamp])
    // Steps first: compare-and-swap for the ones that existed, INSERT for the new ones.
    for (const st of rows.steps ?? []) {
      if (readAt.has(st.step_id)) {
        await saveStep(tx, st, readAt.get(st.step_id) ?? null, op === 'claim_step')
        const prev = before.find(s => s.step_id === st.step_id)
        const old = named && named.step_id === st.step_id ? named.step_state : prev?.step_state
        // One event per saved step, so the feed tells every open board what changed. add_note also touches the
        // step, but its note event already names the step. A heartbeat carries the new activity as its value.
        if (op !== 'add_note') await appendEvent(tx, { task_id: st.task_id, step_id: st.step_id, job_id: st.job_id ?? '', actor, kind: eventKind(op), old_value: old ?? '', new_value: op === 'heartbeat' ? st.activity ?? '' : st.step_state }, nowMs)
        continue
      }
      const rec = st as unknown as Record<string, unknown>
      const res = await tx.query(
        `INSERT INTO gov_task_steps (${STEP_COLS.join(',')}) VALUES (${STEP_COLS.map((c, i) => `$${i + 1}${DATE_COLS.has(c) ? '::timestamptz' : ''}`).join(',')}) RETURNING step_id`,
        STEP_COLS.map(c => (DATE_COLS.has(c) ? iso(rec[c]) : rec[c] ?? defaultFor(c)))
      )
      const realId = String(res.rows[0]!.step_id)
      idMap.set(st.step_id, realId)
      created.push({ ...st, step_id: realId })
      await event(st, realId, 'status_change', '')
    }
    // Notes next, with the real step ids; then each new step's input_ref, which may name one of those notes.
    const notes: GovTaskNote[] = []
    for (const n of rows.notes ?? []) {
      const stepId = idMap.get(n.step_id) ?? n.step_id
      const r = await tx.query('INSERT INTO gov_task_notes (task_id, step_id, author_id, kind, body, created_at) VALUES ($1,$2,$3,$4,$5,$6::timestamptz) RETURNING note_id', [n.task_id, stepId, n.author_id, n.kind, n.body, n.created_at])
      idMap.set(n.note_id, String(r.rows[0]!.note_id))
      notes.push({ ...n, step_id: stepId, note_id: String(r.rows[0]!.note_id) })
      await appendEvent(tx, { task_id: n.task_id, step_id: stepId ?? '', job_id: '', actor, kind: 'note', old_value: '', new_value: String(r.rows[0]!.note_id) }, nowMs)
    }
    for (const st of created) {
      const ref = idMap.get(st.input_ref)
      if (ref) await tx.query('UPDATE gov_task_steps SET input_ref = $2 WHERE step_id = $1', [st.step_id, ref])
    }
    for (const t of rows.tasks ?? []) {
      const prev = tasks.find(x => x.task_id === t.task_id) as unknown as Record<string, unknown> | undefined
      const changed = Object.fromEntries(Object.entries(t).filter(([k, v]) => !prev || prev[k] !== v))
      await tx.query('INSERT INTO task_rollups (task_id, fields_json) VALUES ($1,$2)', [t.task_id, JSON.stringify(changed)])
    }
    // Return the steps as the database now holds them, so the answer carries what the next reader will see.
    const ids = (rows.steps ?? []).map(s => idMap.get(s.step_id) ?? s.step_id)
    const saved = (await Promise.all(ids.map(id => stepById(tx, id)))).filter(Boolean) as GovTaskStep[]
    return { ...result, rows: { ...rows, steps: saved, notes } }
  }

  /**
   * A card op from the owner (CARD_OPS: move_task, start_task, send_back, assign and the rest), run by the same boardOps.ts
   * rules as every other path. The card and the children waiting on it come from the read cache; their steps from Postgres.
   */
  async function writeCard(op: string, args: Record<string, unknown>): Promise<WriteResult> {
    if (!(CARD_OPS as readonly string[]).includes(op)) return { ok: false, op, reason: `op ${op} is not answered by the step store` }
    if (op === 'split_task') return { ok: false, op, reason: 'split_task makes cards: use splitCard' }
    const ctx = await options.context()
    const nowMs = clock()
    const stepArg = String(args.step_id ?? '')
    const taskId = String(args.task_id ?? '') || (stepArg ? (await stepById(db, stepArg))?.task_id ?? '' : '')
    if (!taskId) return { ok: false, op, reason: `${op} names no card` }
    try {
      return await db.transaction(async (tx) => {
        const tasks = structuredClone(ctx.tasks)
        // The card plus the children that wait on it: Done on the card may start them in this same answer.
        const ids = [taskId, ...tasks.filter(t => parentOf(t) === taskId).map(t => t.task_id)]
        const steps = (await tx.query('SELECT * FROM gov_task_steps WHERE task_id = ANY($1::text[]) ORDER BY step_no', [ids])).rows.map(stepFromRow)
        const board = { tasks, steps, notes: [], columns: ctx.columns, registry: ctx.registry, board_async: ctx.board_async }
        const before = structuredClone(steps)
        const result = applyOp(board as never, op, args, { person: boardOwner() }, nowMs)
        if (!result.ok) return result
        return persist(tx, result, before, ctx.tasks, boardOwner(), op, nowMs)
      })
    } catch (e) {
      if (e instanceof StaleWrite) return { ok: false, op, reason: 'stale' }
      throw e
    }
  }

  async function write(op: string, args: Record<string, unknown>, agentId: string): Promise<WriteResult> {
    if (!(STORE_OPS as readonly string[]).includes(op)) return { ok: false, op, reason: `op ${op} is not answered by the step store` }
    const ctx = await options.context()
    const nowMs = clock()

    if (op === 'list_claimable') {
      const refusal = storeRefusal(ctx.registry, ctx.access, agentId, op)
      if (refusal) return { ok: false, op, reason: refusal }
      const open = (await db.query(`SELECT * FROM gov_task_steps WHERE NOT cancelled AND acked_at IS NULL AND (assignee = $1 OR assignee LIKE 'pool:%')`, [agentId])).rows.map(stepFromRow)
      // A class-scoped agent sees only steps on cards of its classes (n8n my_steps).
      const classes = classesOf(ctx.access, agentId)
      const visible = (taskId: string) => classOk(classes, ctx.tasks.find(t => t.task_id === taskId)?.tags)
      const steps = claimableSteps({ registry: ctx.registry, steps: open } as never, agentId, nowMs).filter(s => visible(s.task_id))
      return { ok: true, op, rows: { tasks: ctx.tasks.filter(t => steps.some(s => s.task_id === t.task_id)), steps, notes: [] }, agent_id: agentId }
    }
    if (op === 'get_task') {
      const taskId = String(args.task_id ?? '')
      const task = ctx.tasks.find(t => t.task_id === taskId)
      if (!task) return { ok: false, op, reason: `unknown task ${taskId}` }
      const classes = classesOf(ctx.access, agentId)
      if (!classOk(classes, task.tags)) return { ok: false, op, reason: classRefusal(agentId, classes, taskId, task.tags) }
      const notes = (await db.query('SELECT * FROM gov_task_notes WHERE task_id = $1 ORDER BY created_at, note_id', [taskId])).rows.map(noteFromRow)
      return { ok: true, op, rows: { tasks: [task], steps: await stepsOfTask(db, taskId), notes }, agent_id: agentId }
    }

    // A step op names a step; add_note, message_agent and handoff_step name a card (add_note, for an agent, also the step it holds).
    const stepId = String(args.step_id ?? '')
    const named = stepId ? await stepById(db, stepId) : null
    // on the Postgres path: the edge check in agentOps reads the step's role from the n8n cache, which does not
    // hold these steps, so the verdict rule for work steps is applied here with the role this store holds.
    if (op === 'complete_step' && named) {
      const unfinished = finishRefusal(op, args, named.role)
      if (unfinished) return { ok: false, op, reason: unfinished }
    }
    const taskId = named?.task_id ?? String(args.task_id ?? '')
    const refusal = storeRefusal(ctx.registry, ctx.access, agentId, op, named)
    if (refusal) return { ok: false, op, reason: refusal }
    // The class rule: a step op checks its card. An unknown card falls through to the op's own refusal.
    const classes = classesOf(ctx.access, agentId)
    const card = ctx.tasks.find(t => t.task_id === taskId)
    if (card && !classOk(classes, card.tags)) return { ok: false, op, reason: classRefusal(agentId, classes, taskId, card.tags) }

    try {
      return await db.transaction(async (tx) => {
        const steps = taskId ? await stepsOfTask(tx, taskId) : []
        const readAt = new Map(steps.map(s => [s.step_id, s.updated_at]))
        const task = ctx.tasks.find(t => t.task_id === taskId)
        const board = { tasks: task ? [structuredClone(task)] : [], steps, notes: [], columns: ctx.columns, registry: ctx.registry, board_async: ctx.board_async }
        const before = structuredClone(steps) // the rules edit `steps` in place; the guard needs the rows as read
        const result = applyOp(board as never, op, args, { agent_id: agentId }, nowMs)
        if (!result.ok) return result
        return { ...(await persist(tx, result, before, ctx.tasks, agentId, op, nowMs, named)), agent_id: agentId } as WriteResult
      })
    } catch (e) {
      // Another writer saved the step between our read and our UPDATE: the same answer the n8n path gives a stale write.
      if (e instanceof StaleWrite) return { ok: false, op, reason: 'stale' }
      throw e
    }
  }

  /**
   * Every step and note, or with `sinceIso` only the recent ones. A step is kept when it was touched since the cutoff or is
   * still open (not ended, not cancelled), whatever its age, so live work never drops off the board. A note is kept when it is
   * recent or belongs to a card that still has a kept step, so an active card keeps its whole thread.
   */
  async function rows(sinceIso?: string): Promise<{ steps: GovTaskStep[], notes: GovTaskNote[] }> {
    const keep = `(updated_at >= $1::timestamptz OR (ended_at IS NULL AND NOT cancelled))`
    const steps = sinceIso
      ? (await db.query(`SELECT * FROM gov_task_steps WHERE ${keep} ORDER BY task_id, step_no`, [sinceIso])).rows.map(stepFromRow)
      : (await db.query('SELECT * FROM gov_task_steps ORDER BY task_id, step_no')).rows.map(stepFromRow)
    const notes = sinceIso
      ? (await db.query(`SELECT * FROM gov_task_notes WHERE created_at >= $1::timestamptz OR task_id IN (SELECT task_id FROM gov_task_steps WHERE ${keep}) ORDER BY created_at, note_id`, [sinceIso])).rows.map(noteFromRow)
      : (await db.query('SELECT * FROM gov_task_notes ORDER BY created_at, note_id')).rows.map(noteFromRow)
    return { steps, notes }
  }

  // The dispatcher polls every 5 seconds, so this reads five small columns of the few open steps, not every step and note.
  async function openSteps() {
    const res = await db.query(`SELECT assignee, role, step_state FROM gov_task_steps WHERE acked_at IS NULL AND NOT cancelled AND step_state IN ('awaiting_pull','awaiting_start')`)
    return res.rows.map(r => ({ assignee: String(r.assignee), role: String(r.role), step_state: String(r.step_state), cancelled: false, acked_at: null }))
  }

  async function prune(): Promise<{ events: number, rollups: number }> {
    // The cutoff is the store's clock, but the trigger checks against the database's now(), so the two agree on "older than 30 days"
    // only when the clocks do; a cutoff the database thinks is too young is refused as a whole, and nothing is lost.
    const cutoff = new Date(clock() - EVENT_RETENTION_DAYS * 86_400_000).toISOString()
    const events = await db.query('DELETE FROM board_events WHERE created_at < $1::timestamptz', [cutoff])
    const rollups = await db.query('DELETE FROM task_rollups WHERE applied_at IS NOT NULL AND applied_at < $1::timestamptz', [cutoff])
    return { events: events.rowCount, rollups: rollups.rowCount }
  }

  async function drainRollups(apply: RollupApply, limit = 50): Promise<Drained> {
    const nowMs = clock()
    const stamp = new Date(nowMs).toISOString()
    // The claim: the inline conditions are checked again on the row as it is when the lock is won, so a second drainer that
    // picked the same ids sees claimed_at just set and skips them. SKIP LOCKED keeps the two from waiting on each other.
    const claimed = (await db.query(
      `UPDATE task_rollups SET claimed_at = $1::timestamptz, attempts = attempts + 1
       WHERE applied_at IS NULL AND attempts < $2 AND (claimed_at IS NULL OR claimed_at < $3::timestamptz)
         AND rollup_id IN (SELECT rollup_id FROM task_rollups WHERE applied_at IS NULL AND attempts < $2 AND (claimed_at IS NULL OR claimed_at < $3::timestamptz) ORDER BY rollup_id LIMIT $4 FOR UPDATE SKIP LOCKED)
       RETURNING rollup_id, task_id, fields_json`,
      [stamp, ROLLUP_MAX_ATTEMPTS, new Date(nowMs - ROLLUP_RECLAIM_MS).toISOString(), limit]
    )).rows.sort((a, b) => Number(a.rollup_id) - Number(b.rollup_id))
    // One call per card: its rollups merged in order, later wins. Only ROLLUP_FIELDS go out, as text; updated_at never does
    // (n8n stamps its own), and a blank archived_at means null.
    const perTask = new Map<string, { ids: string[], fields: Record<string, string> }>()
    for (const r of claimed) {
      const entry = perTask.get(String(r.task_id)) ?? { ids: [], fields: {} }
      entry.ids.push(String(r.rollup_id))
      const parsed = JSON.parse(String(r.fields_json)) as Record<string, unknown>
      for (const k of ROLLUP_FIELDS) {
        if (k in parsed) entry.fields[k] = parsed[k] === null || parsed[k] === undefined ? '' : String(parsed[k])
      }
      perTask.set(String(r.task_id), entry)
    }
    const out: Drained = { applied: [], refused: [] }
    for (const [taskId, { ids, fields }] of perTask) {
      let result: WriteResult
      try {
        result = Object.keys(fields).length ? await apply(taskId, fields) : { ok: true, op: 'apply_rollup', rows: {} }
      } catch (e) {
        // A gateway failure (502, timeout) is kept on the rows and tried again on a later drain. Never the args: they are card fields.
        result = { ok: false, op: 'apply_rollup', reason: e instanceof Error ? e.message.slice(0, 200) : 'gateway error' }
      }
      if (result.ok) {
        await db.query('UPDATE task_rollups SET applied_at = $1::timestamptz WHERE rollup_id = ANY($2::bigint[])', [stamp, ids])
        const task = result.rows.tasks?.find(t => t.task_id === taskId)
        if (task) out.applied.push(task)
      } else {
        await db.query('UPDATE task_rollups SET last_error = $1 WHERE rollup_id = ANY($2::bigint[])', [result.reason.slice(0, 500), ids])
        out.refused.push({ task_id: taskId, reason: result.reason })
      }
    }
    return out
  }

  async function splitCard(args: Record<string, unknown>, caller: Caller, createCard: (fields: Record<string, string>) => Promise<WriteResult>): Promise<WriteResult> {
    const op = 'split_task'
    const ctx = await options.context()
    const nowMs = clock()
    const taskId = String(args.task_id ?? '')
    const parent = ctx.tasks.find(t => t.task_id === taskId)
    if (!parent) return { ok: false, op, reason: `no task ${taskId}` }
    // The rules run on a copy for their refusals and the children they would make; nothing is saved from this run.
    const steps = await stepsOfTask(db, taskId)
    const board = { tasks: structuredClone(ctx.tasks), steps, notes: [], columns: ctx.columns, registry: ctx.registry, board_async: ctx.board_async }
    const planned = applyOp(board as never, op, args, caller, nowMs)
    if (!planned.ok) return planned
    const children = (planned.rows.tasks ?? []).filter(t => t.task_id !== taskId)
    const made: GovTask[] = []
    for (const c of children) {
      const fields: Record<string, string> = { title: c.title, acceptance_requirements: c.acceptance_requirements, priority: c.priority, project_id: c.project_id, tags: c.tags ?? '' }
      if (c.board_id) fields.board_id = c.board_id
      for (const k of Object.keys(fields)) if (fields[k] === '') delete fields[k]
      const r = await createCard(fields)
      if (!r.ok) {
        const so_far = made.length ? ` ${made.map(t => t.task_id).join(', ')} were created before it failed; do not split again.` : ''
        return { ok: false, op, reason: `child "${c.title}" was not created: ${r.reason}.${so_far}` }
      }
      const row = r.rows.tasks?.[0]
      if (row) made.push(row)
    }
    const actor = 'person' in caller ? caller.person : caller.agent_id
    const body = `Split into ${made.map(t => t.task_id).join(', ')}. Each waits in Backlog until ${taskId} is done.`
    const note = await db.transaction(async (tx) => {
      const r = await tx.query('INSERT INTO gov_task_notes (task_id, step_id, author_id, kind, body, created_at) VALUES ($1,$2,$3,$4,$5,$6::timestamptz) RETURNING note_id', [taskId, '', actor, 'status', body, new Date(nowMs).toISOString()])
      const noteId = String(r.rows[0]!.note_id)
      await appendEvent(tx, { task_id: taskId, step_id: '', job_id: '', actor, kind: 'note', old_value: '', new_value: noteId }, nowMs)
      return { note_id: noteId, task_id: taskId, step_id: '', author_id: actor, kind: 'status' as const, body, created_at: new Date(nowMs).toISOString() }
    })
    return { ok: true, op, rows: { tasks: [parent, ...made], steps: [], notes: [note] } }
  }

  async function feed(since: number | null, limit = FEED_LIMIT): Promise<Feed> {
    const cols = 'seq, event_id, task_id, step_id, job_id, actor, kind, old_value, new_value, created_at'
    const res = since === null
      ? await db.query(`SELECT ${cols} FROM board_events WHERE created_at > $1::timestamptz ORDER BY seq LIMIT $2`, [new Date(clock() - FEED_WINDOW_MS).toISOString(), limit])
      : await db.query(`SELECT ${cols} FROM board_events WHERE seq > $1 OR created_at > $2::timestamptz ORDER BY seq LIMIT $3`, [since, new Date(clock() - FEED_OVERLAP_MS).toISOString(), limit])
    const events: FeedEvent[] = res.rows.map(r => ({ seq: Number(r.seq), event_id: String(r.event_id), task_id: String(r.task_id), step_id: String(r.step_id), job_id: String(r.job_id), actor: String(r.actor), kind: String(r.kind), old_value: String(r.old_value), new_value: String(r.new_value), created_at: iso(r.created_at)! }))
    // An empty read keeps the caller's cursor; a first read with nothing recent starts at the head so later reads are small.
    const head = events.length ? Math.max(since ?? 0, events[events.length - 1]!.seq) : since ?? Number((await db.query('SELECT COALESCE(max(seq), 0) AS m FROM board_events')).rows[0]!.m)
    const stepIds = [...new Set(events.map(e => e.step_id).filter(Boolean))]
    const noteIds = events.filter(e => e.kind === 'note').map(e => e.new_value)
    const steps = stepIds.length ? (await db.query('SELECT * FROM gov_task_steps WHERE step_id = ANY($1)', [stepIds])).rows.map(stepFromRow) : []
    const notes = noteIds.length ? (await db.query('SELECT * FROM gov_task_notes WHERE note_id = ANY($1) ORDER BY created_at, note_id', [noteIds])).rows.map(noteFromRow) : []
    return { cursor: head, events, steps, notes }
  }

  return { feed, rows, openSteps, prune, drainRollups, splitCard, handles: op => (STORE_OPS as readonly string[]).includes(op), write, handlesCard: op => (CARD_OPS as readonly string[]).includes(op), writeCard }
}
