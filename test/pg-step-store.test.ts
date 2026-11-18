// The Postgres step store on in-memory Postgres (pglite): CAS claim, sequence ids, parity with the n8n-path rules. Run with `pnpm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import type { BoardData, GovTaskStep } from '../app/types/board.ts'

const root = new URL('../', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~~/')) spec = new URL(spec.slice(3) + (spec.endsWith('.json') ? '' : '.ts'), ${JSON.stringify(root)}).href
  else if (spec.startsWith('~/')) spec = new URL('app/' + spec.slice(2) + '.ts', ${JSON.stringify(root)}).href
  const out = await next(spec, ctx)
  return out.url.endsWith('.json') ? { ...out, importAttributes: { type: 'json' } } : out
}`))
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

let mod: typeof import('../server/utils/pgStepStore.ts')
let runOp: typeof import('../app/utils/boardOps.ts').runOp
let seedBoard: typeof import('../server/utils/fixtures.ts').seedBoard
const opened: PGlite[] = []
after(async () => { for (const pg of opened) await pg.close() }) // open instances would keep the test process alive
const sql = readFileSync(new URL('../server/db/step-store.sql', import.meta.url), 'utf8')
before(async () => {
  mod = await import('../server/utils/pgStepStore.ts')
  ;({ runOp } = await import('../app/utils/boardOps.ts'))
  ;({ seedBoard } = await import('../server/utils/fixtures.ts'))
})

/** pglite behind the store's Db shape. */
function dbOf(pg: PGlite) {
  const wrap = (q: { query: PGlite['query'] }) => ({
    query: async (s: string, p?: unknown[]) => { const r = await q.query(s, p as never[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } },
    exec: async (s: string) => pg.exec(s),
    transaction: async () => { throw new Error('nested') }
  })
  return { ...wrap(pg), transaction: <T>(work: (tx: ReturnType<typeof wrap>) => Promise<T>) => pg.transaction(tx => work(wrap(tx as never))) } as never
}

const AGENT = 'agt-claude-code'
const NOW = Date.parse('2026-11-06T15:00:00Z')

/** A fresh database holding one claimable step for AGENT on the first seeded task. */
async function fresh() {
  const pg = new PGlite()
  opened.push(pg)
  const db = dbOf(pg)
  await mod.applySchema(db, sql)
  const board: BoardData = seedBoard()
  const task = board.tasks[0]!
  const step: GovTaskStep = {
    step_id: 'STP-930500', task_id: task.task_id, step_no: 1, assignee: AGENT, goal: 'g', input_ref: '', target_action: 'read', target_ticket_ref: '',
    step_state: 'awaiting_pull', stop_reason: '', verdict: '', budget_used: '', output_ref: '', output_summary: '', vera_ticket_ref: '',
    created_at: '2026-11-06T14:00:00.000Z', dispatched_at: null, ended_at: null, updated_at: '2026-11-06T14:00:00.000Z', claim_key: 'pull:STP-930500',
    lease_owner: '', lease_expires_at: null, acked_at: null, cancelled: false, claim_count: 0, last_claimed_at: null, role: 'builder', activity: '', heartbeat_at: null
  }
  await mod.importSnapshot(db, { steps: [step], notes: [] })
  // Sequence-made ids start in the synthetic 9xxxxx range.
  await db.query("SELECT setval('note_id_seq', 900000), setval('step_id_seq', GREATEST(900000, (SELECT last_value FROM step_id_seq)))")
  const registry = [...board.registry.filter(a => a.agent_id !== AGENT), { ...(board.registry[0]!), agent_id: AGENT, lifecycle_status: 'active', agent_type: 'builder' } as never]
  const context = async () => ({ tasks: board.tasks, columns: board.columns, registry, access: [] })
  const store = mod.createPgStepStore({ db, context, now: () => NOW })
  return { pg, db, store, board, step, task, registry }
}
const claimArgs = { step_id: 'STP-930500', claim_key: 'pull:STP-930500', updated_at: '2026-11-06T14:00:00.000Z' }

test('claim saves the lease with one guarded update and bumps claim_count', async () => {
  const { store, db } = await fresh()
  const r = await store.write('claim_step', claimArgs, AGENT)
  assert.equal(r.ok, true)
  const row = (await db.query('SELECT step_state, lease_owner, claim_count FROM gov_task_steps WHERE step_id = $1', ['STP-930500'])).rows[0]!
  assert.deepEqual({ ...row }, { step_state: 'dispatched', lease_owner: 'gw.gov-board-write@' + AGENT, claim_count: 1 })
  const events = (await db.query('SELECT kind, old_value, new_value FROM board_events')).rows
  assert.deepEqual(events.map(e => ({ ...e })), [{ kind: 'dispatch', old_value: 'awaiting_pull', new_value: 'dispatched' }])
})

test('two claims racing: exactly one wins', async () => {
  const { store } = await fresh()
  const [a, b] = await Promise.all([store.write('claim_step', claimArgs, AGENT), store.write('claim_step', claimArgs, AGENT)])
  assert.equal([a, b].filter(r => r.ok).length, 1)
  assert.equal([a, b].filter(r => !r.ok).length, 1)
})

test('the guarded UPDATE itself matches only one writer on the same snapshot', async () => {
  const { db } = await fresh()
  const upd = () => db.query(`UPDATE gov_task_steps SET claim_count = claim_count + 1, updated_at = now() WHERE step_id = 'STP-930500' AND updated_at = '2026-11-06T14:00:00.000Z'::timestamptz AND acked_at IS NULL`)
  const counts = [(await upd()).rowCount, (await upd()).rowCount]
  assert.deepEqual(counts, [1, 0])
})

test('a stale updated_at is refused like the n8n path', async () => {
  const { store } = await fresh()
  const r = await store.write('claim_step', { ...claimArgs, updated_at: '2026-11-06T13:00:00.000Z' }, AGENT)
  assert.deepEqual(r.ok ? null : r.reason, 'stale')
})

test('complete_step acks the step and writes a note with a sequence id', async () => {
  const { store, db } = await fresh()
  const claimed = await store.write('claim_step', claimArgs, AGENT)
  assert.ok(claimed.ok)
  const at = claimed.ok ? claimed.rows.steps![0]!.updated_at : ''
  const r = await store.write('complete_step', { step_id: 'STP-930500', step_state: 'served', updated_at: at, verdict: 'PASS', budget_used: '1 attempt', output_summary: 'done' }, AGENT)
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  const notes = (await db.query('SELECT note_id, kind FROM gov_task_notes')).rows
  assert.deepEqual(notes.map(n => String(n.note_id)), ['NTE-900001'])
  const step = (await db.query('SELECT step_state, acked_at FROM gov_task_steps WHERE step_id = $1', ['STP-930500'])).rows[0]!
  assert.equal(step.step_state, 'served')
  assert.ok(step.acked_at)
})

test('step and note ids come from sequences and continue past imported ids', async () => {
  const { db } = await fresh()
  const a = (await db.query(`INSERT INTO gov_task_steps (task_id, step_no) VALUES ('TSK-X', 1) RETURNING step_id`)).rows[0]!.step_id
  const b = (await db.query(`INSERT INTO gov_task_steps (task_id, step_no) VALUES ('TSK-X', 2) RETURNING step_id`)).rows[0]!.step_id
  assert.deepEqual([a, b], ['STP-930501', 'STP-930502']) // imported moved the sequence
})

test('concurrent inserts draw distinct, consecutive step and note ids', async () => {
  const { db } = await fresh()
  const steps = await Promise.all([1, 2, 3].map(n => db.query(`INSERT INTO gov_task_steps (task_id, step_no) VALUES ('TSK-Y', $1) RETURNING step_id`, [n])))
  const notes = await Promise.all([1, 2, 3].map(n => db.query(`INSERT INTO gov_task_notes (task_id, author_id, kind, body) VALUES ('TSK-Y','agt-a','comment',$1) RETURNING note_id`, [`n${n}`])))
  assert.deepEqual(steps.map(r => String(r.rows[0]!.step_id)).sort(), ['STP-930501', 'STP-930502', 'STP-930503'])
  assert.deepEqual(notes.map(r => String(r.rows[0]!.note_id)).sort(), ['NTE-900001', 'NTE-900002', 'NTE-900003'])
})

test('notes are append-only', async () => {
  const { db } = await fresh()
  await db.query(`INSERT INTO gov_task_notes (task_id, author_id, kind, body) VALUES ('TSK-X','agt-a','comment','hi')`)
  await assert.rejects(db.query(`UPDATE gov_task_notes SET body = 'x'`), /append-only/)
  await assert.rejects(db.query(`DELETE FROM gov_task_notes`), /append-only/)
})

test('list_claimable returns the agent claimable step, and nothing once it is claimed', async () => {
  const { store } = await fresh()
  const list = await store.write('list_claimable', {}, AGENT)
  assert.deepEqual(list.ok ? list.rows.steps!.map(s => s.step_id) : null, ['STP-930500'])
  await store.write('claim_step', claimArgs, AGENT)
  const after = await store.write('list_claimable', {}, AGENT)
  assert.deepEqual(after.ok ? after.rows.steps!.length : -1, 0)
})

test('an agent missing from the registry is refused before any write', async () => {
  const { store } = await fresh()
  const r = await store.write('claim_step', claimArgs, 'agt-ghost')
  assert.match(r.ok ? '' : r.reason, /not in gov_registry/)
})

test('parity: the store gives the same ok and reason as runOp for a scripted run', async () => {
  const { store, board, step, task } = await fresh()
  const mem = structuredClone({ ...board, steps: [...board.steps.filter(s => s.step_id !== step.step_id), step] })
  const script: [string, Record<string, unknown>][] = [
    ['claim_step', { ...claimArgs, claim_key: 'wrong' }],
    ['claim_step', claimArgs],
    ['claim_step', claimArgs],
    ['heartbeat', { step_id: 'STP-930500', activity: 'working', updated_at: 'x' }],
    ['update_step', { step_id: 'STP-930500', step_state: 'served', stop_reason: 'x', updated_at: 'x' }],
    ['add_note', { task_id: task.task_id, step_id: 'STP-930500', body: 'progress' }]
  ]
  const realNow = Date.now
  Date.now = () => NOW
  try {
    for (const [op, args] of script) {
      const a = runOp(mem as never, op, args, { agent_id: AGENT })
      const b = await store.write(op, args, AGENT)
      assert.equal(b.ok, a.ok, `${op}`)
      if (!a.ok && !b.ok) assert.equal(b.reason, a.reason, `${op} reason`)
    }
  } finally { Date.now = realNow }
})

test('a builder step served with no verdict is refused on the Postgres path (the verdict rule, role read from the store)', async () => {
  const { store } = await fresh()
  const claimed = await store.write('claim_step', claimArgs, AGENT)
  assert.equal(claimed.ok, true)
  const at = (claimed as { rows: { steps: GovTaskStep[] } }).rows.steps[0]!.updated_at
  const r = await store.write('complete_step', { step_id: 'STP-930500', step_state: 'served', updated_at: at, verdict: '', budget_used: '1 attempt', output_summary: 'done' }, AGENT)
  assert.equal(r.ok, false)
  assert.match((r as { reason: string }).reason, /needs a verdict/)
})

/** A fresh store whose context carries access rows and a tagged first card. */
async function scoped(tags: string, rows: { resource: string, grade?: string }[]) {
  const f = await fresh()
  const board = { ...f.board, tasks: f.board.tasks.map((t, i) => (i === 0 ? { ...t, tags } : t)) }
  const access = rows.map((r, i) => ({ access_id: `acc-${i}`, agent_id: AGENT, resource: r.resource, grade: r.grade ?? 'verified' })) as never[]
  const store = mod.createPgStepStore({ db: f.db, context: async () => ({ tasks: board.tasks, columns: board.columns, registry: f.registry, access }), now: () => NOW })
  return { ...f, store }
}

test('class rule: a scoped agent is refused a card of another class on every step op and get_task', async () => {
  const { store, task } = await scoped('class-catalyst', [{ resource: 'board:class:personal' }])
  for (const op of ['claim_step', 'heartbeat', 'update_step', 'complete_step'] as const) {
    const r = await store.write(op, claimArgs, AGENT)
    assert.equal(r.ok, false, op)
    assert.match((r as { reason: string }).reason, /may read or write only personal cards/, op)
  }
  const g = await store.write('get_task', { task_id: task.task_id }, AGENT)
  assert.match((g as { reason: string }).reason, /is catalyst/)
})

test('class rule: list_claimable leaves out steps on cards outside the agent classes', async () => {
  const out = await scoped('class-catalyst', [{ resource: 'board:class:personal' }])
  const none = await out.store.write('list_claimable', {}, AGENT)
  assert.equal(none.ok && none.rows.steps.length, 0)
  const inn = await scoped('class-personal', [{ resource: 'board:class:personal' }])
  const some = await inn.store.write('list_claimable', {}, AGENT)
  assert.equal(some.ok && some.rows.steps.length, 1)
})

test('class rule: a scoped agent claims on a class-general card, and an unscoped agent is unchanged', async () => {
  const general = await scoped('class-general', [{ resource: 'board:class:fj' }])
  assert.equal((await general.store.write('claim_step', claimArgs, AGENT)).ok, true)
  const open = await scoped('class-catalyst', [])
  assert.equal((await open.store.write('claim_step', claimArgs, AGENT)).ok, true)
})

test('class rule: a rejected board:class row grants nothing, so the agent is unscoped', async () => {
  const { store } = await scoped('class-catalyst', [{ resource: 'board:class:personal', grade: 'rejected' }])
  assert.equal((await store.write('claim_step', claimArgs, AGENT)).ok, true)
})

test('rows(since) keeps recent and open steps, drops old finished ones, and keeps notes of kept cards', async () => {
  const { db, store } = await fresh() // Open, updated 11/6/2026
  const ins = (task: string, no: number, upd: string, ended: string | null, cancelled = false) => db.query(
    `INSERT INTO gov_task_steps (task_id, step_no, updated_at, ended_at, cancelled) VALUES ($1,$2,$3::timestamptz,$4::timestamptz,$5)`, [task, no, upd, ended, cancelled])
  await ins('TSK-OLD', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')            // old and finished: dropped
  await ins('TSK-OLDOPEN', 1, '2026-08-01T00:00:00Z', null)                           // old but still open: kept
  await ins('TSK-OLDCANCEL', 1, '2026-08-01T00:00:00Z', null, true)                   // old and cancelled: dropped
  await ins('TSK-RECENT', 1, '2026-11-05T00:00:00Z', '2026-11-05T00:00:00Z')          // recent: kept
  const note = (task: string, at: string) => db.query(`INSERT INTO gov_task_notes (task_id, author_id, kind, body, created_at) VALUES ($1,'agt-a','comment','x',$2::timestamptz)`, [task, at])
  await note('TSK-OLD', '2026-08-01T00:00:00Z')        // old note, dropped card: dropped
  await note('TSK-OLDOPEN', '2026-08-01T00:00:00Z')    // old note on a card with an open step: kept
  await note('TSK-OLD', '2026-11-04T00:00:00Z')        // recent note: kept even if its steps are gone
  const since = '2026-10-07T00:00:00.000Z'
  const windowed = await store.rows(since)
  assert.deepEqual(windowed.steps.map(s => s.task_id).sort(), [windowed.steps.find(s => s.step_id === 'STP-930500')!.task_id, 'TSK-OLDOPEN', 'TSK-RECENT'].sort())
  assert.deepEqual(windowed.notes.map(n => n.task_id).sort(), ['TSK-OLD', 'TSK-OLDOPEN'])
  const all = await store.rows()
  assert.equal(all.steps.length, 5) // no cutoff: everything, as before
  assert.equal(all.notes.length, 3)
})
