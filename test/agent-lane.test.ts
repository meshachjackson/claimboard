// The class rule and lane labels in app/utils/agentLane.ts (sections 5 and 7).
// Agents are plain objects built here. Run with `pnpm test`.
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

let laneOf: typeof import('../app/utils/agentLane.ts').laneOf
let classMismatch: typeof import('../app/utils/agentLane.ts').classMismatch
let pickerLabel: typeof import('../app/utils/agentLane.ts').pickerLabel
before(async () => {
  ({ laneOf, classMismatch, pickerLabel } = await import('../app/utils/agentLane.ts'))
})

const agent = (over: object = {}) => ({ agent_id: 'agt-x', name: 'X', runtime: 'n8n_cloud', deploy_ref: '', classes: [], ...over }) as never
const api = agent({ deploy_ref: 'gw.api-run', classes: ['general'] })
const codex = agent({ runtime: 'local_harness', classes: ['general', 'personal'] })
const claudeCode = agent({ runtime: 'local_harness' }) // no class rows: not scoped

test('lane: API by deploy_ref, Harness by runtime, otherwise none', () => {
  assert.equal(laneOf(api), 'api')
  assert.equal(laneOf(codex), 'harness')
  assert.equal(laneOf(agent()), null)
  assert.equal(laneOf(undefined), null)
})

test('an API agent beats the harness runtime when both are set', () => {
  assert.equal(laneOf(agent({ deploy_ref: 'gw.api-run', runtime: 'local_harness' })), 'api')
})

test('API agent runs a class-general card', () => {
  assert.equal(classMismatch(['class-general'], api), '')
  assert.equal(classMismatch(['urgent', 'class-general'], api), '')
})

test('API agent will not run a personal card, and says why', () => {
  assert.equal(classMismatch(['class-personal'], api), 'Will not run: needs class-personal, agent holds only general')
})

test('API agent will not run a card with no class tag', () => {
  assert.match(classMismatch([], api), /^Will not run: no class tag on the card .*agent holds only general$/)
  assert.match(classMismatch(['urgent'], api), /no class tag/)
})

test('an API agent holds general even when its class row is not read back yet', () => {
  const bare = agent({ deploy_ref: 'gw.api-run', classes: [] })
  assert.equal(classMismatch(['class-general'], bare), '')
  assert.match(classMismatch(['class-catalyst'], bare), /needs class-catalyst, agent holds only general/)
})

test('a harness holding general and personal runs both, refuses catalyst', () => {
  assert.equal(classMismatch(['class-personal'], codex), '')
  assert.equal(classMismatch(['class-general'], codex), '')
  assert.equal(classMismatch(['class-catalyst'], codex), 'Will not run: needs class-catalyst, agent holds only general, personal')
})

test('a card with several classes needs all of them, minus general', () => {
  assert.equal(classMismatch(['class-general', 'class-personal'], codex), '')
  assert.match(classMismatch(['class-personal', 'class-fj'], codex), /needs class-fj,/)
})

test('a scoped agent that lacks general still takes a general card', () => {
  const catalystOnly = agent({ runtime: 'local_harness', classes: ['catalyst'] })
  assert.equal(classMismatch(['class-general'], catalystOnly), '')
  assert.equal(classMismatch(['class-catalyst'], catalystOnly), '')
  assert.match(classMismatch(['class-personal'], catalystOnly), /agent holds only catalyst/)
})

test('an agent with no class rows is not scoped: any card passes, tagged or not', () => {
  assert.equal(classMismatch(['class-personal'], claudeCode), '')
  assert.equal(classMismatch([], claudeCode), '')
})

test('no agent (unassigned, a pool or a person) gives no warning', () => {
  assert.equal(classMismatch(['class-personal'], undefined), '')
})

test('picker label: lane and classes for API and harness agents, plain name otherwise', () => {
  assert.equal(pickerLabel('API agent', api), 'API agent · API · general')
  assert.equal(pickerLabel('Codex', codex), 'Codex · Harness · general, personal')
  assert.equal(pickerLabel('Claude Code', claudeCode), 'Claude Code · Harness')
  assert.equal(pickerLabel('The orchestrator', agent()), 'The orchestrator')
})
