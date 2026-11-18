// Pinned cards: pin_task / unpin_task in the fixtures-mode stand-in for gw.gov-board-write, the archive
// refusal, and pinned-first sorting. Run with `pnpm test`.
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

let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
let sortCards: typeof import('../app/utils/sort.ts').sortCards
before(async () => {
  ({ applyOp } = await import('../app/utils/boardOps.ts'));
  ({ sortCards } = await import('../app/utils/sort.ts'))
})

const board = () => ({
  tasks: mock('gov_tasks.synthetic.json'),
  steps: mock('gov_task_steps.synthetic.json'),
  notes: mock('gov_task_notes.json'),
  columns: mock('board_columns.json'),
  registry: mock('gov_registry.json')
})
const call = (b: ReturnType<typeof board>, op: string, task: string) =>
  applyOp(b, op, { task_id: task, updated_at: b.tasks.find(t => t.task_id === task)!.updated_at }, MESHACH) as { ok: boolean, reason?: string }

test('pin_task sets pinned_at and writes one status note; a second pin is refused', () => {
  const b = board()
  const task = b.tasks.find(t => t.work_state === 'done' && !t.archived_at)!.task_id
  const notes = b.notes.length
  assert.equal(call(b, 'pin_task', task).ok, true)
  assert.ok(b.tasks.find(t => t.task_id === task)!.pinned_at)
  assert.equal(b.notes.length, notes + 1)
  const again = call(b, 'pin_task', task)
  assert.equal(again.ok, false)
  assert.match(String(again.reason), /already pinned/)
})

test('archive_task is refused on a pinned card, and works again after unpin_task', () => {
  const b = board()
  const task = b.tasks.find(t => t.work_state === 'done' && !t.archived_at)!.task_id
  call(b, 'pin_task', task)
  const refused = call(b, 'archive_task', task)
  assert.equal(refused.ok, false)
  assert.match(String(refused.reason), /is pinned/)
  assert.equal(call(b, 'unpin_task', task).ok, true)
  assert.equal(call(b, 'archive_task', task).ok, true)
})

test('unpin_task on a card that is not pinned is refused', () => {
  const b = board()
  const r = call(b, 'unpin_task', b.tasks[0]!.task_id)
  assert.equal(r.ok, false)
  assert.match(String(r.reason), /not pinned/)
})

test('sortCards puts pinned cards first for every key and both directions', () => {
  const card = (id: string, created: string, pinned: boolean) =>
    ({ pinned, task: { task_id: id, created_at: created, updated_at: created, priority: 'normal', due_at: null, title: id } }) as never
  const cards = [card('TSK-3', '2026-10-03', false), card('TSK-1', '2026-10-01', true), card('TSK-2', '2026-10-02', false)]
  for (const key of ['created', 'updated', 'priority', 'due', 'title'] as const) {
    for (const desc of [false, true]) {
      assert.equal(sortCards(cards, key, desc)[0]!.task.task_id, 'TSK-1', `${key} desc=${desc}`)
    }
  }
})
