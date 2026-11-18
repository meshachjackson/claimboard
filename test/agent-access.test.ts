// Agent-op permission checks in Nuxt against cached gov_access rows (shared/agentAccess.ts). Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classScoped, classesOf, classOk, classRefusal, rolesOf, storeRefusal, STORE_OPS, DOOR_OPS } from '../shared/agentAccess.ts'

const row = (agent_id: string, resource: string, extra: Record<string, unknown> = {}) =>
  ({ access_id: 'acc-9001', agent_id, resource, grade: 'verified', ...extra }) as never
const registry = [
  { agent_id: 'agt-builder', lifecycle_status: 'active' },
  { agent_id: 'agt-old', lifecycle_status: 'retired' },
  { agent_id: 'agt-door-claude', lifecycle_status: 'active' }
]
const access = [row('agt-builder', 'board:role:builder'), row('agt-builder', 'board:role:auditor', { grade: 'rejected' }), row('agt-builder', 'board:role:old', { superseded_by: 'acc-9002' })]

test('an agent missing from gov_registry is refused', () => {
  assert.match(storeRefusal(registry, access, 'agt-ghost', 'heartbeat')!, /not in gov_registry/)
})
test('an inactive agent is refused', () => {
  assert.match(storeRefusal(registry, access, 'agt-old', 'heartbeat')!, /not active/)
})
test('an active agent may run a step op on its own step', () => {
  assert.equal(storeRefusal(registry, access, 'agt-builder', 'heartbeat', { assignee: 'agt-builder' }), null)
})
test('a pool claim needs a board:role row for the step role', () => {
  assert.equal(storeRefusal(registry, access, 'agt-builder', 'claim_step', { assignee: 'pool:builder', role: 'builder' }), null)
  assert.match(storeRefusal(registry, access, 'agt-builder', 'claim_step', { assignee: 'pool:reviewer', role: 'reviewer' })!, /board:role:reviewer/)
})
test('a rejected role row grants nothing', () => {
  assert.match(storeRefusal(registry, access, 'agt-builder', 'claim_step', { assignee: 'pool:auditor', role: 'auditor' })!, /board:role:auditor/)
})
test('a superseded role row grants nothing', () => {
  assert.deepEqual(rolesOf(access, 'agt-builder'), ['builder'])
})
test('a pool step with no role cannot be claimed', () => {
  assert.match(storeRefusal(registry, access, 'agt-builder', 'claim_step', { assignee: 'pool:builder', role: '' })!, /board:role:/)
})
test('a claim of a step assigned by name needs no role row', () => {
  assert.equal(storeRefusal(registry, [], 'agt-builder', 'claim_step', { assignee: 'agt-builder' }), null)
})
test('a door may only ask, read and message', () => {
  assert.match(storeRefusal(registry, access, 'agt-door-claude', 'claim_step')!, /not open to a door/)
  assert.equal(storeRefusal(registry, access, 'agt-door-claude', 'my_steps'), null)
  assert.ok(!(STORE_OPS as readonly string[]).some(o => (DOOR_OPS as readonly string[]).includes(o) && o === 'claim_step'))
})
test('class scoping is read from board:class rows that are still current', () => {
  assert.equal(classScoped([row('agt-x', 'board:class:general')], 'agt-x'), true)
  assert.equal(classScoped([row('agt-x', 'board:class:general', { grade: 'rejected' })], 'agt-x'), false)
  assert.equal(classScoped(access, 'agt-builder'), false)
})

test('classesOf reads current board:class rows, known classes only, sorted', () => {
  const a = [row('agt-x', 'board:class:fj'), row('agt-x', 'board:class:general'), row('agt-x', 'board:class:catalyst', { grade: 'rejected' }),
    row('agt-x', 'board:class:bogus'), row('agt-x', 'board:class:personal', { superseded_by: 'acc-9' }), row('agt-y', 'board:class:personal')]
  assert.deepEqual(classesOf(a, 'agt-x'), ['fj', 'general'])
  assert.deepEqual(classesOf(a, 'agt-none'), [])
})

test('classOk matches plan_board.js: unscoped open, general-only open, other classes need the row, untagged refused', () => {
  assert.equal(classOk([], ''), true) // unscoped agent
  assert.equal(classOk(['personal'], 'class-general'), true)
  assert.equal(classOk(['personal'], 'x, class-personal'), true)
  assert.equal(classOk(['personal'], 'class-catalyst'), false)
  assert.equal(classOk(['personal'], ''), false) // fails closed
  assert.equal(classOk(['general'], 'class-general,class-fj'), false) // general earns nothing on a mixed card
  assert.equal(classOk(['general', 'fj'], 'class-general,class-fj'), true)
  assert.equal(classOk(['fj'], 'CLASS-FJ'), true) // tags are case-folded
})

test('classRefusal names the caller, its classes and the card', () => {
  assert.equal(classRefusal('agt-x', ['fj', 'general'], 'TSK-1', 'class-catalyst'), 'agt-x may read or write only fj, general cards; TSK-1 is catalyst')
  assert.equal(classRefusal('agt-x', ['fj'], 'TSK-2', ''), 'agt-x may read or write only fj cards; TSK-2 has no class tag')
})
