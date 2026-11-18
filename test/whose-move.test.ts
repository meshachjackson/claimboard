// Whose move a card is (app/utils/whoseMove.ts), built against the real cases from the 11/1/2026 audit:
// a stopped card is Meshach's, a Needs-you card with an open message to the orchestrator is the orchestrator's, a queued card is its agent's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
const { whoseMove, waitLabel, unheld, startLabel, noTaker } = await import('../app/utils/whoseMove.ts')

const task = (over: object = {}) => ({ task_id: 'TSK-1', created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-31T10:00:00Z', ...over }) as never
const step = (over: object) => ({ step_id: 'STP-1', assignee: 'agt-orchestrator', step_state: 'awaiting_pull', created_at: '2026-10-31T22:52:00Z', ended_at: '', updated_at: '', heartbeat_at: '', lease_owner: '', ...over }) as never
const card = (over: object) => ({ task: task(), workState: 'awaiting_start', primary: null, chat: null, approvalPending: false, ...over }) as never

test('a stopped card is yours', () => {
  assert.equal(whoseMove(card({ workState: 'blocked' })).mover, 'you')
})

test('Needs you with an open message to the orchestrator is the orchestrator\'s move, not yours (TSK-930228)', () => {
  const m = whoseMove(card({ workState: 'needs_input', chat: step({}) }))
  assert.deepEqual([m.mover, m.agent, m.since], ['agent', 'agt-orchestrator', '2026-10-31T22:52:00Z'])
})

test('an answered message does not hold the card', () => {
  assert.equal(whoseMove(card({ workState: 'blocked', chat: step({ step_state: 'served' }) })).mover, 'you')
})

test('Review and pending approval are yours', () => {
  assert.equal(whoseMove(card({ workState: 'verifying' })).mover, 'you')
  assert.equal(whoseMove(card({ approvalPending: true })).mover, 'you')
})

test('a queued step is its assignee\'s; a claimed one is the lease holder\'s', () => {
  assert.equal(whoseMove(card({ primary: step({ assignee: 'pool:advisor' }) })).agent, 'pool:advisor')
  assert.equal(whoseMove(card({ workState: 'in_progress', primary: step({ assignee: 'pool:builder', step_state: 'dispatched', lease_owner: 'agt-builder-local' }) })).agent, 'agt-builder-local')
})

test('a started card with no open step is yours: nobody will pick it up (TSK-930093)', () => {
  const c = card({ workState: 'awaiting_start', primary: null })
  assert.equal(whoseMove(c).mover, 'you')
  assert.equal(unheld(c), true)
  assert.equal(unheld(card({ workState: 'blocked' })), false)
})

test('backlog is nobody\'s and done is done', () => {
  assert.equal(whoseMove(card({ workState: 'backlog' })).mover, 'nobody')
  assert.equal(whoseMove(card({ workState: 'done' })).mover, 'done')
})

test('wait labels', () => {
  const now = Date.parse('2026-11-01T18:00:00Z')
  assert.equal(waitLabel('2026-11-01T17:30:00Z', now), 'just now')
  assert.equal(waitLabel('2026-10-31T23:00:00Z', now), '19 h')
  assert.equal(waitLabel('2026-10-31T10:00:00Z', now), '1 day')
  assert.equal(waitLabel('2026-10-28T10:00:00Z', now), '4 days')
})

test('Start in Backlog; Restart for a stopped Build card, including one whose last step served a FAIL (TSK-930219)', () => {
  const at = (over: object) => startLabel({ ...card(over), stage: 'build', archived: false, ...over } as never)
  assert.equal(startLabel({ ...card({}), stage: 'backlog', archived: false } as never), 'Start')
  assert.equal(at({ workState: 'blocked', primary: step({ step_state: 'served' }) }), 'Restart')
  assert.equal(at({ workState: 'blocked', primary: step({ step_state: 'failed' }) }), 'Restart')
  assert.equal(at({ workState: 'in_progress', primary: step({ step_state: 'dispatched' }) }), '')
  assert.equal(at({ workState: 'done' }), '')
  assert.equal(at({ workState: 'blocked', archived: true }), '')
  assert.equal(startLabel({ ...card({ workState: 'blocked' }), stage: 'review', archived: false } as never), '')
})

test('no Start while a card waits on an answer or is working; an idle backlog card still gets it', () => {
  const at = (stage: string, over: object) => startLabel({ ...card(over), stage, archived: false } as never)
  assert.equal(at('backlog', { workState: 'needs_input' }), '')
  assert.equal(at('build', { workState: 'needs_input', primary: step({ step_state: 'needs_input' }) }), '')
  assert.equal(at('backlog', { workState: 'in_progress' }), '')
  assert.equal(at('backlog', { workState: 'backlog' }), 'Start')
})

test('a card no agent can take is yours, not Nobody has it; an open message still wins', () => {
  const c = card({ workState: 'awaiting_start', primary: step({ assignee: 'pool:builder' }), stranded: 'No builder agent is in service' })
  assert.equal(whoseMove(c).mover, 'you')
  assert.equal(unheld(c), false)
  assert.equal(whoseMove({ ...c, chat: step({}) }).mover, 'agent')
})

test('noTaker: an empty pool, a switched-off or retired agent, and a class mismatch; nothing for a card someone can take', () => {
  const reg = [
    { agent_id: 'agt-b', name: 'Builder', agent_type: 'builder', lifecycle_status: 'active', switch: 'on' },
    { agent_id: 'agt-off', name: 'Offy', agent_type: 'advisor', lifecycle_status: 'active', switch: 'off' },
    { agent_id: 'agt-old', name: 'Oldie', agent_type: 'advisor', lifecycle_status: 'retired' }
  ] as never
  const at = (assignee: string, over: object = {}) => noTaker({ workState: 'awaiting_start', stage: 'build', archived: false, classWarning: '', primary: step({ assignee }), ...over } as never, reg)
  assert.equal(at('pool:builder'), '')
  assert.equal(at('pool:advisor'), 'Every advisor agent is switched off')
  assert.equal(at('pool:reviewer'), 'No reviewer agent is in service')
  assert.equal(at('agt-off'), 'Offy is switched off')
  assert.equal(at('agt-old'), 'Oldie is not in service')
  assert.equal(at('person:meshach'), '')
  assert.equal(at('agt-b', { classWarning: 'Builder does not hold class personal' }), 'Builder does not hold class personal')
  assert.equal(at('pool:reviewer', { stage: 'backlog' }), '')
  assert.equal(at('pool:advisor', { primary: step({ assignee: 'pool:advisor', step_state: 'dispatched' }) }), '')
})
