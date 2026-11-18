// A message on the orchestrator inbox card goes to the orchestrator, and a message tagged to an agent still goes to that agent.
// Uses the same chatTarget the fixtures-mode gateway stand-in uses. `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import './instance-setup.ts'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))

let chatTarget: typeof import('../app/utils/boardOps.ts').chatTarget
before(async () => {
  ({ chatTarget } = await import('../app/utils/boardOps.ts'))
})

const agent = (agent_id: string) => ({ agent_id, lifecycle_status: 'active', switch: 'on', request_types: 'board_reply' }) as any
const registry = [agent('agt-orchestrator'), agent('agt-claude-code-macbook')]
const inbox = { task_id: 'TSK-900100', assignee: 'agt-orchestrator', tags: 'orchestrator-inbox' } as any

test('the inbox card routes to the orchestrator with no tag', () => {
  assert.equal(chatTarget(inbox, [], registry, 'person:meshach'), 'agt-orchestrator')
})

test('an explicit agent tag on the inbox card still goes to that agent', () => {
  assert.equal(chatTarget(inbox, [], registry, 'person:meshach', 'agt-claude-code-macbook'), 'agt-claude-code-macbook')
})

test('an untagged message on an ordinary card goes to the orchestrator, not the card agent', () => {
  const card = { task_id: 'TSK-900101', assignee: 'agt-claude-code-macbook' } as any
  const open = [{ task_id: 'TSK-900101', step_no: 1, role: 'build', assignee: 'agt-claude-code-macbook', cancelled: false, acked_at: '' }] as any
  assert.equal(chatTarget(card, open, registry, 'person:meshach'), 'agt-orchestrator')
  assert.equal(chatTarget(card, open, registry, 'person:meshach', 'agt-claude-code-macbook'), 'agt-claude-code-macbook')
})

test('a tag for an agent that takes no messages falls back to the orchestrator', () => {
  const card = { task_id: 'TSK-900101', assignee: 'agt-analyst' } as any
  assert.equal(chatTarget(card, [], [...registry, { ...agent('agt-analyst'), request_types: 'draft_workflow' }], 'person:meshach', 'agt-analyst'), 'agt-orchestrator')
})
