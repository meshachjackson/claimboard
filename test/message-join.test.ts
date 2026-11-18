// A second message to an agent that already has an open chat step on the card joins that step. The
// join moves the step's updated_at, so an agent that is about to ack with the updated_at it read before the message is
// refused "stale" and re-reads the card, instead of closing the step over a message it never saw.
// Runs boardOps' runOp on the fixtures. Nitro's `~/` aliases are pointed at the repo. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

const root = new URL('../', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~~/')) spec = new URL(spec.slice(3) + (spec.endsWith('.json') ? '' : '.ts'), ${JSON.stringify(root)}).href
  else if (spec.startsWith('~/')) spec = new URL('app/' + spec.slice(2) + '.ts', ${JSON.stringify(root)}).href
  const out = await next(spec, ctx)
  return out.url.endsWith('.json') ? { ...out, importAttributes: { type: 'json' } } : out
}`))
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')
const ops = await import('../app/utils/boardOps.ts')

const mock = (f: string) => { const d = JSON.parse(readFileSync(new URL(`../mock/${f}`, import.meta.url), 'utf8')); return Array.isArray(d) ? d : d.rows }
const LONNIE = { agent_id: 'agt-builder-local' }
const OWNER = { person: 'person:meshach' }

function setup() {
  const registry = mock('gov_registry.json')
  const tasks = mock('gov_tasks.synthetic.json').map((t: any) => ({ ...t }))
  const task = tasks.find((t: any) => !t.archived_at)
  task.assignee = 'agt-builder-local'
  const board: any = { tasks, steps: [], notes: [], registry, columns: mock('board_columns.json') }
  // Applies an op the way the store does: runOp, then merge the rows it returns back into the board.
  const run = (op: string, args: any, caller: any) => {
    const r: any = ops.runOp(board, op, args, caller)
    if (r.ok) Object.assign(board, ops.mergeRows(board, r.rows))
    return r
  }
  return { board, task, run }
}
const stepOf = (board: any, id: string) => board.steps.find((s: any) => s.step_id === id)

test('a second message joins the open chat step and moves its updated_at', async () => {
  const { board, task, run } = setup()
  assert.ok(run('message_agent', { task_id: task.task_id, body: 'one', to: 'agt-builder-local' }, OWNER).ok)
  const [step] = board.steps.filter((s: any) => s.role === 'chat')
  const before = step.updated_at
  await new Promise(r => setTimeout(r, 5))   // updated_at has millisecond resolution
  assert.ok(run('message_agent', { task_id: task.task_id, body: 'two', to: 'agt-builder-local' }, OWNER).ok)
  const chat = board.steps.filter((s: any) => s.role === 'chat')
  assert.equal(chat.length, 1, 'still one open chat step: the second message joined it')
  assert.notEqual(stepOf(board, step.step_id).updated_at, before, 'the join moved the step\'s updated_at')
  assert.deepEqual(board.notes.filter((n: any) => n.task_id === task.task_id).map((n: any) => [n.body, n.step_id]), [['one', step.step_id], ['two', step.step_id]])
})

test('an ack with the updated_at read before the join is refused stale; with the fresh one it goes through', async () => {
  const { board, task, run } = setup()
  run('message_agent', { task_id: task.task_id, body: 'one', to: 'agt-builder-local' }, OWNER)
  const s0 = board.steps.find((s: any) => s.role === 'chat')
  assert.ok(run('claim_step', { step_id: s0.step_id, claim_key: s0.claim_key, updated_at: s0.updated_at }, LONNIE).ok)
  const read = stepOf(board, s0.step_id).updated_at   // what the agent read just before it acks
  await new Promise(r => setTimeout(r, 5))
  run('message_agent', { task_id: task.task_id, body: 'two, while Lonnie was answering', to: 'agt-builder-local' }, OWNER)
  const ack = (updated_at: string) => run('complete_step', { step_id: s0.step_id, step_state: 'served', verdict: 'PASS', budget_used: 'attempts 1, tokens 10', output_summary: 'answer', updated_at }, LONNIE)
  const stale = ack(read)
  assert.equal(stale.ok, false)
  assert.equal(stale.reason, 'stale')
  assert.equal(stepOf(board, s0.step_id).acked_at, null, 'the refused ack left the step open')
  assert.ok(ack(stepOf(board, s0.step_id).updated_at).ok, 'the ack with the re-read updated_at goes through')
})

test('a message to a card with no open chat step still starts a new one', () => {
  const { board, task, run } = setup()
  run('message_agent', { task_id: task.task_id, body: 'one', to: 'agt-builder-local' }, OWNER)
  const s0 = board.steps.find((s: any) => s.role === 'chat')
  run('claim_step', { step_id: s0.step_id, claim_key: s0.claim_key, updated_at: s0.updated_at }, LONNIE)
  run('complete_step', { step_id: s0.step_id, step_state: 'served', verdict: 'PASS', budget_used: 'attempts 1, tokens 10', output_summary: 'answer', updated_at: stepOf(board, s0.step_id).updated_at }, LONNIE)
  run('message_agent', { task_id: task.task_id, body: 'three, after the reply', to: 'agt-builder-local' }, OWNER)
  assert.equal(board.steps.filter((s: any) => s.role === 'chat').length, 2, 'an acked step is not joined')
})
