// create_task and update_task take board_id, so a card can be put on a board other than main. Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

const mock = (file: string) => JSON.parse(readFileSync(new URL(`../mock/${file}`, import.meta.url), 'utf8'))
const MESHACH = { person: 'person:meshach' }

let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
before(async () => {
  ({ applyOp } = await import('../app/utils/boardOps.ts'))
})

const board = () => ({
  tasks: mock('gov_tasks.synthetic.json'),
  steps: mock('gov_task_steps.synthetic.json'),
  notes: mock('gov_task_notes.json'),
  columns: mock('board_columns.json'),
  registry: mock('gov_registry.json')
})

test('create_task puts a card on a named board', () => {
  const r = applyOp(board(), 'create_task', { title: 'Exec card', board_id: 'exec' }, MESHACH)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.rows.tasks?.[0]?.board_id, 'exec')
})

test('update_task moves a card to another board', () => {
  const b = board()
  const t = b.tasks.find((x: { work_state: string, archived_at?: string }) => x.work_state !== 'done' && !x.archived_at)
  const r = applyOp(b, 'update_task', { task_id: t.task_id, board_id: 'exec', updated_at: t.updated_at }, MESHACH)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.rows.tasks?.[0]?.board_id, 'exec')
})

test('a board_id that is not a slug is refused', () => {
  const r = applyOp(board(), 'create_task', { title: 'Bad', board_id: 'Exec Board' }, MESHACH)
  assert.equal(r.ok, false)
})
