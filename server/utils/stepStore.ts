// Glue between the agent ops and the Postgres step store (pgStepStore.ts), behind NUXT_STEP_STORE=postgres.
// Off by default: with the flag unset nothing here runs and every op takes the n8n path.
// The connection comes from NUXT_STEP_STORE_URL, a name only in the repo (.env locally, Vercel env vars when deployed).
// Cutover steps 4 to 6 live here too: the board rows with Postgres steps
// and notes laid over the n8n read (boardRows), the rollup drain that writes computed card changes back to gov_tasks
// (drainRollups), and the two writes that make a card in n8n and its steps here (createViaStepStore, split_task).
import { waitUntil } from '@vercel/functions'
import type { BoardData, GovTask, WriteResult } from '~~/app/types/board'
import { boardOwner } from '~~/app/types/board'
import { CARD_OPS, STORE_OPS } from '~~/shared/agentAccess'
import { createPgStepStore, EVENT_RETENTION_DAYS, type Db, type PgStepStore, type StepContext } from './pgStepStore'
import { openStepDb } from './stepStoreDb'
import { readsNeedClassRule, unscopedAgentList } from './classScope'
import { announceBoardChange, changesBoard } from './boardEvents'

export const stepStoreOn = (): boolean => useRuntimeConfig().stepStore === 'postgres'
export const stepStoreHandlesCard = (op: string): boolean => (CARD_OPS as readonly string[]).includes(op)
export const stepStoreHandles = (op: string): boolean => (STORE_OPS as readonly string[]).includes(op)

let store: Promise<PgStepStore> | null = null

/** tasks, columns, registry and gov_access come from the reads n8n already serves; they are not copied into Postgres. */
async function context(): Promise<StepContext> {
  const board = await boardStore().read()
  const registry = await boardStore().readRegistry()
  return { tasks: board.tasks, columns: board.columns, registry: board.registry, access: registry.access, board_async: board.board_async }
}

let dbOpen: Promise<Db> | null = null

/** The step store's database connection, opened once. The error log (errorLog.ts) shares it. */
export function stepDb(): Promise<Db> {
  dbOpen ??= openStepDb(String(useRuntimeConfig().stepStoreUrl), String(useRuntimeConfig().stepStoreWsUrl || ''))
  return dbOpen
}

function stepStore(): Promise<PgStepStore> {
  store ??= stepDb().then((db: Db) => createPgStepStore({ db, context }))
  return store
}

/**
 * The board's rows for anything that looks at steps or notes (cutover step 6): the n8n read for cards, columns and the
 * registry, with the steps and notes Postgres holds laid over it once the flag is on. With the flag off it is the n8n read.
 * Not part of the BoardStore adapter on purpose: the store's own context() reads boardStore() and must not come back here.
 */
export async function boardRows(fresh = false): Promise<BoardData> {
  const data = await boardStore().read(fresh)
  if (!stepStoreOn()) return data
  const { steps, notes } = await pgRows(fresh)
  return { ...data, steps, notes }
}

// Every board read used to download all steps and notes from Postgres (Neon data transfer). The rows are now kept in the shared
// Runtime Cache for ROWS_TTL_SECONDS and dropped by every write (dropRowsCache), so a write is never hidden for more than a
// moment; the page's event feed (replays 10 minutes) corrects a snapshot that was a few seconds old. Refresh (`fresh`) skips it.
const ROWS_KEY = 'pg-step-rows'
const ROWS_TTL_SECONDS = 30
const ROWS_WINDOW_DAYS = 30 // a board read lays only steps and notes from this window (open steps stay whatever their age; see pgStepStore rows)
const MAX_ROWS_BYTES = 1_800_000 // a larger copy is not shared; the next read goes to Postgres
type PgRows = { steps: BoardData['steps'], notes: BoardData['notes'] }

async function pgRows(fresh: boolean): Promise<PgRows> {
  const hit = fresh ? null : await cacheGet<PgRows>(ROWS_KEY)
  if (hit && Array.isArray(hit.steps) && Array.isArray(hit.notes)) return hit
  const since = new Date(Date.now() - ROWS_WINDOW_DAYS * 86_400_000).toISOString()
  const rows = await (await stepStore()).rows(since)
  if (JSON.stringify(rows).length <= MAX_ROWS_BYTES) await cacheSet(ROWS_KEY, rows, ROWS_TTL_SECONDS)
  return rows
}

/** Drops the shared copy of the rows. Called after anything that writes steps or notes. */
export const dropRowsCache = (): Promise<void> => cacheDelete(ROWS_KEY)

/** The open steps for the dispatcher's poll. With the flag on it reads only those rows, not every step and note (Neon data transfer). */
export async function openStepRows() {
  if (stepStoreOn()) return (await stepStore()).openSteps()
  return (await boardStore().read()).steps
}

/** Events after `since` (null: the recent window) with the current rows they name, for GET /api/board/feed. */
export async function readStepFeed(since: number | null) {
  return (await stepStore()).feed(since)
}

/**
 * Cutover step 4: writes the card changes the store queued in task_rollups to gov_tasks through the gateway's apply_rollup,
 * one run per card. Called after every store write and on a board read, so a rollup a failed run left behind is retried.
 * Until NUXT_BOARD_LIVE_OPS names apply_rollup the gateway would refuse it, so the drain does nothing and spends no attempts.
 * Returns the cards as n8n now holds them, so a write's answer can carry them.
 */
export async function drainRollups(): Promise<GovTask[]> {
  if (!stepStoreOn() || !boardStore().capabilities().liveOps.includes('apply_rollup')) return []
  const drained = await (await stepStore()).drainRollups((taskId, fields) => boardStore().write('apply_rollup', { task_id: taskId, ...fields }, { person: boardOwner() }))
  for (const r of drained.refused) {
    console.warn(`[step-store] rollup for ${r.task_id} not applied: ${r.reason.slice(0, 120)}`)
    waitUntil(logError({ source: 'rollup', message: `rollup for ${r.task_id} not applied: ${r.reason}`, task_id: r.task_id }))
  }
  if (drained.applied.length) announceBoardChange()
  return drained.applied
}

type Written = Extract<WriteResult, { ok: true }>

/** A write's answer with the cards the drain just wrote replacing the ones the rules computed. */
function withDrained(result: Written, applied: GovTask[]): Written {
  if (!applied.length) return result
  const tasks = (result.rows.tasks ?? []).map(t => applied.find(a => a.task_id === t.task_id) ?? t)
  for (const a of applied) if (!tasks.some(t => t.task_id === a.task_id)) tasks.push(a)
  return { ...result, rows: { ...result.rows, tasks } }
}

/**
 * One step op for an agent, answered from Postgres. `agentId` is already resolved (the cached whoami).
 * Class-scoped callers are refused: the class rule runs in n8n and the step store does not copy it yet.
 */
export async function runViaStepStore(op: string, args: Record<string, unknown>, agentId: string): Promise<Record<string, unknown>> {
  if (readsNeedClassRule(agentId, unscopedAgentList(useRuntimeConfig().unscopedAgents))) {
    return { ok: false, op, reason: 'class-scoped callers are not served by the step store yet' }
  }
  const written = await (await stepStore()).write(op, args, agentId)
  if (!written.ok) return { ok: false, op, reason: written.reason }
  // The push stream (boardEvents.ts) is told as it is for n8n writes, since this path skips boardStore().write.
  // Any write drops the shared rows, even one the push stream ignores (handoff_step); reads leave them alone.
  if (op !== 'list_claimable' && op !== 'get_task') await dropRowsCache()
  if (changesBoard(op, true)) announceBoardChange()
  const result = op === 'list_claimable' || op === 'get_task' ? written : withDrained(written, await drainRollups())
  const { rows } = result
  if (op === 'list_claimable') {
    const tasks = rows.tasks ?? []
    return { ok: true, op, agent_id: agentId, steps: (rows.steps ?? []).map(s => ({ ...s, task_title: tasks.find(t => t.task_id === s.task_id)?.title ?? '', task_stage: tasks.find(t => t.task_id === s.task_id)?.stage ?? '' })) }
  }
  if (op === 'get_task') return { ok: true, op, task: rows.tasks?.[0], steps: [...(rows.steps ?? [])].sort((a, b) => a.step_no - b.step_no), notes: rows.notes ?? [] }
  return result as unknown as Record<string, unknown>
}

/**
 * An agent's create_task on path B (cutover step 5): the card is made in n8n with the agent's own token, as today, then the
 * hand-off note and the orchestrator's chat step are made here (handoff_step), never in gov_task_steps. The answer carries all three rows.
 * At cutover plan_board.js must stop inserting that chat step itself.
 */
export async function createViaStepStore(args: Record<string, unknown>, token: string, agentId: string): Promise<Record<string, unknown>> {
  const made = await boardStore().write('create_task', args, { token })
  if (!made.ok) return { ok: false, op: 'create_task', reason: made.reason }
  const task = made.rows.tasks?.[0]
  if (!task) return made as unknown as Record<string, unknown>
  const handoff = await runViaStepStore('handoff_step', { task_id: task.task_id, ...(args.context === undefined ? {} : { context: String(args.context) }) }, agentId)
  if (handoff.ok !== true) return { ok: false, op: 'create_task', reason: `${task.task_id} was created, but its hand-off step was not: ${String(handoff.reason)}` }
  const rows = (handoff as { rows?: { steps?: unknown[], notes?: unknown[] } }).rows ?? {}
  return { ok: true, op: 'create_task', rows: { tasks: made.rows.tasks ?? [], steps: rows.steps ?? [], notes: rows.notes ?? [] } }
}

/**
 * An agent's split_task on path B (the architect's fan-out): the rules check the agent holds the card's open
 * architect step, then each child is made in n8n with the agent's own token and the parent's note is written here.
 */
export async function splitViaStepStore(args: Record<string, unknown>, token: string, agentId: string): Promise<Record<string, unknown>> {
  const written = await (await stepStore()).splitCard(args, { agent_id: agentId }, fields => boardStore().write('create_task', fields, { token }))
  if (!written.ok) return { ok: false, op: 'split_task', reason: written.reason }
  await dropRowsCache()
  announceBoardChange()
  return { ...written, agent_id: agentId } as unknown as Record<string, unknown>
}

// Retention (the  handoff's 30-day job): events and applied rollups older than EVENT_RETENTION_DAYS are deleted on a
// board read, at most once an hour per function instance. Steps and notes are never pruned.
const PRUNE_EVERY_MS = 60 * 60_000
let lastPrune = 0

/** Prunes old events and applied rollups when the hour is up; otherwise nothing. Safe to call on every board read. */
export async function pruneStepStore(): Promise<void> {
  if (!stepStoreOn() || Date.now() - lastPrune < PRUNE_EVERY_MS) return
  lastPrune = Date.now()
  const gone = await (await stepStore()).prune()
  await pruneErrorLog()
  if (gone.events || gone.rollups) console.info(`[step-store] pruned ${gone.events} events and ${gone.rollups} applied rollups older than ${EVENT_RETENTION_DAYS} days`)
}

/**
 * One owner card op (CARD_OPS) answered from Postgres by app/utils/boardOps.ts, the single copy of the column rules.
 * Card changes it computes are queued in task_rollups and drained at once; the push stream is told as for any board write.
 * split_task is the exception: its children are cards, made in n8n one by one, and only the parent's note is written here.
 */
export async function runCardViaStepStore(op: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const s = await stepStore()
  const owner = { person: boardOwner() }
  const written = op === 'split_task'
    ? await s.splitCard(args, owner, fields => boardStore().write('create_task', fields, owner))
    : await s.writeCard(op, args)
  if (!written.ok) return written as unknown as Record<string, unknown>
  await dropRowsCache()
  if (changesBoard(op, true)) announceBoardChange()
  return withDrained(written, await drainRollups()) as unknown as Record<string, unknown>
}
