// Cutover step 4: the rollup drain on in-memory Postgres (pglite) with a stub for the gateway's apply_rollup,
// and the apply_rollup op itself in boardOps.ts. Run with `pnpm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { ME, NOW, NOW_MS, board, reason, task, taskOf } from './board-helpers.ts'

let mod: typeof import('../server/utils/pgStepStore.ts')
let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
const opened: PGlite[] = []
after(async () => { for (const pg of opened) await pg.close() })
const sql = readFileSync(new URL('../server/db/step-store.sql', import.meta.url), 'utf8')
before(async () => {
  mod = await import('../server/utils/pgStepStore.ts')
  ;({ applyOp } = await import('../app/utils/boardOps.ts'))
})

function dbOf(pg: PGlite) {
  const wrap = (q: { query: PGlite['query'] }) => ({
    query: async (s: string, p?: unknown[]) => { const r = await q.query(s, p as never[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } },
    exec: async (s: string) => pg.exec(s),
    transaction: async () => { throw new Error('nested') }
  })
  return { ...wrap(pg), transaction: <T>(work: (tx: ReturnType<typeof wrap>) => Promise<T>) => pg.transaction(tx => work(wrap(tx as never))) } as never
}

const CLOCK = Date.parse(NOW) + 1000
/** A store over a fresh database; `clock` is a box so a test can move time forward. */
async function fresh(tasks: object[]) {
  const pg = new PGlite()
  opened.push(pg)
  const db = dbOf(pg)
  await mod.applySchema(db, sql)
  const b = board(tasks)
  const clock = { now: CLOCK }
  const store = mod.createPgStepStore({ db, context: async () => ({ tasks: b.tasks as never, columns: b.columns as never, registry: b.registry as never, access: [] }), now: () => clock.now })
  return { db, store, clock }
}
const q = async (db: { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, s: string, p?: unknown[]) => (await db.query(s, p)).rows.map(r => ({ ...r }))

/** A stub gateway: records each call and answers ok with the card as n8n would now hold it. */
function gateway() {
  const calls: { task_id: string, fields: Record<string, string> }[] = []
  const apply = async (task_id: string, fields: Record<string, string>) => {
    calls.push({ task_id, fields })
    return { ok: true as const, op: 'apply_rollup', rows: { tasks: [task({ task_id, stage: fields.stage, work_state: fields.work_state, updated_by: 'n8n' })] } }
  }
  return { calls, apply }
}

test('a store write queues a rollup; the drain sends ROLLUP_FIELDS as text, never updated_at, and marks the row applied', async () => {
  const { store, db } = await fresh([task()])
  assert.equal((await store.writeCard('start_task', { task_id: 'TSK-1', updated_at: NOW })).ok, true)
  const gw = gateway()
  const drained = await store.drainRollups(gw.apply)
  assert.equal(gw.calls.length, 1)
  assert.equal(gw.calls[0]!.task_id, 'TSK-1')
  assert.deepEqual(gw.calls[0]!.fields, { stage: 'build', work_state: 'awaiting_start', current_step: '1', steps_total: '1', updated_by: 'person:meshach (board)' })
  assert.equal('updated_at' in gw.calls[0]!.fields, false)
  assert.deepEqual(drained.applied.map(t => [t.task_id, (t as unknown as { updated_by: string }).updated_by]), [['TSK-1', 'n8n']])
  assert.deepEqual(drained.refused, [])
  const rows = await q(db, 'SELECT attempts, last_error, applied_at IS NOT NULL AS applied FROM task_rollups')
  assert.deepEqual(rows, [{ attempts: 1, last_error: '', applied: true }])
  // Nothing left: a second drain costs no call.
  await store.drainRollups(gw.apply)
  assert.equal(gw.calls.length, 1)
})

test('pending rollups for one card are merged into one call, later wins, in rollup order', async () => {
  const { store, db } = await fresh([task()])
  await db.query('INSERT INTO task_rollups (task_id, fields_json) VALUES ($1,$2), ($1,$3), ($4,$5)',
    ['TSK-1', JSON.stringify({ stage: 'build', work_state: 'awaiting_start', updated_at: NOW }), JSON.stringify({ work_state: 'in_progress', title: 'never sent' }), 'TSK-2', JSON.stringify({ archived_at: null })])
  const gw = gateway()
  await store.drainRollups(gw.apply)
  assert.deepEqual(gw.calls, [
    { task_id: 'TSK-1', fields: { stage: 'build', work_state: 'in_progress' } },
    { task_id: 'TSK-2', fields: { archived_at: '' } }
  ])
  assert.equal((await q(db, 'SELECT 1 FROM task_rollups WHERE applied_at IS NULL')).length, 0)
})

test('a refusal keeps the row with the reason and attempt count; it is retried once its claim is old, and parked at the cap', async () => {
  const { store, db, clock } = await fresh([task()])
  await store.writeCard('start_task', { task_id: 'TSK-1', updated_at: NOW })
  let answer: 'refuse' | 'throw' | 'ok' = 'refuse'
  let calls = 0
  const apply = async (task_id: string, fields: Record<string, string>) => {
    calls += 1
    if (answer === 'throw') throw new Error('HTTP 502: gateway down')
    if (answer === 'refuse') return { ok: false as const, op: 'apply_rollup', reason: 'op not live' }
    return { ok: true as const, op: 'apply_rollup', rows: { tasks: [task({ task_id, ...fields })] } }
  }
  const first = await store.drainRollups(apply)
  assert.deepEqual(first.refused, [{ task_id: 'TSK-1', reason: 'op not live' }])
  assert.deepEqual(await q(db, 'SELECT attempts, last_error, applied_at FROM task_rollups'), [{ attempts: 1, last_error: 'op not live', applied_at: null }])
  // Claimed a moment ago: another drain inside the reclaim window leaves it alone (a crashed drainer may still own it).
  await store.drainRollups(apply)
  assert.equal(calls, 1)
  // Past the window it is claimed again; a thrown gateway error is kept like a refusal.
  clock.now += mod.ROLLUP_RECLAIM_MS + 1
  answer = 'throw'
  await store.drainRollups(apply)
  assert.equal(calls, 2)
  assert.deepEqual(await q(db, 'SELECT attempts, last_error FROM task_rollups'), [{ attempts: 2, last_error: 'HTTP 502: gateway down' }])
  // At the cap the row is parked: no more runs are spent on it.
  await db.query('UPDATE task_rollups SET attempts = $1', [mod.ROLLUP_MAX_ATTEMPTS])
  clock.now += mod.ROLLUP_RECLAIM_MS + 1
  answer = 'ok'
  await store.drainRollups(apply)
  assert.equal(calls, 2)
  // Below the cap it goes through.
  await db.query('UPDATE task_rollups SET attempts = $1', [mod.ROLLUP_MAX_ATTEMPTS - 1])
  const last = await store.drainRollups(apply)
  assert.equal(calls, 3)
  assert.equal(last.applied.length, 1)
  assert.deepEqual(await q(db, 'SELECT attempts, applied_at IS NOT NULL AS applied FROM task_rollups'), [{ attempts: mod.ROLLUP_MAX_ATTEMPTS, applied: true }])
})

test('two drains at once spend one call: the claim is a guarded update', async () => {
  const { store } = await fresh([task()])
  await store.writeCard('start_task', { task_id: 'TSK-1', updated_at: NOW })
  const gw = gateway()
  await Promise.all([store.drainRollups(gw.apply), store.drainRollups(gw.apply)])
  assert.equal(gw.calls.length, 1)
})

// ---------- The op the drain calls, as fixtures mode and the reference store run it ----------

const run = (b: ReturnType<typeof board>, args: object, caller: object = ME) => applyOp(b, 'apply_rollup', args as never, caller as never, NOW_MS)

test('apply_rollup writes only the fields sent, turns counts back into numbers, and needs no updated_at', () => {
  const b = board([task({ title: 'Keep me' })])
  const r = run(b, { task_id: 'TSK-1', stage: 'build', work_state: 'awaiting_start', current_step: '2', steps_total: '2', archived_at: '' })
  assert.equal(r.ok, true, reason(r))
  const t = taskOf(b) as unknown as Record<string, unknown>
  assert.equal(t.stage, 'build')
  assert.equal(t.work_state, 'awaiting_start')
  assert.equal(t.current_step, 2)
  assert.equal(t.steps_total, 2)
  assert.equal(t.archived_at, null)
  assert.equal(t.title, 'Keep me')
  assert.equal(t.updated_by, 'agt-orchestrator (board rollup)')
  assert.equal(r.ok && r.rows.tasks![0]!.task_id, 'TSK-1')
})

test('apply_rollup refuses an agent, an unknown card, a card field outside ROLLUP_FIELDS, a bad stage and a bad count', () => {
  const b = board([task()])
  assert.match(reason(run(b, { task_id: 'TSK-1', stage: 'build' }, { agent_id: 'agt-b' })), /person:meshach only/)
  assert.match(reason(run(b, { task_id: 'TSK-9', stage: 'build' })), /no task TSK-9/)
  assert.match(reason(run(b, { task_id: 'TSK-1', title: 'x' })), /does not take title/)
  assert.match(reason(run(b, { task_id: 'TSK-1', stage: 'later' })), /stage later is not one of/)
  assert.match(reason(run(b, { task_id: 'TSK-1', current_step: 'two' })), /whole number/)
  assert.match(reason(run(b, { task_id: 'TSK-1' })), /no changes/)
})

// ---------- Retention: events and applied rollups older than 30 days ----------

test('prune deletes events and applied rollups older than the retention window and refuses younger events', async () => {
  const { store, db, clock } = await fresh([task()])
  await store.writeCard('start_task', { task_id: 'TSK-1', updated_at: NOW }) // one event, one rollup
  await store.drainRollups(gateway().apply) // the rollup is applied
  const day = 86_400_000
  const old = new Date(Date.now() - (mod.EVENT_RETENTION_DAYS + 1) * day).toISOString()
  // Rows the store wrote a month ago, as the table would hold them. The trigger compares against the database's now(), so
  // the old rows must really be older than 30 days of wall-clock time.
  await db.query("INSERT INTO board_events (task_id, step_id, job_id, actor, kind, old_value, new_value, created_at) VALUES ('TSK-0', '', '', 'x', 'note', '', '', $1::timestamptz)", [old])
  await db.query("INSERT INTO task_rollups (task_id, fields_json, created_at, applied_at) VALUES ('TSK-0', '{}', $1::timestamptz, $1::timestamptz), ('TSK-0', '{}', $1::timestamptz, NULL)", [old])
  assert.equal((await q(db, 'SELECT 1 FROM board_events')).length, 2)
  // A prune whose cutoff the database thinks is too young is refused as a whole by the trigger: nothing is lost.
  clock.now = Date.now() + 365 * day
  await assert.rejects(store.prune(), /keeps 30 days/)
  assert.equal((await q(db, 'SELECT 1 FROM board_events')).length, 2)
  // A sane clock prunes only the old rows: the recent event, the pending rollup and every step and note stay.
  clock.now = Date.now()
  const gone = await store.prune()
  assert.deepEqual(gone, { events: 1, rollups: 1 })
  assert.deepEqual((await q(db, 'SELECT task_id FROM board_events')).map(r => r.task_id), ['TSK-1'])
  assert.deepEqual((await q(db, 'SELECT task_id, applied_at IS NULL AS pending FROM task_rollups ORDER BY rollup_id')).map(r => [r.task_id, r.pending]), [['TSK-1', false], ['TSK-0', true]])
  assert.equal((await q(db, 'SELECT 1 FROM gov_task_steps')).length, 1)
  // An UPDATE is still refused: events are append-only while they live.
  await assert.rejects(db.query("UPDATE board_events SET actor = 'y'"), /append-only/)
})
