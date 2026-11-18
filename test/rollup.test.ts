// Card rollup rules in app/utils/rollup.ts: pool check, active steps, work_state, and the step that drives the pill.
// Rows are plain objects built here, not mock files. Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
// These fixtures are the owner's: the board owner is a setting, so the tests set it.
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

let isPool: typeof import('../app/utils/rollup.ts').isPool
let activeSteps: typeof import('../app/utils/rollup.ts').activeSteps
let rollupWorkState: typeof import('../app/utils/rollup.ts').rollupWorkState
let primaryStep: typeof import('../app/utils/rollup.ts').primaryStep
let stepHeldBy: typeof import('../app/utils/rollup.ts').stepHeldBy
let noReplyHours: typeof import('../app/utils/rollup.ts').noReplyHours
before(async () => {
  ({ isPool, activeSteps, rollupWorkState, primaryStep, stepHeldBy, noReplyHours } = await import('../app/utils/rollup.ts'))
})

const task = (over: object = {}) =>
  ({ task_id: 'TSK-1', work_state: 'backlog', escalation: 'none', internal_verification: 'none', macro_verification: 'none', ...over }) as never
const step = (over: object = {}) =>
  ({ step_id: 'STP-1', task_id: 'TSK-1', step_no: 1, role: 'builder', step_state: 'awaiting_pull', cancelled: false, ...over }) as never

test('isPool: false for null, undefined and empty string, true for pool:builder', () => {
  assert.equal(isPool(null), false)
  assert.equal(isPool(undefined), false)
  assert.equal(isPool(''), false)
  assert.equal(isPool('pool:builder'), true)
})

test('activeSteps: drops cancelled steps', () => {
  const kept = step({ step_id: 'A', role: 'architect' })
  const gone = step({ step_id: 'B', role: 'builder', cancelled: true })
  assert.deepEqual(activeSteps([kept, gone]), [kept])
})

test('activeSteps: drops a step replaced by a later step for the same role', () => {
  const old = step({ step_id: 'OLD', step_no: 1, step_state: 'needs_input' })
  const next = step({ step_id: 'NEW', step_no: 2 })
  assert.deepEqual(activeSteps([old, next]), [next])
})

test('activeSteps: keeps a step with no role', () => {
  const noRole = step({ step_id: 'R', role: '' })
  const later = step({ step_id: 'L', step_no: 2, role: 'builder' })
  assert.deepEqual(activeSteps([noRole, later]), [noRole, later])
})

test('rollupWorkState: needs_input wins over failed', () => {
  const steps = [step({ step_no: 1, role: 'architect', step_state: 'failed' }), step({ step_no: 2, step_state: 'needs_input' })]
  assert.equal(rollupWorkState(task(), steps), 'needs_input')
})

test('rollupWorkState: a failed step blocks the card', () => {
  assert.equal(rollupWorkState(task(), [step({ step_state: 'failed' })]), 'blocked')
})

test('rollupWorkState: an escalation blocks the card', () => {
  assert.equal(rollupWorkState(task({ escalation: 'orchestrator' }), [step()]), 'blocked')
})

test('rollupWorkState: a dispatched step is in_progress', () => {
  assert.equal(rollupWorkState(task(), [step({ step_state: 'dispatched' })]), 'in_progress')
})

test('rollupWorkState: verifying when all required steps are finished', () => {
  const steps = [step({ step_no: 1, role: 'architect', step_state: 'verified' }), step({ step_no: 2, step_state: 'served' })]
  assert.equal(rollupWorkState(task(), steps), 'verifying')
})

test('rollupWorkState: an unfinished optional step does not hold back verifying', () => {
  const roles = [{ role: 'builder', required: true }, { role: 'reviewer', required: false }]
  const steps = [step({ step_state: 'served' }), step({ step_no: 2, role: 'reviewer', step_state: 'awaiting_pull' })]
  assert.equal(rollupWorkState(task(), steps, roles), 'verifying')
})

test('rollupWorkState: awaiting_start when a required step is still waiting', () => {
  const steps = [step({ step_no: 1, role: 'architect', step_state: 'served' }), step({ step_no: 2, step_state: 'awaiting_pull' })]
  assert.equal(rollupWorkState(task(), steps), 'awaiting_start')
})

test('rollupWorkState: done when both verifications pass', () => {
  const t = task({ internal_verification: 'pass', macro_verification: 'pass' })
  assert.equal(rollupWorkState(t, [step({ step_state: 'failed' })]), 'done')
})

test('rollupWorkState: one passing verification is not done', () => {
  const t = task({ internal_verification: 'pass', macro_verification: 'none' })
  assert.equal(rollupWorkState(t, [step({ step_state: 'served' })]), 'verifying')
})

test('rollupWorkState: with no active steps the stored work_state stands', () => {
  assert.equal(rollupWorkState(task({ work_state: 'backlog' }), []), 'backlog')
  assert.equal(rollupWorkState(task({ work_state: 'blocked' }), [step({ cancelled: true })]), 'blocked')
})

test('primaryStep: needs_input, then failed, dispatched, waiting, finished', () => {
  const order = ['needs_input', 'failed', 'dispatched', 'awaiting_pull', 'served']
  // Distinct roles and a rising step_no, so the order comes from priority and not from the tie-break.
  const steps = order.map((state, i) => step({ step_id: state, step_no: i + 1, role: `r${i}`, step_state: state }))
  for (let i = 0; i < order.length; i++) {
    const rest = steps.slice(i)
    assert.equal((primaryStep(rest) as { step_id: string }).step_id, order[i])
  }
})

test('primaryStep: a waiting step ranks above a finished one', () => {
  const waiting = step({ step_id: 'W', step_no: 1, role: 'a', step_state: 'awaiting_start' })
  const done = step({ step_id: 'D', step_no: 2, role: 'b', step_state: 'verified' })
  assert.equal((primaryStep([done, waiting]) as { step_id: string }).step_id, 'W')
})

test('primaryStep: ties go to the latest step_no', () => {
  const a = step({ step_id: 'A', step_no: 1, role: 'a', step_state: 'served' })
  const b = step({ step_id: 'B', step_no: 3, role: 'b', step_state: 'served' })
  const c = step({ step_id: 'C', step_no: 2, role: 'c', step_state: 'served' })
  assert.equal((primaryStep([a, b, c]) as { step_id: string }).step_id, 'B')
})

test('primaryStep: null with no active steps', () => {
  assert.equal(primaryStep([]), null)
  assert.equal(primaryStep([step({ cancelled: true })]), null)
})

test('stepHeldBy: names the holder when a Build card is assigned to one agent and its open step is another\'s', () => {
  const held = step({ assignee: 'agt-claude-code-macbook' })
  assert.equal(stepHeldBy(task({ assignee: 'agt-api-anthropic' }), 'build', held), 'agt-claude-code-macbook')
})

test('stepHeldBy: quiet when the assignee holds the step', () => {
  assert.equal(stepHeldBy(task({ assignee: 'agt-api-anthropic' }), 'build', step({ assignee: 'agt-api-anthropic' })), '')
})

test('stepHeldBy: quiet outside Build, with no step, or with a finished step', () => {
  const held = step({ assignee: 'agt-claude-code-macbook' })
  assert.equal(stepHeldBy(task({ assignee: 'agt-api-anthropic' }), 'architecture', held), '')
  assert.equal(stepHeldBy(task({ assignee: 'agt-api-anthropic' }), 'build', null), '')
  assert.equal(stepHeldBy(task({ assignee: 'agt-api-anthropic' }), 'build', step({ assignee: 'agt-claude-code-macbook', step_state: 'served' })), '')
})

test('stepHeldBy: quiet when the card or the step is unassigned or on a pool', () => {
  const held = step({ assignee: 'agt-claude-code-macbook' })
  assert.equal(stepHeldBy(task({ assignee: '' }), 'build', held), '')
  assert.equal(stepHeldBy(task({ assignee: 'pool:builder' }), 'build', held), '')
  assert.equal(stepHeldBy(task({ assignee: 'agt-api-anthropic' }), 'build', step({ assignee: 'pool:builder' })), '')
  assert.equal(stepHeldBy(task({ assignee: 'agt-api-anthropic' }), 'build', step({ assignee: '' })), '')
})

test('noReplyHours: 0 with no message, or inside the threshold (4 h hosted, 24 h laptop)', () => {
  const now = Date.parse('2026-10-28T12:00:00Z')
  const sent = (at: string) => step({ role: 'chat', created_at: at })
  assert.equal(noReplyHours(null, true, now), 0)
  assert.equal(noReplyHours(sent('2026-10-28T08:30:00Z'), true, now), 0)
  assert.equal(noReplyHours(sent('2026-10-27T12:30:00Z'), false, now), 0)
})

test('noReplyHours: whole hours waited once the threshold passes', () => {
  const now = Date.parse('2026-10-28T12:00:00Z')
  const sent = (at: string) => step({ role: 'chat', created_at: at })
  assert.equal(noReplyHours(sent('2026-10-28T08:00:00Z'), true, now), 4)
  assert.equal(noReplyHours(sent('2026-10-28T06:30:00Z'), true, now), 5)
  assert.equal(noReplyHours(sent('2026-10-27T12:00:00Z'), false, now), 24)
})
