// The vault-path rule in the local op check:
// a system file's path may be named, a personal note's path never. Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import './instance-setup.ts'
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
const TASK = 'TSK-900002'

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
const note = (body: string) => applyOp(board(), 'add_note', { task_id: TASK, kind: 'comment', body }, MESHACH)

test('a system file path is allowed', () => {
  for (const p of ['~/Notes/AGENTS.md', '~/Notes/_os/_iq/state/handoffs/code.md', '/Users/x/Notes/open-loops.md', 'the ~/Notes vault']) {
    assert.equal(note(`See ${p} for the wiring.`).ok, true, p)
  }
})

test('a personal note path is refused, with a reason that says to describe it in words', () => {
  for (const p of ['~/Notes/Memoir/chapter-3.md', '~/Notes/Health/labs.md', 'Private-Notes/evidence.md']) {
    const r = note(`See ${p}.`)
    assert.equal(r.ok, false, p)
    if (!r.ok) assert.match(r.reason, /vault/)
  }
})

test('other GitHub-style paths with the owner name are not touched', () => {
  assert.equal(note('PR https://github.com/meshachjackson/agent-board/pull/35').ok, true)
})
