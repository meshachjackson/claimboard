// A card with an open agent question: a note creates no step, a reply creates one. Runs the fixtures-mode
// stand-in for gw.gov-board-write (app/utils/boardOps.ts) over the mock rows. Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

// boardOps.ts imports through Nuxt's `~/` alias with no extension; point both at app/ and .ts for Node.
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
let mergeRows: typeof import('../app/utils/boardOps.ts').mergeRows
before(async () => {
  ({ applyOp, mergeRows } = await import('../app/utils/boardOps.ts'))
})

// A fresh copy of the fixtures each time, as the store's run() hands to applyOp.
const board = () => ({
  tasks: mock('gov_tasks.synthetic.json'),
  steps: mock('gov_task_steps.synthetic.json'),
  notes: mock('gov_task_notes.json'),
  columns: mock('board_columns.json'),
  registry: mock('gov_registry.json')
})
const stepsOn = (b: ReturnType<typeof board>) => b.steps.filter(s => s.task_id === TASK)
const notesOn = (b: ReturnType<typeof board>) => b.notes.filter(n => n.task_id === TASK)

test('add_note on a card with an open question adds a comment and no step', () => {
  const b = board()
  const open = stepsOn(b).find(s => s.step_state === 'needs_input' && s.acked_at)!
  const steps = stepsOn(b).length
  const notes = notesOn(b).length
  const result = applyOp(b, 'add_note', { task_id: TASK, kind: 'comment', body: 'Just a heads-up, no action needed.' }, MESHACH)
  assert.equal(result.ok, true)
  if (!result.ok) return
  mergeRows(b, result.rows)
  assert.equal(stepsOn(b).length, steps)
  assert.equal(notesOn(b).length, notes + 1)
  assert.equal(notesOn(b).at(-1)!.kind, 'comment')
  // The question is still open: same step, same state.
  const still = stepsOn(b).find(s => s.step_id === open.step_id)!
  assert.equal(still.step_state, 'needs_input')
  assert.ok(still.acked_at)
})

test('reply on the same card answers the question and starts a new step for that agent', () => {
  const b = board()
  const open = stepsOn(b).find(s => s.step_state === 'needs_input' && s.acked_at)!
  const steps = stepsOn(b).length
  const result = applyOp(b, 'reply', { step_id: open.step_id, body: 'Plan against the Container checklist.', updated_at: open.updated_at }, MESHACH)
  assert.equal(result.ok, true)
  if (!result.ok) return
  mergeRows(b, result.rows)
  assert.equal(stepsOn(b).length, steps + 1)
  const fresh = stepsOn(b).at(-1)!
  assert.equal(fresh.assignee, open.assignee)
  assert.equal(fresh.role, open.role)
  assert.equal(fresh.step_state, 'awaiting_pull')
  assert.equal(notesOn(b).at(-1)!.kind, 'comment')
  assert.equal(fresh.input_ref, notesOn(b).at(-1)!.note_id)
})
