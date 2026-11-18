// Closing a card on Meshach's word when its steps are finished or stalled. Runs the fixtures-mode stand-in for
// gw.gov-board-write (app/utils/boardOps.ts) over the mock rows. The same rule lives in the ops repo's plan_board.js.
// Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
// These fixtures are the owner's: the board owner is a setting, so the tests set it.
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

const mock = (file: string) => JSON.parse(readFileSync(new URL(`../mock/${file}`, import.meta.url), 'utf8'))
const TASK = 'TSK-900002' // Architecture card; its architect step is acked needs_input with a question note
const MESHACH = { person: 'person:meshach' }

let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
let holdsCardOut: typeof import('../app/utils/boardOps.ts').holdsCardOut
before(async () => {
  ({ applyOp, holdsCardOut } = await import('../app/utils/boardOps.ts'))
})

const board = () => ({
  tasks: mock('gov_tasks.synthetic.json'),
  steps: mock('gov_task_steps.synthetic.json'),
  notes: mock('gov_task_notes.json'),
  columns: mock('board_columns.json'),
  registry: mock('gov_registry.json')
})
const close = (b: ReturnType<typeof board>) =>
  applyOp(b, 'done_no_steps', { task_id: TASK, updated_at: b.tasks.find(t => t.task_id === TASK)!.updated_at }, MESHACH)

test('holdsCardOut: open and stalled steps hold a card, finished and cancelled ones do not', () => {
  const step = (x: object) => ({ step_id: 'STP-1', task_id: 'T', role: 'builder', cancelled: false, acked_at: null, step_state: 'awaiting_pull', ...x }) as never
  assert.equal(holdsCardOut(step({})), true)
  assert.equal(holdsCardOut(step({ acked_at: 'x', step_state: 'needs_input' })), true)
  assert.equal(holdsCardOut(step({ acked_at: 'x', step_state: 'failed' })), true)
  assert.equal(holdsCardOut(step({ acked_at: 'x', step_state: 'served' })), false)
  assert.equal(holdsCardOut(step({ acked_at: 'x', step_state: 'verified' })), false)
  assert.equal(holdsCardOut(step({ cancelled: true })), false)
  assert.equal(holdsCardOut(step({ role: 'chat', acked_at: 'x', step_state: 'served' })), false)
  assert.equal(holdsCardOut(step({ role: 'chat' })), true)
})

test('done_no_steps is refused while a step is stalled (needs_input), until it is cancelled', () => {
  const b = board()
  const r = close(b)
  assert.equal(r.ok, false)
  assert.match(String((r as { reason?: string }).reason), /not cancelled/)
})

test('done_no_steps closes a card whose steps are all finished, with the manual pass and one status note', () => {
  const b = board()
  for (const s of b.steps.filter(x => x.task_id === TASK)) Object.assign(s, { step_state: 'served', verdict: 'PASS', acked_at: s.acked_at ?? '2026-10-27T20:00:00.000Z' })
  const notes = b.notes.length
  const r = close(b)
  assert.equal(r.ok, true)
  const t = b.tasks.find(x => x.task_id === TASK)!
  assert.equal(t.work_state, 'done')
  assert.equal(t.internal_verification, 'pass manual:person:meshach')
  assert.equal(t.macro_verification, 'pass person:meshach')
  const added = b.notes.slice(notes)
  assert.equal(added.length >= 1, true)
  assert.match(added[added.length - 1]!.body, /Closed on Meshach's word \(manual pass\), not by a verification\. Finished steps kept: /)
})

test('done_no_steps still closes a card whose steps are all cancelled, and writes no note', () => {
  const b = board()
  for (const s of b.steps.filter(x => x.task_id === TASK)) s.cancelled = true
  const notes = b.notes.length
  const r = close(b)
  assert.equal(r.ok, true)
  assert.equal(b.notes.length, notes)
})
