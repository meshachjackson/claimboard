// In the fixture stand-in (app/utils/boardOps.ts):
// With board.async on, move_task into Build of a card tagged async gives its builder step to pool:runner.
// Reopen_task, the owner's way to raise retry_cap on an escalated card and send it back to Build.
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
const NOW = '2026-11-05T12:00:00.000Z'
let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
let OWNER_OPS: readonly string[], PROPOSED_OPS: readonly string[], OP_LABELS: Record<string, string>
before(async () => {
  ({ applyOp } = await import('../app/utils/boardOps.ts'))
  ;({ OWNER_OPS, PROPOSED_OPS, OP_LABELS } = await import('../app/types/board.ts'))
})

const task = (over: object = {}) => ({
  task_id: 'TSK-1', title: 'Sticky header', original_request: 'Sticky header', acceptance_requirements: 'It sticks', task_type: 'build',
  proposed_assignee: '', assignee: 'agt-b', upgrade_target: '', execution_policy: '', approval_state: 'pending', work_state: 'awaiting_start',
  current_step: 1, steps_total: 1, outputs_ref: '', internal_verification: 'none', macro_verification: 'none', escalation: 'none',
  priority: 'normal', project_id: '', created_by: 'person:meshach', created_at: NOW, due_at: null, updated_by: 'x', updated_at: NOW,
  stage: 'architecture', tags: 'async', retry_count: 0, retry_cap: null, ...over
})
const step = (id: string, no: number, role: string, over: object = {}) => ({
  step_id: id, task_id: 'TSK-1', step_no: no, assignee: 'agt-b', goal: `${role}: Sticky header`, input_ref: '', target_action: 'read',
  target_ticket_ref: '', step_state: 'verified', stop_reason: '', verdict: 'PASS', budget_used: '', output_ref: `out ${id}`, output_summary: '',
  vera_ticket_ref: '', created_at: NOW, dispatched_at: null, ended_at: NOW, updated_at: NOW, claim_key: `pull:${id}`, lease_owner: '',
  lease_expires_at: null, acked_at: NOW, cancelled: false, claim_count: 1, last_claimed_at: null, role, activity: '', heartbeat_at: null, ...over
})
const board = (t: object, steps: object[], async?: boolean) => ({
  tasks: [t] as never[], steps: steps as never[], notes: [] as never[],
  columns: JSON.parse(readFileSync(new URL('../mock/board_columns.json', import.meta.url), 'utf8')),
  registry: [{ agent_id: 'agt-b', name: 'agt-b', lifecycle_status: 'active', agent_type: 'builder' }, { agent_id: 'agt-orchestrator', name: 'The orchestrator', lifecycle_status: 'active', agent_type: 'orchestrator' }] as never[],
  ...(async === undefined ? {} : { board_async: async })
})
const builderOf = (b: ReturnType<typeof board>) => (b.steps as Array<{ role: string, assignee: string, cancelled: boolean, step_no: number }>).filter(x => x.role === 'builder' && !x.cancelled).sort((x, y) => y.step_no - x.step_no)[0]
const toBuild = (b: ReturnType<typeof board>) => applyOp(b, 'move_task', { task_id: 'TSK-1', stage: 'build', updated_at: NOW }, ME, Date.parse(NOW) + 1000)

// ---------- ----------
test('302 async card: switch on, tag async, approved plan gives the builder step to pool:runner; the card keeps its assignee', () => {
  const b = board(task(), [step('STP-A', 1, 'architect')], true)
  const r = toBuild(b)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(builderOf(b).assignee, 'pool:runner')
  assert.equal((b.tasks[0] as { assignee: string }).assignee, 'agt-b')
})

test('302 today: switch off, switch absent, or no async tag gives the builder step to the card agent as before', () => {
  for (const [t, async] of [[task(), false], [task(), undefined], [task({ tags: 'board' }), true]] as const) {
    const b = board(t, [step('STP-A', 1, 'architect')], async)
    assert.equal(toBuild(b).ok, true)
    assert.equal(builderOf(b).assignee, 'agt-b', JSON.stringify({ async, tags: (t as { tags: string }).tags }))
  }
})

test('302 today: start_task on an async card never writes pool:runner', () => {
  const b = board(task({ stage: 'backlog', work_state: 'backlog' }), [], true)
  assert.equal(applyOp(b, 'start_task', { task_id: 'TSK-1', updated_at: NOW }, ME, Date.parse(NOW) + 1000).ok, true)
  assert.notEqual(builderOf(b).assignee, 'pool:runner')
})

// ---------- ----------
test('reopen_task is an owner op in every list, and a proposed op the gateway turns on by name', () => {
  assert.ok(OWNER_OPS.includes('reopen_task'))
  assert.ok(PROPOSED_OPS.includes('reopen_task'))
  assert.equal(OP_LABELS.reopen_task, 'Reopen')
})

const escalated = () => task({ stage: 'build', work_state: 'needs_input', escalation: 'STP-D tests_failed', retry_count: 2, retry_cap: 2 })
const failed = () => [step('STP-A', 1, 'architect'), step('STP-B', 2, 'builder', { assignee: 'pool:runner', step_state: 'served' }),
  step('STP-C', 3, 'auditor', { assignee: 'pool:verifier', step_state: 'served', verdict: 'FAIL' }),
  step('STP-D', 4, 'builder', { assignee: 'pool:runner', step_state: 'failed', verdict: '', stop_reason: 'tests_failed' })]
const reopen = (b: ReturnType<typeof board>, cap: string, caller: object = ME) => applyOp(b, 'reopen_task', { task_id: 'TSK-1', retry_cap: cap, updated_at: NOW }, caller as never, Date.parse(NOW) + 1000)

test('303 owner reopens: retry_cap raised, back to Build, escalation cleared, one status note, no new step', () => {
  const b = board(escalated(), failed(), true)
  const r = reopen(b, '3')
  assert.equal(r.ok, true, JSON.stringify(r))
  const t = b.tasks[0] as { retry_cap: number, stage: string, work_state: string, escalation: string }
  assert.deepEqual([t.retry_cap, t.stage, t.work_state, t.escalation], [3, 'build', 'awaiting_start', 'none'])
  assert.equal(b.steps.length, 4)
  assert.match((b.notes[0] as { body: string }).body, /retry_cap 2 -> 3/)
})

test('303 agents are refused, agt-orchestrator included', () => {
  for (const agent_id of ['agt-orchestrator', 'agt-b']) {
    const b = board(escalated(), failed(), true)
    const r = reopen(b, '3', { agent_id })
    assert.equal(r.ok, false)
    assert.match((r as { reason: string }).reason, /person/)
    assert.equal((b.tasks[0] as { retry_cap: number }).retry_cap, 2)
  }
})

test('303 refusals: cap not above retry_count, over 10, not whole, switch off, not escalated', () => {
  const cases: Array<[ReturnType<typeof board>, string, RegExp]> = [
    [board(escalated(), failed(), true), '2', /not above retry_count 2/],
    [board(escalated(), failed(), true), '11', /over 10/],
    [board(escalated(), failed(), true), '3.5', /whole number/],
    [board(escalated(), failed(), false), '3', /board\.async is off/],
    [board(task({ stage: 'build', work_state: 'blocked', retry_count: 2, retry_cap: 2 }), failed(), true), '3', /not needs_input/]
  ]
  for (const [b, cap, re] of cases) {
    const r = reopen(b, cap)
    assert.equal(r.ok, false)
    assert.match((r as { reason: string }).reason, re)
  }
})
