// Approve plan also moves the card to Build. The store sends approve_plan, then move_task to build only
// if the approval was accepted. The store needs Nuxt, so these tests run that same op sequence on plain rows.
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
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

const ME = { person: 'person:meshach' }
const NOW = '2026-11-03T12:00:00.000Z'
let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
before(async () => {
  ({ applyOp } = await import('../app/utils/boardOps.ts'))
})

const task = {
  task_id: 'TSK-1', title: 'Add the filter', original_request: 'Add the filter', acceptance_requirements: 'It works', task_type: 'build',
  proposed_assignee: '', assignee: 'agt-b', upgrade_target: '', execution_policy: '', approval_state: 'not_required', work_state: 'needs_input',
  current_step: 1, steps_total: 1, outputs_ref: '', internal_verification: 'none', macro_verification: 'none', escalation: 'none',
  priority: 'normal', project_id: '', created_by: 'person:meshach', created_at: NOW, due_at: null, updated_by: 'x', updated_at: NOW,
  stage: 'architecture', tags: ''
}
const planStep = {
  step_id: 'STP-A', task_id: 'TSK-1', step_no: 1, assignee: 'agt-b', goal: 'architect: Add the filter', input_ref: '', target_action: 'read',
  target_ticket_ref: '', step_state: 'served', stop_reason: '', verdict: 'PASS', budget_used: '', output_ref: 'plan STP-A', output_summary: 'Plan',
  vera_ticket_ref: '', created_at: NOW, dispatched_at: null, ended_at: NOW, updated_at: NOW, claim_key: 'pull:STP-A', lease_owner: '',
  lease_expires_at: null, acked_at: NOW, cancelled: false, claim_count: 1, last_claimed_at: null, role: 'architect', activity: '', heartbeat_at: null
}
const board = (stepOver: object = {}) => ({
  tasks: [{ ...task }] as never[], steps: [{ ...planStep, ...stepOver }] as never[], notes: [] as never[],
  columns: JSON.parse(readFileSync(new URL('../mock/board_columns.json', import.meta.url), 'utf8')),
  registry: [{ agent_id: 'agt-b', name: 'agt-b', lifecycle_status: 'active', agent_type: 'builder' }] as never[]
})
const run = (b: ReturnType<typeof board>, op: string, args: object) => applyOp(b, op, args as never, ME as never, Date.parse(NOW) + 1000)
const t = (b: ReturnType<typeof board>) => b.tasks[0] as unknown as { stage: string }
const stepsOf = (b: ReturnType<typeof board>) => b.steps as unknown as { role: string, step_state: string }[]

test('approve_plan then move_task to build verifies the plan and creates the builder step', () => {
  const b = board()
  const first = run(b, 'approve_plan', { step_id: 'STP-A', updated_at: NOW })
  assert.equal(first.ok, true)
  assert.equal(stepsOf(b).find(s => s.role === 'architect')?.step_state, 'verified')
  // The store re-reads the card's updated_at after the approval before it moves it.
  const moved = run(b, 'move_task', { task_id: 'TSK-1', stage: 'build', updated_at: (b.tasks[0] as unknown as { updated_at: string }).updated_at })
  assert.equal(moved.ok, true)
  assert.equal(t(b).stage, 'build')
  assert.equal(stepsOf(b).filter(s => s.role === 'builder').length, 1)
})

test('a refused approve_plan changes nothing, so the store sends no move', () => {
  const b = board({ acked_at: null })
  const r = run(b, 'approve_plan', { step_id: 'STP-A', updated_at: NOW })
  assert.equal(r.ok, false)
  assert.equal(t(b).stage, 'architecture')
  assert.equal(stepsOf(b).length, 1)
})

test('a refused move leaves the plan approved and gives a reason', () => {
  const b = board()
  assert.equal(run(b, 'approve_plan', { step_id: 'STP-A', updated_at: NOW }).ok, true)
  // A stale updated_at stands in for any refusal of the move.
  const moved = run(b, 'move_task', { task_id: 'TSK-1', stage: 'build', updated_at: '2020-01-01T00:00:00.000Z' })
  assert.equal(moved.ok, false)
  assert.ok((moved as { reason: string }).reason)
  assert.equal(stepsOf(b).find(s => s.role === 'architect')?.step_state, 'verified')
  assert.equal(t(b).stage, 'architecture')
})
