// One test per column rule (rules 12 to 15) plus chatTarget, against the single copy in
// app/utils/boardOps.ts. Plain in-memory rows. Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { ME, NOW, NOW_MS, board, reason, step, stepsOf, task, taskOf, type B } from './board-helpers.ts'

let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
let chatTarget: typeof import('../app/utils/boardOps.ts').chatTarget
before(async () => { ({ applyOp, chatTarget } = await import('../app/utils/boardOps.ts')) })
const run = (b: B, op: string, args: object, caller: object = ME) => applyOp(b, op, args as never, caller as never, NOW_MS)

test('rule 12: start_task starts a Backlog card, restarts a failed Build card, and refuses one that is already running', () => {
  const fresh = board([task()])
  assert.equal(run(fresh, 'start_task', { task_id: 'TSK-1', updated_at: NOW }).ok, true)
  assert.equal(stepsOf(fresh).filter(s => s.role === 'builder').length, 1)
  const failed = board([task({ stage: 'build', work_state: 'blocked' })], [step({ step_state: 'failed' })])
  assert.equal(run(failed, 'start_task', { task_id: 'TSK-1', updated_at: NOW }).ok, true)
  assert.equal(stepsOf(failed).filter(s => !s.cancelled && s.step_state === 'awaiting_pull').length, 1)
  const running = board([task({ stage: 'build', work_state: 'in_progress' })], [step({ step_state: 'dispatched' })])
  assert.match(reason(run(running, 'start_task', { task_id: 'TSK-1', updated_at: NOW })), /already running/)
})

test('rule 13: send_back moves a Review card to Build, resets verification and puts the line in the new step goal', () => {
  const b = board([task({ stage: 'review', work_state: 'verifying', internal_verification: 'pass (PASS, STP-1)' })], [step({ step_state: 'served', verdict: 'PASS', acked_at: NOW })])
  assert.equal(run(b, 'send_back', { task_id: 'TSK-1', body: 'Please add a test', updated_at: NOW }).ok, true)
  assert.equal(taskOf(b).stage, 'build')
  assert.equal((b.tasks[0] as unknown as { internal_verification: string }).internal_verification, 'none')
  const fresh = stepsOf(b).find(s => s.step_id !== 'STP-1')!
  assert.match(fresh.goal, /Sent back: Please add a test/)
  assert.equal((b.notes as unknown as { kind: string, body: string }[]).some(n => n.kind === 'comment' && n.body === 'Please add a test'), true)
  const notReview = board([task({ stage: 'build' })])
  assert.match(reason(run(notReview, 'send_back', { task_id: 'TSK-1', body: 'x', updated_at: NOW })), /not in Review/)
})

test('rule 14: a move cancels the open steps of the column it leaves, and assign hands an open step to the new agent', () => {
  const moved = board([task({ stage: 'build', work_state: 'awaiting_start' })], [step()])
  assert.equal(run(moved, 'move_task', { task_id: 'TSK-1', stage: 'backlog', updated_at: NOW }).ok, true)
  assert.equal(stepsOf(moved)[0]!.cancelled, true)
  const reassigned = board([task({ stage: 'build', work_state: 'awaiting_start', assignee: 'agt-b' })], [step()])
  assert.equal(run(reassigned, 'assign', { task_id: 'TSK-1', assignee: 'agt-c', updated_at: NOW }).ok, true)
  assert.equal(stepsOf(reassigned)[0]!.cancelled, true)
  assert.equal(stepsOf(reassigned).find(s => !s.cancelled)!.assignee, 'agt-c')
})

test('reassign cancels other pending steps held by a different agent', () => {
  const b = board([task({ stage: 'backlog', work_state: 'not_started', assignee: 'agt-b' })], [step({ assignee: 'agt-b' })])
  assert.equal(run(b, 'assign', { task_id: 'TSK-1', assignee: 'agt-c', updated_at: NOW }).ok, true)
  assert.equal(stepsOf(b).filter(s => !s.cancelled && s.assignee === 'agt-b').length, 0)
})

test('rule 15: a failed builder step is retried once, and a failed retry blocks the card', () => {
  const leased = { lease_owner: 'gw.gov-board-write@agt-b', lease_expires_at: '2026-10-30T13:00:00.000Z', step_state: 'dispatched' }
  const b = board([task({ stage: 'build', work_state: 'in_progress', assignee: 'agt-b' })], [step(leased)])
  const fail = (id: string, at: string) => run(b, 'complete_step', { step_id: id, step_state: 'served', verdict: 'FAIL', budget_used: '1', updated_at: at }, { agent_id: 'agt-b' })
  assert.equal(fail('STP-1', NOW).ok, true)
  const retry = stepsOf(b).filter(s => !s.cancelled && s.step_state === 'awaiting_pull')
  assert.equal(retry.length, 1)
  assert.match(retry[0]!.goal, /^retry:/)
  // The retry fails too: no third step, the card is blocked.
  const second = b.steps.find(s => (s as unknown as { step_id: string }).step_id === retry[0]!.step_id) as unknown as Record<string, unknown>
  Object.assign(second, leased, { lease_owner: 'gw.gov-board-write@agt-b' })
  assert.equal(fail(retry[0]!.step_id, second.updated_at as string).ok, true)
  assert.equal(stepsOf(b).filter(s => !s.cancelled && s.step_state === 'awaiting_pull').length, 0)
  assert.equal(taskOf(b).work_state, 'blocked')
})

test('chatTarget: a message goes to the tagged agent when it takes messages, else to the orchestrator; an agent never messages itself', () => {
  const b = board([task()])
  assert.equal(chatTarget(b.tasks[0] as never, [], b.registry, 'person:meshach', 'agt-chat'), 'agt-chat')
  assert.equal(chatTarget(b.tasks[0] as never, [], b.registry, 'person:meshach', 'agt-b'), 'agt-orchestrator')
  assert.equal(chatTarget(b.tasks[0] as never, [], b.registry, 'person:meshach', ''), 'agt-orchestrator')
  assert.equal(chatTarget(b.tasks[0] as never, [], b.registry, 'agt-chat', 'agt-chat'), 'agt-orchestrator')
})
