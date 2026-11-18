// A chat step's answer keeps up to 2,000 characters and is refused past that, as the task-write workflow does (
//). Every other step's output_summary is still cut at 500. Runs boardOps' runOp on the fixtures.
// Nitro's `~/` aliases are pointed at the repo. Run with `pnpm test`.
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

// A card with one chat step for Lonnie, claimed and ready to ack. `role` swaps the step's role to test a non-chat ack.
function claimed(role = 'chat') {
  const tasks = mock('gov_tasks.synthetic.json').map((t: any) => ({ ...t }))
  const task = tasks.find((t: any) => !t.archived_at)
  task.assignee = 'agt-builder-local'
  const board: any = { tasks, steps: [], notes: [], registry: mock('gov_registry.json'), columns: mock('board_columns.json') }
  const run = (op: string, args: any, caller: any) => {
    const r: any = ops.runOp(board, op, args, caller)
    if (r.ok) Object.assign(board, ops.mergeRows(board, r.rows))
    return r
  }
  assert.ok(run('message_agent', { task_id: task.task_id, body: 'a question', to: 'agt-builder-local' }, OWNER).ok)
  const step = board.steps.at(-1)
  assert.ok(run('claim_step', { step_id: step.step_id, claim_key: step.claim_key, updated_at: step.updated_at }, LONNIE).ok)
  const live = () => board.steps.find((s: any) => s.step_id === step.step_id)
  live().role = role
  const ack = (output_summary: string) => run('complete_step', {
    step_id: step.step_id, step_state: 'served', verdict: 'PASS', budget_used: 'attempts 1, tokens 10', output_summary, updated_at: live().updated_at
  }, LONNIE)
  return { board, ack, live }
}

test('a chat answer of 2,000 characters is kept whole, in the step and in the comment note', () => {
  const { board, ack, live } = claimed()
  const answer = 'a'.repeat(2000)
  assert.ok(ack(answer).ok)
  assert.equal(live().output_summary.length, 2000)
  assert.equal(board.notes.at(-1).kind, 'comment')
  assert.equal(board.notes.at(-1).body, answer)
})

test('a chat answer of 2,001 characters is refused and the step stays open', () => {
  const { ack, live } = claimed()
  const r = ack('a'.repeat(2001))
  assert.equal(r.ok, false)
  assert.match(r.reason, /2001 characters; a chat answer's cap is 2,000/)
  assert.equal(live().step_state, 'dispatched')
})

test('a builder summary is still cut at 500', () => {
  const { ack, live } = claimed('builder')
  assert.ok(ack('b'.repeat(2000)).ok)
  assert.equal(live().output_summary.length, 500)
})
