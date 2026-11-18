// Tagging an agent in a comment: @name sends message_agent's chat step to that agent, only if it takes
// messages; the card's assignee never changes. Runs the fixtures-mode stand-in for gw.gov-board-write. `pnpm test`.
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

const mock = (file: string) => JSON.parse(readFileSync(new URL(`../mock/${file}`, import.meta.url), 'utf8'))
const TASK = 'TSK-900002'
const MESHACH = { person: 'person:meshach' }

let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
let taggedAgent: typeof import('../app/utils/boardOps.ts').taggedAgent
before(async () => {
  ({ applyOp, taggedAgent } = await import('../app/utils/boardOps.ts'))
})

// The orchestrator and Claude Code list board_reply; Andi (active) does not.
const board = () => {
  const registry = mock('gov_registry.json')
  for (const r of registry) if (['agt-orchestrator', 'agt-claude-code-macbook'].includes(r.agent_id)) r.request_types = 'board_reply'
  return {
    tasks: mock('gov_tasks.synthetic.json'),
    steps: mock('gov_task_steps.synthetic.json'),
    notes: mock('gov_task_notes.json'),
    columns: mock('board_columns.json'),
    registry
  }
}

test('taggedAgent finds the first taggable @handle and ignores the rest', () => {
  const { registry } = board()
  assert.equal(taggedAgent('@orchestrator what do you think?', registry), 'agt-orchestrator')
  assert.equal(taggedAgent('Ask @Claude-Code-MacBook, not @orchestrator', registry), 'agt-claude-code-macbook')
  assert.equal(taggedAgent('no tag here', registry), '')
  assert.equal(taggedAgent('mail me at x@example.test', registry), '')
  assert.equal(taggedAgent('@andi can you look?', registry), '') // active, but no board_reply
  assert.equal(taggedAgent('@nobody then @orchestrator', registry), 'agt-orchestrator')
})

test('message_agent with a valid to sends the chat step to that agent and leaves the assignee alone', () => {
  const b = board()
  const before = b.tasks.find(t => t.task_id === TASK)!.assignee
  const result = applyOp(b, 'message_agent', { task_id: TASK, body: '@orchestrator should this move?', to: 'agt-orchestrator' }, MESHACH)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const chat = result.rows.steps!.find(s => s.role === 'chat')!
  assert.equal(chat.assignee, 'agt-orchestrator')
  assert.equal(result.rows.tasks?.[0]?.assignee ?? before, before)
})

test('message_agent with a to that cannot take messages falls back to the usual order', () => {
  const b = board()
  const result = applyOp(b, 'message_agent', { task_id: TASK, body: '@andi hello', to: 'agt-analyst' }, MESHACH)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const chat = result.rows.steps!.find(s => s.role === 'chat')!
  assert.notEqual(chat.assignee, 'agt-analyst')
})
