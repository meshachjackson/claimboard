// Plain-language explanations in app/utils/explain.ts: blocked reasons, questions, waiting, agent profiles, assignee hints.
// Rows are plain objects built here. Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))

let explainCard: typeof import('../app/utils/explain.ts').explainCard
let assignHint: typeof import('../app/utils/explain.ts').assignHint
let agentProfile: typeof import('../app/utils/explain.ts').agentProfile
let deliveryText: typeof import('../app/utils/explain.ts').deliveryText
let columns: never[]
before(async () => {
  ({ explainCard, assignHint, agentProfile, deliveryText } = await import('../app/utils/explain.ts'))
  columns = (await import('../mock/board_columns.json', { with: { type: 'json' } })).default as never[]
})

const agent = (over: object = {}) =>
  ({ agent_id: 'agt-x', name: 'Xavier', description: 'Does things', lifecycle_status: 'active', runtime: 'n8n_cloud', host: 'hosted', agent_type: 'builder', reachability: null, request_types: '', ...over }) as never
const task = (over: object = {}) =>
  ({ task_id: 'TSK-1', assignee: 'agt-x', escalation: 'none', tags: '', ...over }) as never
const step = (over: object = {}) =>
  ({ step_id: 'STP-1', task_id: 'TSK-1', step_no: 1, role: 'builder', assignee: 'agt-x', step_state: 'awaiting_pull', cancelled: false, ...over }) as never
const names: Record<string, string> = { 'agt-x': 'Xavier', 'agt-y': 'Yolanda' }
const nameOf = (id: string) => names[id] ?? id
const input = (over: object = {}) =>
  ({ task: task(), stage: 'build', workState: 'blocked', primary: null, allSteps: [], needsApproval: false, noReply: null, classWarning: '', ...over }) as never
const ctx = (registry = [agent()]) => ({ registry, nameOf })

test('blocked by a failed step: quotes the reason and says nothing retries', () => {
  const failed = step({ step_state: 'failed', stop_reason: 'Could not reach the gateway' })
  const e = explainCard(input({ primary: failed, allSteps: [failed] }), ctx())!
  assert.match(e.detail, /Could not reach the gateway/)
  assert.match(e.detail, /retries a failed build step once/)
  assert.ok(e.options.some(o => o.includes('Restart')))
})

test('blocked by a cancelled step: names the step with its role and agent, and how to run it again', () => {
  const cancelled = step({ step_id: 'STP-9185', cancelled: true })
  const e = explainCard(input({ task: task({ escalation: 'STP-9185 cancelled' }), allSteps: [cancelled] }), ctx())!
  assert.match(e.detail, /STP-9185 \(builder, Xavier\) was cancelled/)
  assert.match(e.options[0]!, /new step for Xavier/)
  assert.match(e.short, /cancelled/)
})

test('blocked by a blank verdict: says the board cannot tell if the work is good', () => {
  const served = step({ step_id: 'STP-9137', step_state: 'served' })
  const e = explainCard(input({ task: task({ escalation: 'STP-9137 verdict blank' }), primary: served, allSteps: [served] }), ctx())!
  assert.match(e.headline, /no verdict/)
  assert.match(e.detail, /cannot tell/)
  assert.match(e.options[2]!, /new step for Xavier/)
})

test('blocked with an unknown escalation text still shows it', () => {
  const e = explainCard(input({ task: task({ escalation: 'budget exhausted' }) }), ctx())!
  assert.match(e.detail, /budget exhausted/)
})

test('a card with an approve button is not explained while it needs input', () => {
  assert.equal(explainCard(input({ workState: 'needs_input', needsApproval: true }), ctx()), null)
})

test('needs input with a question: tells him to reply, and that a note does not wake the agent', () => {
  const asked = step({ step_state: 'needs_input' })
  const e = explainCard(input({ workState: 'needs_input', primary: asked }), ctx())!
  assert.match(e.options.join(' '), /new step/)
  assert.match(e.options.join(' '), /does not wake/)
})

test('needs input with no question step: still says what to do, without calling anyone Unassigned', () => {
  const e = explainCard(input({ workState: 'needs_input', primary: null }), ctx())!
  assert.match(e.headline, /waiting for your answer/)
  assert.doesNotMatch(e.headline + e.detail, /Unassigned/)
})

test('no reply: a hosted agent can be woken, a laptop agent cannot', () => {
  const hosted = agent({ agent_id: 'agt-orchestrator', name: 'The orchestrator', agent_type: null })
  const wake = explainCard(input({ workState: 'needs_input', noReply: { agent: 'agt-orchestrator', hours: 5 } }), ctx([hosted]))!
  assert.match(wake.options[0]!, /Respond now/)
  const laptop = agent({ reachability: 'unreachable_when_asleep', host: 'laptop', runtime: 'local_harness' })
  const wait = explainCard(input({ workState: 'needs_input', noReply: { agent: 'agt-x', hours: 30 } }), ctx([laptop]))!
  assert.match(wait.detail, /laptop is awake|session is open/)
  assert.match(wait.options[0]!, /cannot be woken/)
})

test('an open pool step with no agent in service says nothing will pick it up', () => {
  const open = step({ assignee: 'pool:builder' })
  const e = explainCard(input({ workState: 'awaiting_start', primary: open }), ctx([agent({ lifecycle_status: 'in_development' })]))!
  assert.match(e.detail, /Nothing will pick this up/)
})

test('an open pool step names the agents that can take it', () => {
  const open = step({ assignee: 'pool:builder' })
  const e = explainCard(input({ workState: 'awaiting_start', primary: open }), ctx())!
  assert.match(e.detail, /Xavier/)
})

test('a class warning explains why the card will not run', () => {
  const e = explainCard(input({ workState: 'awaiting_start', primary: step(), classWarning: 'Will not run: needs class-fj' }), ctx())!
  assert.match(e.detail, /needs class-fj/)
})

test('done cards get no explanation', () => {
  assert.equal(explainCard(input({ workState: 'done' }), ctx()), null)
})

test('assignHint: an open step is not handed over by a new assignee', () => {
  const open = step({ step_state: 'dispatched' })
  const hint = assignHint({ task: task(), stage: 'build', workState: 'in_progress', primary: open }, nameOf)
  assert.match(hint, /Does not change the builder already open for Xavier/)
  assert.match(hint, /cancel that step/)
})

test('assignHint: backlog, review and done each say when it takes effect', () => {
  const base = { task: task(), workState: 'awaiting_start', primary: null } as never
  assert.match(assignHint({ ...base as object, stage: 'backlog' } as never, nameOf), /move the card to Architecture or Build/)
  assert.match(assignHint({ ...base as object, stage: 'review' } as never, nameOf), /back to Build/)
  assert.match(assignHint({ ...base as object, stage: 'done', workState: 'done' } as never, nameOf), /cannot be reassigned/)
})

test('agentProfile: a builder takes Build work; an agent with no type is in no pool', () => {
  const builder = agentProfile(agent({ request_types: 'draft_workflow,board_reply' }), columns)
  assert.deepEqual(builder.takes, ['Build: Builds it'])
  assert.deepEqual(builder.does, ['Draft an n8n workflow', 'Answer messages on a card'])
  assert.equal(builder.messages, 'Answers messages on its cards.')
  const untyped = agentProfile(agent({ agent_id: 'agt-claude', agent_type: '' }), columns)
  assert.deepEqual(untyped.takes, [])
  assert.match(untyped.noPool, /only when you name it/)
})

test('agentProfile: an advisor takes Architecture, and optional Build and Review roles', () => {
  const advisor = agentProfile(agent({ agent_type: 'advisor' }), columns)
  assert.deepEqual(advisor.takes, [
    'Architecture: Plans the work',
    'Build: Gives a second opinion (optional)',
    'Review: Checks the result (optional)'
  ])
})

test('deliveryText: says how each kind of agent gets work', () => {
  assert.match(deliveryText(agent({ lifecycle_status: 'in_development' })), /Not in service/)
  assert.match(deliveryText(agent({ reachability: 'outbound_only', host: 'laptop' })), /Cannot be woken/)
  assert.match(deliveryText(agent({ reachability: 'outbound_only', host: '', wakes: true })), /Starts on its own/)
  assert.match(deliveryText(agent({ reachability: 'outbound_only', host: 'laptop', wakes: false })), /Cannot be woken/)
  assert.match(deliveryText(agent({ runtime: 'local_harness', host: 'laptop' })), /coding session/)
  assert.match(deliveryText(agent({ agent_type: null, runtime: 'n8n_local', host: null })), /no agent type/)
  assert.match(deliveryText(agent()), /Respond now/)
})

test('an open pool step whose agents are all switched off says so and offers the switch', () => {
  const open = step({ assignee: 'pool:builder' })
  const e = explainCard(input({ workState: 'awaiting_start', primary: open }), ctx([agent({ switch: 'off' })]))!
  assert.match(e.headline, /every one is switched off/)
  assert.match(e.options[0]!, /Settings > Agents/)
})
