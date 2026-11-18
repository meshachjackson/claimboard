// Duplicate finder and merge rules (app/utils/dupes.ts), plus the gateway steps a merge runs through the fixtures-mode
// stand-in (app/utils/boardOps.ts). Run with `pnpm test`.
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
const MESHACH = { person: 'person:meshach' }

let dupes: typeof import('../app/utils/dupes.ts')
let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
before(async () => {
  dupes = await import('../app/utils/dupes.ts');
  ({ applyOp } = await import('../app/utils/boardOps.ts'))
})

type Task = Parameters<typeof import('../app/utils/dupes.ts').findDupes>[0][number]
type Step = Parameters<typeof import('../app/utils/dupes.ts').keepReason>[1][number]
const card = (task_id: string, title: string, created_at: string, extra: Partial<Task> = {}) =>
  ({ task_id, title, created_at, archived_at: null, pinned_at: null, work_state: 'backlog', ...extra }) as Task
const step = (task_id: string, extra: Partial<Step> = {}) =>
  ({ step_id: `S-${task_id}`, task_id, cancelled: false, acked_at: null, step_state: 'awaiting_pull', role: 'builder', ...extra }) as Step

test('groups matching titles, oldest first, ignoring case and spacing', () => {
  const groups = dupes.findDupes([
    card('B', 'De-dupe  button', '2026-10-02T00:00:00Z'),
    card('A', 'de-dupe button ', '2026-10-01T00:00:00Z'),
    card('C', 'Something else', '2026-10-03T00:00:00Z')
  ])
  assert.deepEqual(groups.map(g => g.map(t => t.task_id)), [['A', 'B']])
})

test('skips archived cards, single cards and blank titles', () => {
  assert.deepEqual(dupes.findDupes([card('A', 'Same', '2026-10-01', { archived_at: '2026-10-05' }), card('B', 'Same', '2026-10-02')]), [])
  assert.deepEqual(dupes.findDupes([card('A', ' ', '2026-10-01'), card('B', '', '2026-10-02')]), [])
})

test('the fixtures have no duplicates', () => {
  assert.deepEqual(dupes.findDupes(mock('gov_tasks.synthetic.json')), [])
})

test('suggested keeper: pinned first, then open over done, then oldest', () => {
  const old = card('A', 'x', '2026-10-01', { work_state: 'done' })
  const mid = card('B', 'x', '2026-10-02')
  const late = card('C', 'x', '2026-10-03')
  assert.equal(dupes.suggestKeeper([old, mid, late]), 'B')
  assert.equal(dupes.suggestKeeper([mid, late]), 'B')
  assert.equal(dupes.suggestKeeper([old, mid, { ...late, pinned_at: '2026-10-04' }]), 'C')
})

test('a pinned duplicate is never in the remove list', () => {
  const group = [card('A', 'x', '2026-10-01'), card('B', 'x', '2026-10-02', { pinned_at: '2026-10-04' }), card('C', 'x', '2026-10-03')]
  const plan = dupes.planMerge(group, [], 'A')
  assert.deepEqual(plan.remove.map(r => r.task.task_id), ['C'])
  assert.deepEqual(plan.kept.map(k => [k.task.task_id, k.reason]), [['B', 'pinned']])
})

test('a duplicate an agent is running stays; the keeper is never removed', () => {
  const group = [card('A', 'x', '2026-10-01'), card('B', 'x', '2026-10-02')]
  const running = step('B', { step_state: 'dispatched' })
  assert.equal(dupes.planMerge(group, [running], 'A').remove.length, 0)
  assert.equal(dupes.planMerge(group, [running], 'B').remove.map(r => r.task.task_id).join(), 'A')
})

test('the preview lists open steps to cancel, not finished or cancelled ones', () => {
  const group = [card('A', 'x', '2026-10-01'), card('B', 'x', '2026-10-02')]
  const steps = [
    step('B', { step_id: 'open' }),
    step('B', { step_id: 'served', acked_at: 'x', step_state: 'served' }),
    step('B', { step_id: 'gone', cancelled: true })
  ]
  assert.deepEqual(dupes.planMerge(group, steps, 'A').remove[0]!.cancel.map(s => s.step_id), ['open'])
})

// The gateway steps mergeDupes runs, over a real fixture card with an open step.
const board = () => ({
  tasks: mock('gov_tasks.synthetic.json'),
  steps: mock('gov_task_steps.synthetic.json'),
  notes: mock('gov_task_notes.json'),
  columns: mock('board_columns.json'),
  registry: mock('gov_registry.json')
})
const run = (b: ReturnType<typeof board>, op: string, args: Record<string, string>) =>
  applyOp(b, op, args, MESHACH) as { ok: boolean, reason?: string }
const stamp = (b: ReturnType<typeof board>, id: string) => b.tasks.find(t => t.task_id === id)!.updated_at

test('merge steps: cancel the open step, close on word, archive; rows and notes stay', () => {
  const b = board()
  const id = 'TSK-900001'
  const open = b.steps.find(s => s.task_id === id)!
  const rows = [b.tasks.length, b.steps.length]
  const notes = b.notes.length
  // Closing first is refused while the step is open, so the merge cancels it first.
  assert.equal(run(b, 'done_no_steps', { task_id: id, updated_at: stamp(b, id) }).ok, false)
  assert.equal(run(b, 'cancel_step', { step_id: open.step_id, updated_at: open.updated_at }).ok, true)
  assert.equal(run(b, 'done_no_steps', { task_id: id, updated_at: stamp(b, id) }).ok, true)
  assert.equal(run(b, 'archive_task', { task_id: id, updated_at: stamp(b, id) }).ok, true)
  assert.ok(b.tasks.find(t => t.task_id === id)!.archived_at)
  assert.deepEqual([b.tasks.length, b.steps.length], rows)
  assert.ok(b.notes.length > notes)
})

test('the gateway refuses to archive a pinned card even if asked', () => {
  const b = board()
  const id = 'TSK-900008'
  assert.equal(run(b, 'pin_task', { task_id: id, updated_at: stamp(b, id) }).ok, true)
  const r = run(b, 'archive_task', { task_id: id, updated_at: stamp(b, id) })
  assert.equal(r.ok, false)
  assert.match(r.reason ?? '', /pinned/)
})
