// The live event feed on in-memory Postgres (pglite): an event per step-store write, the since-id read, and the client merge. Run with `pnpm test`.
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
const { mergeFeed, FEED_POLL_MS } = await import('../app/utils/eventFeed.ts')

type Fresh = Awaited<ReturnType<typeof fresh>>
/** Runs a step op and returns the step as saved (its updated_at is the token for the next op). */
async function run(f: Fresh, op: string, args: Record<string, unknown>) {
  const r = await f.store.write(op, args, AGENT)
  assert.ok(r.ok, r.ok ? '' : `${op}: ${r.reason}`)
  return r.rows.steps?.[0]
}
/** A feed reader whose clock is a minute later, so the overlap window (FEED_OVERLAP_MS) holds nothing and only seq decides. */
const later = (f: Fresh) => mod.createPgStepStore({ db: f.db, context: async () => ({ tasks: [], columns: [], registry: [], access: [] }), now: () => NOW + 60_000 })
const events = async (f: Fresh) => (await f.db.query('SELECT seq, kind, step_id, new_value FROM board_events ORDER BY seq')).rows.map(r => ({ seq: Number(r.seq), kind: String(r.kind), step_id: String(r.step_id), new_value: String(r.new_value) }))

test('appends an event on claim_step', async () => {
  const f = await fresh()
  assert.equal((await events(f)).length, 0)
  await run(f, 'claim_step', claimArgs)
  const all = await events(f)
  assert.deepEqual(all.map(e => [e.kind, e.new_value]), [['dispatch', 'dispatched']]) // exactly one new row
  assert.ok(all[0]!.seq > 0)
})

test('appends an event on heartbeat', async () => {
  const f = await fresh()
  const st = await run(f, 'claim_step', claimArgs)
  await run(f, 'heartbeat', { step_id: 'STP-930500', activity: 'reading code', updated_at: st!.updated_at })
  const all = await events(f)
  assert.deepEqual(all.map(e => [e.kind, e.new_value]), [['dispatch', 'dispatched'], ['heartbeat', 'reading code']])
  assert.ok(all[1]!.seq > all[0]!.seq)
})

test('appends an event on add_note, naming the note', async () => {
  const f = await fresh()
  await run(f, 'claim_step', claimArgs)
  const note = await f.store.write('add_note', { task_id: f.task.task_id, step_id: 'STP-930500', body: 'progress' }, AGENT)
  assert.ok(note.ok, note.ok ? '' : note.reason)
  const all = await events(f)
  assert.deepEqual(all.map(e => [e.kind, e.new_value]), [['dispatch', 'dispatched'], ['note', 'NTE-900001']])
  assert.ok(all[1]!.seq > all[0]!.seq)
})

test('appends an event on update_step', async () => {
  const f = await fresh()
  const st = await run(f, 'claim_step', claimArgs)
  await run(f, 'update_step', { step_id: 'STP-930500', step_state: 'needs_input', stop_reason: 'question', updated_at: st!.updated_at })
  const all = await events(f)
  assert.deepEqual(all.map(e => [e.kind, e.new_value]), [['dispatch', 'dispatched'], ['status_change', 'needs_input']])
  assert.ok(all[1]!.seq > all[0]!.seq)
})

test('appends an event on complete_step', async () => {
  const f = await fresh()
  const st = await run(f, 'claim_step', claimArgs)
  const before = await events(f)
  await run(f, 'complete_step', { step_id: 'STP-930500', step_state: 'served', updated_at: st!.updated_at, verdict: 'PASS', budget_used: '1 attempt', output_summary: 'done' })
  const added = (await events(f)).slice(before.length)
  // Exactly one `complete` row, with a higher seq; the summary note complete_step writes is its own `note` row after it.
  const complete = added.filter(e => e.kind === 'complete')
  assert.equal(complete.length, 1)
  assert.equal(complete[0]!.new_value, 'served')
  assert.ok(complete[0]!.seq > before.at(-1)!.seq)
  assert.deepEqual(added.map(e => e.kind), ['complete', 'note'])
})

test('a refused write appends no event', async () => {
  const f = await fresh()
  const r = await f.store.write('claim_step', { ...claimArgs, updated_at: '2026-11-06T13:00:00.000Z' }, AGENT)
  assert.equal(r.ok, false)
  assert.equal((await events(f)).length, 0)
})

test('since-id read returns only later events, with the rows they name, and keeps the cursor when empty', async () => {
  const f = await fresh()
  let st = await run(f, 'claim_step', claimArgs)
  const first = await later(f).feed(0)
  assert.equal(first.events.length, 1)
  assert.equal(first.cursor, first.events[0]!.seq)
  assert.deepEqual(first.steps.map(s => s.step_state), ['dispatched'])
  const empty = await later(f).feed(first.cursor)
  assert.deepEqual([empty.events.length, empty.steps.length, empty.cursor], [0, 0, first.cursor])
  await run(f, 'heartbeat', { step_id: 'STP-930500', activity: 'busy', updated_at: st!.updated_at })
  await f.store.write('add_note', { task_id: f.task.task_id, step_id: 'STP-930500', body: 'hi' }, AGENT)
  const next = await later(f).feed(first.cursor)
  assert.deepEqual(next.events.map(e => e.kind), ['heartbeat', 'note'])
  assert.equal(next.cursor, next.events.at(-1)!.seq)
  assert.deepEqual(next.notes.map(n => n.body), ['hi'])
  assert.equal(next.steps[0]!.activity, 'busy')
  assert.ok(next.events.every(e => e.seq > first.cursor))
})

test('since-id read without a cursor replays the recent window, and the limit pages by cursor', async () => {
  const f = await fresh()
  const st = await run(f, 'claim_step', claimArgs)
  await run(f, 'heartbeat', { step_id: 'STP-930500', activity: 'a', updated_at: st!.updated_at })
  const replay = await later(f).feed(null)
  assert.equal(replay.events.length, 2)
  const page = await later(f).feed(0, 1)
  assert.equal(page.events.length, 1)
  assert.equal((await later(f).feed(page.cursor, 1)).events[0]!.kind, 'heartbeat')
  // A database with no events starts the cursor at 0.
  assert.equal((await (await fresh()).store.feed(null)).cursor, 0)
})

test('since-id read overlap: a young event at or below the cursor is still returned and the cursor does not move back', async () => {
  const f = await fresh()
  const st = await run(f, 'claim_step', claimArgs)
  await run(f, 'heartbeat', { step_id: 'STP-930500', activity: 'a', updated_at: st!.updated_at })
  const [first, second] = (await events(f)).map(e => e.seq) as [number, number]
  // A reader already at the later seq (its commit landed first) still gets the earlier, younger-than-30s event.
  const r = await f.store.feed(second)
  assert.deepEqual(r.events.map(e => e.seq), [first, second])
  assert.equal(r.cursor, second)
  // Once the events are older than the overlap, the same cursor returns nothing.
  const old = await later(f).feed(second)
  assert.deepEqual([old.events.length, old.cursor], [0, second])
})

test('merge: newer step replaces, older is ignored, unknown is added, notes append once, replay changes nothing', () => {
  const mk = (id: string, at: string, state = 'dispatched') => ({ step_id: id, updated_at: at, step_state: state }) as never
  const note = (id: string) => ({ note_id: id, task_id: 'T', step_id: 'S', author_id: 'a', kind: 'comment', body: 'b', created_at: '2026-11-06T15:00:00.000Z' }) as never
  const before = { steps: [mk('S1', '2026-11-06T15:00:00.000Z'), mk('S2', '2026-11-06T15:00:00.000Z')], notes: [note('N1')] }
  const reply = { steps: [mk('S1', '2026-11-06T15:00:05.000Z', 'served'), mk('S2', '2026-11-06T14:00:00.000Z', 'failed'), mk('S3', '2026-11-06T15:00:01.000Z')], notes: [note('N1'), note('N2')] }
  const once = mergeFeed(before.steps, before.notes, reply)
  assert.deepEqual(once.steps.map(s => [s.step_id, s.step_state]), [['S1', 'served'], ['S2', 'dispatched'], ['S3', 'dispatched']])
  assert.deepEqual(once.notes.map(n => n.note_id), ['N1', 'N2'])
  assert.deepEqual(mergeFeed(once.steps, once.notes, reply), once)
  assert.equal(before.steps[0]!.step_state, 'dispatched') // inputs are not changed
})

test('a finished step shows within the 5 second budget: complete_step, feed read, merge', async () => {
  assert.ok(FEED_POLL_MS >= 2000 && FEED_POLL_MS <= 5000)
  const f = await fresh()
  const screen = { steps: [f.step], notes: [] as never[] }
  const head = (await f.store.feed(null)).cursor
  const st = await run(f, 'claim_step', claimArgs)
  const t0 = performance.now()
  await run(f, 'complete_step', { step_id: 'STP-930500', step_state: 'served', updated_at: st!.updated_at, verdict: 'PASS', budget_used: '1 attempt', output_summary: 'done' })
  const merged = mergeFeed(screen.steps, screen.notes, await f.store.feed(head))
  const ms = performance.now() - t0
  assert.equal(merged.steps.find(s => s.step_id === 'STP-930500')!.step_state, 'served')
  // The poll waits at most FEED_POLL_MS; the write-to-merge work itself must leave room in the 5 s budget.
  assert.ok(FEED_POLL_MS + ms < 5000, `write to merge took ${ms.toFixed(0)} ms`)
})
