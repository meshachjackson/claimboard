// Owner card ops answered from Postgres (pglite) by the same boardOps.ts rules. New steps take sequence ids,
// placeholder ids are rewritten, card changes are queued in task_rollups, and a stale card is refused. Run with `pnpm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { NOW, board, step, task } from './board-helpers.ts'

let mod: typeof import('../server/utils/pgStepStore.ts')
const opened: PGlite[] = []
after(async () => { for (const pg of opened) await pg.close() })
const sql = readFileSync(new URL('../server/db/step-store.sql', import.meta.url), 'utf8')
before(async () => { mod = await import('../server/utils/pgStepStore.ts') })

function dbOf(pg: PGlite) {
  const wrap = (q: { query: PGlite['query'] }) => ({
    query: async (s: string, p?: unknown[]) => { const r = await q.query(s, p as never[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } },
    exec: async (s: string) => pg.exec(s),
    transaction: async () => { throw new Error('nested') }
  })
  return { ...wrap(pg), transaction: <T>(work: (tx: ReturnType<typeof wrap>) => Promise<T>) => pg.transaction(tx => work(wrap(tx as never))) } as never
}

const CLOCK = Date.parse(NOW) + 1000
async function fresh(tasks: object[], steps: object[] = []) {
  const pg = new PGlite()
  opened.push(pg)
  const db = dbOf(pg)
  await mod.applySchema(db, sql)
  await mod.importSnapshot(db, { steps: steps as never, notes: [] })
  // Sequence-made ids start in the synthetic 9xxxxx range.
  await db.query("SELECT setval('note_id_seq', 900000), setval('step_id_seq', GREATEST(900000, (SELECT last_value FROM step_id_seq)))")
  const b = board(tasks, steps)
  const store = mod.createPgStepStore({ db, context: async () => ({ tasks: b.tasks as never, columns: b.columns as never, registry: b.registry as never, access: [] }), now: () => CLOCK })
  return { db, store }
}
const q = async (db: { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, s: string, p?: unknown[]) => (await db.query(s, p)).rows.map(r => ({ ...r }))

test('start_task on the store inserts the builder step with a sequence id and queues the card change', async () => {
  const { store, db } = await fresh([task()])
  const r = await store.writeCard('start_task', { task_id: 'TSK-1', updated_at: NOW })
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  const steps = await q(db, 'SELECT step_id, role, assignee, step_state FROM gov_task_steps')
  assert.deepEqual(steps, [{ step_id: 'STP-900001', role: 'builder', assignee: 'pool:builder', step_state: 'awaiting_pull' }])
  assert.equal(r.ok && r.rows.steps![0]!.step_id, 'STP-900001')
  const rollups = await q(db, 'SELECT task_id, fields_json FROM task_rollups')
  assert.equal(rollups.length, 1)
  assert.equal(JSON.parse(String(rollups[0]!.fields_json)).stage, 'build')
})

test('the refusal reasons are the rules\' own: start on a running card, and a stale card', async () => {
  const { store } = await fresh([task({ stage: 'build', work_state: 'in_progress' })], [step({ step_state: 'dispatched' })])
  const running = await store.writeCard('start_task', { task_id: 'TSK-1', updated_at: NOW })
  assert.match(running.ok ? '' : running.reason, /already running/)
  const stale = await store.writeCard('start_task', { task_id: 'TSK-1', updated_at: '2020-01-01T00:00:00.000Z' })
  assert.equal(stale.ok ? '' : stale.reason, 'stale')
})

test('send_back rewrites the placeholder note id into the new step input_ref and the note keeps a sequence id', async () => {
  const { store, db } = await fresh([task({ stage: 'review', work_state: 'verifying', internal_verification: 'pass (PASS, STP-1)' })], [step({ step_state: 'served', verdict: 'PASS', acked_at: NOW })])
  const r = await store.writeCard('send_back', { task_id: 'TSK-1', body: 'Add a test', updated_at: NOW })
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  const notes = await q(db, 'SELECT note_id, kind FROM gov_task_notes')
  assert.deepEqual(notes.map(n => n.note_id), ['NTE-900001'])
  const fresh2 = (await q(db, `SELECT step_id, input_ref, goal FROM gov_task_steps WHERE step_id <> 'STP-1'`))[0]!
  assert.equal(fresh2.input_ref, 'NTE-900001')
  assert.match(String(fresh2.goal), /Sent back: Add a test/)
})

test('assign cancels the held step (a compare-and-swap update) and inserts the new owner\'s step', async () => {
  const { store, db } = await fresh([task({ stage: 'build', work_state: 'awaiting_start', assignee: 'agt-b' })], [step()])
  const r = await store.writeCard('assign', { task_id: 'TSK-1', assignee: 'agt-c', updated_at: NOW })
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  const rows = await q(db, 'SELECT step_id, assignee, cancelled FROM gov_task_steps ORDER BY step_no')
  assert.deepEqual(rows.map(x => [x.assignee, x.cancelled]), [['agt-b', true], ['agt-c', false]])
  assert.equal(rows[1]!.step_id, 'STP-900001')
})

test('Done on the parent starts the waiting child in Postgres in the same write', async () => {
  const parent = task({ stage: 'review', work_state: 'verifying', internal_verification: 'pass (PASS, STP-1)' })
  const kid = task({ task_id: 'TSK-2', title: 'Child', tags: 'parent-tsk-1' })
  const { store, db } = await fresh([parent, kid], [step({ step_state: 'served', verdict: 'PASS', acked_at: NOW })])
  const r = await store.writeCard('move_task', { task_id: 'TSK-1', stage: 'done', updated_at: NOW })
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  const rows = await q(db, `SELECT task_id, role FROM gov_task_steps WHERE task_id = 'TSK-2'`)
  assert.deepEqual(rows, [{ task_id: 'TSK-2', role: 'builder' }])
  assert.deepEqual((await q(db, 'SELECT task_id FROM task_rollups ORDER BY rollup_id')).map(x => x.task_id).sort(), ['TSK-1', 'TSK-2'])
})

test('rule 15 on the store: a failed complete_step inserts the retry step instead of throwing', async () => {
  const leased = step({ step_state: 'dispatched', lease_owner: 'gw.gov-board-write@agt-b', lease_expires_at: '2026-10-30T13:00:00.000Z' })
  const { store, db } = await fresh([task({ stage: 'build', work_state: 'in_progress', assignee: 'agt-b' })], [leased])
  const r = await store.write('complete_step', { step_id: 'STP-1', step_state: 'served', verdict: 'FAIL', budget_used: '1', updated_at: NOW }, 'agt-b')
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  const rows = await q(db, 'SELECT step_id, goal, step_state FROM gov_task_steps ORDER BY step_no')
  assert.equal(rows.length, 2)
  assert.match(String(rows[1]!.goal), /^retry:/)
  assert.equal(rows[1]!.step_state, 'awaiting_pull')
})

test('ops outside CARD_OPS are not answered by writeCard', async () => {
  const { store } = await fresh([task()])
  for (const op of ['create_task', 'claim_step']) {
    const r = await store.writeCard(op, { task_id: 'TSK-1' })
    assert.equal(r.ok, false, op)
    assert.match(r.ok ? '' : r.reason, /not answered by the step store/)
  }
  // split_task is in CARD_OPS (the route sends it here) but makes cards, so writeCard points at splitCard.
  const split = await store.writeCard('split_task', { task_id: 'TSK-1' })
  assert.match(split.ok ? '' : split.reason, /splitCard/)
})

// ---------- Cutover step 5: every write that makes a step or a note lands in Postgres ----------

test('owner add_note on the store: the note takes a sequence id and names the step it is on', async () => {
  const { store, db } = await fresh([task({ stage: 'build', work_state: 'in_progress' })], [step({ step_state: 'dispatched' })])
  const r = await store.writeCard('add_note', { task_id: 'TSK-1', step_id: 'STP-1', kind: 'status', body: 'Looking good' })
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  const notes = await q(db, 'SELECT note_id, step_id, author_id, kind, body FROM gov_task_notes')
  assert.deepEqual(notes, [{ note_id: 'NTE-900001', step_id: 'STP-1', author_id: 'person:meshach', kind: 'status', body: 'Looking good' }])
  assert.equal(r.ok && r.rows.notes![0]!.note_id, 'NTE-900001')
})

test('an agent message_agent on the store: the note and the orchestrator chat step are inserted, and a second message joins the open step', async () => {
  const { store, db } = await fresh([task({ stage: 'build', work_state: 'in_progress' })], [step({ step_state: 'dispatched', lease_owner: 'gw.gov-board-write@agt-b', lease_expires_at: '2030-01-01T00:00:00.000Z' })])
  const first = await store.write('message_agent', { task_id: 'TSK-1', body: 'The orchestrator, which branch?' }, 'agt-b')
  assert.equal(first.ok, true, first.ok ? '' : first.reason)
  const chat = await q(db, "SELECT step_id, role, assignee, step_state, input_ref FROM gov_task_steps WHERE role = 'chat'")
  assert.deepEqual(chat, [{ step_id: 'STP-900001', role: 'chat', assignee: 'agt-orchestrator', step_state: 'awaiting_pull', input_ref: 'NTE-900001' }])
  const second = await store.write('message_agent', { task_id: 'TSK-1', body: 'Also, the tests?' }, 'agt-b')
  assert.equal(second.ok, true, second.ok ? '' : second.reason)
  assert.equal((await q(db, "SELECT step_id FROM gov_task_steps WHERE role = 'chat'")).length, 1, 'one open chat step per agent per card')
  assert.equal((await q(db, 'SELECT note_id FROM gov_task_notes')).length, 2)
})

test('handoff_step: the hand-off note and the orchestrator chat step for a card n8n made, once', async () => {
  const { store, db } = await fresh([task()])
  const context = JSON.stringify({ source_surface: 'claude-code', classification: 'personal' })
  const r = await store.write('handoff_step', { task_id: 'TSK-1', context }, 'agt-b')
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  const steps = await q(db, 'SELECT step_id, role, assignee, goal, input_ref FROM gov_task_steps')
  assert.equal(steps.length, 1)
  assert.equal(steps[0]!.assignee, 'agt-orchestrator')
  assert.match(String(steps[0]!.goal), /^Triage hand-off from agt-b on TSK-1/)
  const notes = await q(db, 'SELECT note_id, step_id, body FROM gov_task_notes')
  assert.equal(steps[0]!.input_ref, notes[0]!.note_id)
  assert.equal(notes[0]!.step_id, steps[0]!.step_id)
  assert.match(String(notes[0]!.body), /Hand-off from agt-b\.\nsource_surface: claude-code\nclassification: personal/)
  const again = await store.write('handoff_step', { task_id: 'TSK-1', context }, 'agt-b')
  assert.match(again.ok ? '' : again.reason, /already has the orchestrator's hand-off step/)
  const owner = await store.writeCard('handoff_step' as never, { task_id: 'TSK-1' })
  assert.equal(owner.ok, false, 'handoff_step is not an owner op')
})

test('splitCard: the rules refuse first, then each child is made through createCard and the parent gets one note naming them', async () => {
  const { store, db } = await fresh([task({ stage: 'architecture', work_state: 'awaiting_start', tags: 'class-personal' })])
  const made: Record<string, string>[] = []
  let n = 0
  const createCard = async (fields: Record<string, string>) => { made.push(fields); n += 1; return { ok: true as const, op: 'create_task', rows: { tasks: [{ ...task({ task_id: `TSK-${9100 + n}`, title: fields.title, tags: fields.tags }) }] } } }
  const children = JSON.stringify([{ title: 'Part one', acceptance_requirements: 'A' }, { title: 'Part two' }])
  const r = await store.splitCard({ task_id: 'TSK-1', children, updated_at: NOW }, { person: 'person:meshach' }, createCard)
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  assert.deepEqual(made.map(f => [f.title, f.tags, f.acceptance_requirements ?? '']), [['Part one', 'class-personal,parent-tsk-1', 'A'], ['Part two', 'class-personal,parent-tsk-1', '']])
  assert.equal(r.ok && r.rows.tasks!.map(t => t.task_id).join(','), 'TSK-1,TSK-9101,TSK-9102')
  const notes = await q(db, 'SELECT note_id, kind, author_id, body FROM gov_task_notes')
  assert.deepEqual(notes, [{ note_id: 'NTE-900001', kind: 'status', author_id: 'person:meshach', body: 'Split into TSK-9101, TSK-9102. Each waits in Backlog until TSK-1 is done.' }])
  assert.equal((await q(db, "SELECT kind FROM board_events WHERE kind = 'note'")).length, 1)
  // A refusal from the rules makes no card.
  const bad = await store.splitCard({ task_id: 'TSK-1', children: '[]', updated_at: NOW }, { person: 'person:meshach' }, createCard)
  assert.match(bad.ok ? '' : bad.reason, /1 to 10 cards/)
  assert.equal(made.length, 2)
  // A gateway refusal midway is reported with what was made, so the owner does not split again.
  let calls = 0
  const flaky = async (fields: Record<string, string>) => (calls++ === 0 ? createCard(fields) : { ok: false as const, op: 'create_task', reason: 'HTTP 502' })
  const half = await store.splitCard({ task_id: 'TSK-1', children, updated_at: NOW }, { person: 'person:meshach' }, flaky)
  assert.match(half.ok ? '' : half.reason, /"Part two" was not created: HTTP 502\. TSK-9103 were created before it failed; do not split again/)
})

test('rows() returns every step and note the store holds, for the board snapshot (cutover step 6)', async () => {
  const { store } = await fresh([task()], [step(), step({ step_id: 'STP-2', step_no: 2, task_id: 'TSK-1' })])
  await store.writeCard('add_note', { task_id: 'TSK-1', body: 'hello' })
  const rows = await store.rows()
  assert.deepEqual(rows.steps.map(s => s.step_id), ['STP-1', 'STP-2'])
  assert.deepEqual(rows.notes.map(n => n.body), ['hello'])
})

test('openSteps() returns only open steps, with no notes, for the dispatcher poll', async () => {
  const { store } = await fresh([task()], [
    step({ role: 'builder', assignee: 'pool:builder', step_state: 'awaiting_pull' }),
    step({ step_id: 'STP-2', step_no: 2, task_id: 'TSK-1', role: 'builder', step_state: 'verified' }),
    step({ step_id: 'STP-3', step_no: 3, task_id: 'TSK-1', role: 'builder', step_state: 'awaiting_pull', cancelled: true })
  ])
  const open = await store.openSteps()
  assert.equal(open.length, 1)
  assert.deepEqual(Object.keys(open[0]!).sort(), ['acked_at', 'assignee', 'cancelled', 'role', 'step_state'])
})

test('an agent splitCard: only the holder of the open architect step may split, and the note is in its name', async () => {
  const { store, db } = await fresh(
    [task({ stage: 'architecture', work_state: 'in_progress' })],
    [step({ role: 'architect', assignee: 'agt-adv', step_state: 'dispatched', lease_owner: 'gw.gov-board-write@agt-adv', lease_expires_at: '2030-01-01T00:00:00.000Z' })]
  )
  const made: string[] = []
  let n = 0
  const createCard = async (fields: Record<string, string>) => { made.push(fields.title!); n += 1; return { ok: true as const, op: 'create_task', rows: { tasks: [task({ task_id: `TSK-${9200 + n}`, title: fields.title })] } } }
  const children = JSON.stringify([{ title: 'Child A' }, { title: 'Child B' }])
  const other = await store.splitCard({ task_id: 'TSK-1', children, updated_at: NOW }, { agent_id: 'agt-b' }, createCard)
  assert.match(other.ok ? '' : other.reason, /does not hold an open architect step/)
  assert.deepEqual(made, [])
  const r = await store.splitCard({ task_id: 'TSK-1', children, updated_at: NOW }, { agent_id: 'agt-adv' }, createCard)
  assert.equal(r.ok, true, r.ok ? '' : r.reason)
  assert.deepEqual(made, ['Child A', 'Child B'])
  const notes = await q(db, 'SELECT author_id, body FROM gov_task_notes')
  assert.deepEqual(notes, [{ author_id: 'agt-adv', body: 'Split into TSK-9201, TSK-9202. Each waits in Backlog until TSK-1 is done.' }])
})
