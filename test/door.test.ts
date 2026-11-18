// Doors: the owner through one Claude account. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDoorId, doorTools, connectorIdentities, askFields, DOOR_INSTRUCTIONS, DOOR_TOOL_NAMES, ASK_TOOLS } from '../server/utils/door.ts'

test('a door id starts agt-door-', () => {
  assert.equal(isDoorId('agt-door-claude-ai-personal'), true)
  assert.equal(isDoorId('agt-claude-ai-personal'), false)
  assert.equal(isDoorId('door-claude-ai-personal'), false)
  assert.equal(isDoorId(undefined), false)
})

test('a door sees only ask, read and message tools, in that order', () => {
  const all = ['vera_brief', 'create', 'comment', 'list_claimable', 'get_task', 'claim', 'ask_vera', 'vera_reply', 'board_report'].map(name => ({ name }))
  assert.deepEqual(doorTools(all).map(t => t.name), ['ask_vera', 'vera_reply', 'vera_brief', 'get_task', 'comment'])
  assert.deepEqual([...DOOR_TOOL_NAMES], ['ask_vera', 'vera_reply', 'vera_brief', 'get_task', 'comment'])
})

test('door instructions say to pass messages and answers word for word (decision 4)', () => {
  assert.match(DOOR_INSTRUCTIONS, /Send every message the owner writes to ask_vera, word for word/)
  assert.match(DOOR_INSTRUCTIONS, /Show the orchestrator's answer word for word/)
  assert.match(DOOR_INSTRUCTIONS, /conversation_id/)
  assert.match(DOOR_INSTRUCTIONS, /vera_reply/)
})

test('ask_vera takes message, task_id, conversation_id; vera_reply takes ref', () => {
  const [ask, reply] = ASK_TOOLS
  assert.equal(ask.name, 'ask_vera')
  assert.deepEqual(Object.keys(ask.inputSchema.properties).sort(), ['conversation_id', 'message', 'task_id'])
  assert.deepEqual([...ask.inputSchema.required], ['message'])
  assert.equal(reply.name, 'vera_reply')
  assert.deepEqual([...reply.inputSchema.required], ['ref'])
})

test('consent lists doors first, then agents; both need active and a class row; type and prefix must agree', () => {
  const registry = [
    { agent_id: 'agt-claude-ai-personal', name: 'Claude (personal)', lifecycle_status: 'active', agent_type: '' },
    { agent_id: 'agt-door-claude-ai-personal', name: 'claude.ai, personal', lifecycle_status: 'active', agent_type: 'door' },
    { agent_id: 'agt-door-retired', name: 'old', lifecycle_status: 'retired', agent_type: 'door' },
    { agent_id: 'agt-door-mistyped', name: 'x', lifecycle_status: 'active', agent_type: 'advisor' },
    { agent_id: 'agt-sneaky', name: 'x', lifecycle_status: 'active', agent_type: 'door' },
    { agent_id: 'agt-no-class', name: 'x', lifecycle_status: 'active', agent_type: '' }
  ]
  const cls = (agent_id: string, c = 'personal', grade = 'verified') => ({ agent_id, resource: `board:class:${c}`, grade })
  const access = [cls('agt-claude-ai-personal'), cls('agt-door-claude-ai-personal'), cls('agt-door-retired'), cls('agt-door-mistyped'), cls('agt-sneaky'), { agent_id: 'agt-no-class', resource: 'board:role:builder', grade: 'verified' }, cls('agt-door-claude-ai-personal', 'catalyst', 'rejected')]
  assert.deepEqual(connectorIdentities(registry, access), [
    { agent_id: 'agt-door-claude-ai-personal', name: 'claude.ai, personal', classes: ['personal'], kind: 'door' },
    { agent_id: 'agt-claude-ai-personal', name: 'Claude (personal)', classes: ['personal'], kind: 'agent' }
  ])
})

test('askFields keeps the gateway answer fields of the right type only', () => {
  assert.deepEqual(askFields({ ok: true, ref: 'ask-1', pending: false, answer: 'Next up: LOOP-930001', status: 'served', ticket_id: 'VER-1', rows: {} }),
    { ref: 'ask-1', pending: false, answer: 'Next up: LOOP-930001', status: 'served', ticket_id: 'VER-1' })
  assert.deepEqual(askFields({ ref: 1, pending: 'no' }), {})
})
