// The verb set: verbs map onto today's wire ops, and every old op name still works as itself.
// shared/verbs.ts is pure. agentOps.ts and the owner route use Nuxt auto-imports, so those are checked by reading their source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OWNER_OPS, AGENT_WRITE_OPS, AGENT_READ_OPS, ASK_OPS, PROPOSED_OPS } from '../app/types/board.ts'
import { VERBS, GATED_VERBS, VERB_TABLE, KEPT_OWNER_OPS, resolveOp } from '../shared/verbs.ts'
import { DOOR_OPS } from '../server/utils/door.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const owner = OWNER_OPS as readonly string[]
const agentWrite = AGENT_WRITE_OPS as readonly string[]

test('the table has the ten verbs, split, and the three gated ones', () => {
  assert.deepEqual([...VERBS], ['create', 'assign', 'claim', 'heartbeat', 'comment', 'complete', 'block', 'request_review', 'request_changes', 'archive', 'split'])
  assert.deepEqual([...GATED_VERBS], ['approve', 'publish', 'switch'])
  assert.deepEqual(Object.keys(VERB_TABLE).sort(), [...VERBS, ...GATED_VERBS].sort())
})

test('every op a verb can run is a real wire op for that caller', () => {
  for (const [verb, row] of Object.entries(VERB_TABLE)) {
    for (const op of row.owner) assert.ok(owner.includes(op), `${verb} -> ${op} is not an owner op`)
    for (const op of row.agent) assert.ok(agentWrite.includes(op), `${verb} -> ${op} is not an agent write op`)
  }
})

test('every legacy op name resolves to itself for the caller that could use it (aliases)', () => {
  // `assign` and `heartbeat` are verbs too; an owner never had heartbeat and an agent never had assign, so those stay refused as before.
  const cases: [string, 'owner' | 'agent'][] = [
    ...[...OWNER_OPS, ...PROPOSED_OPS].map(op => [op, 'owner'] as [string, 'owner']),
    ...[...AGENT_WRITE_OPS, ...AGENT_READ_OPS, ...ASK_OPS].map(op => [op, 'agent'] as [string, 'agent'])
  ]
  for (const [op, caller] of cases) {
    const args = { step_id: 'STP-1', body: 'x' }
    const r = resolveOp(op, args, caller)
    assert.ok(r.ok && r.op === op, `${op} (${caller}) must keep its name`)
    assert.deepEqual(r.ok && r.args, args, `${op} (${caller}) must keep its args`)
  }
})

test('approve, publish and switch are owner-only', () => {
  assert.deepEqual(resolveOp('approve', {}, 'owner'), { ok: true, op: 'approve_plan', args: {} })
  assert.deepEqual(resolveOp('approve', { of: 'task', task_id: 'TSK-1' }, 'owner'), { ok: true, op: 'approve_task', args: { task_id: 'TSK-1' } })
  assert.equal((resolveOp('publish', {}, 'owner') as { op: string }).op, 'publish_task')
  assert.equal((resolveOp('switch', {}, 'owner') as { op: string }).op, 'set_switch')
  for (const verb of GATED_VERBS) {
    const r = resolveOp(verb, {}, 'agent')
    assert.equal(r.ok, false)
    assert.match((r as { reason: string }).reason, /owner only/)
    assert.deepEqual(VERB_TABLE[verb].agent, [])
  }
  // The wire ops behind them are not agent ops either.
  for (const op of ['approve_plan', 'approve_task', 'publish_task', 'set_switch']) assert.ok(!agentWrite.includes(op))
})

test('agent verbs resolve to the wire op an agent calls today', () => {
  assert.equal((resolveOp('create', { title: 't' }, 'agent') as { op: string }).op, 'create_task')
  assert.equal((resolveOp('claim', {}, 'agent') as { op: string }).op, 'claim_step')
  assert.equal((resolveOp('heartbeat', {}, 'agent') as { op: string }).op, 'heartbeat')
  assert.equal((resolveOp('comment', { step_id: 'STP-1', body: 'b' }, 'agent') as { op: string }).op, 'add_note')
  assert.equal((resolveOp('comment', { task_id: 'TSK-1', body: 'b' }, 'agent') as { op: string }).op, 'message_agent')
  assert.deepEqual(resolveOp('complete', { step_id: 'STP-1', verdict: 'PASS' }, 'agent'), { ok: true, op: 'complete_step', args: { step_id: 'STP-1', verdict: 'PASS', step_state: 'served' } })
})

test('block asks a question by default, fails on request, and hold keeps the step', () => {
  assert.deepEqual(resolveOp('block', { step_id: 'STP-1', reason: '[needs_input] which repo?' }, 'agent'),
    { ok: true, op: 'complete_step', args: { step_id: 'STP-1', stop_reason: '[needs_input] which repo?', step_state: 'needs_input' } })
  assert.equal((resolveOp('block', { step_state: 'failed', reason: '[capability] no key' }, 'agent') as { args: Record<string, string> }).args.step_state, 'failed')
  const held = resolveOp('block', { step_id: 'STP-1', reason: '[transient] rate limit', hold: true }, 'agent') as { op: string, args: Record<string, unknown> }
  assert.equal(held.op, 'update_step')
  assert.equal('hold' in held.args, false)
})

test('request_review serves the step with a verdict and the summary', () => {
  assert.deepEqual(resolveOp('request_review', { step_id: 'STP-1', summary: 'look at the diff' }, 'agent'),
    { ok: true, op: 'complete_step', args: { step_id: 'STP-1', output_summary: 'look at the diff', step_state: 'served', verdict: 'PASS' } })
})

test('owner verbs: assign, request_changes, archive, complete, comment', () => {
  const op = (name: string, args = {}) => (resolveOp(name, args, 'owner') as { op: string }).op
  assert.equal(op('assign'), 'assign')
  assert.equal(op('request_changes'), 'send_back')
  assert.equal(op('archive'), 'archive_task')
  assert.equal(op('complete'), 'done_no_steps')
  assert.equal(op('comment', { task_id: 'TSK-1', body: 'hi' }), 'message_agent')
  assert.equal(op('comment', { step_id: 'STP-1', body: 'hi' }), 'add_note')
  assert.equal(op('comment', { step_id: 'STP-1', body: 'hi', reply: true }), 'reply')
})

test('verbs with no op for a caller are refused, not guessed', () => {
  for (const verb of ['claim', 'heartbeat', 'block', 'request_review']) assert.equal(resolveOp(verb, {}, 'owner').ok, false)
  for (const verb of ['assign', 'request_changes', 'archive']) assert.equal(resolveOp(verb, {}, 'agent').ok, false)
})

test('every owner op is either behind a verb or listed as kept', () => {
  const behind = new Set(Object.values(VERB_TABLE).flatMap(r => r.owner))
  const missing = owner.filter(op => !behind.has(op) && !(KEPT_OWNER_OPS as readonly string[]).includes(op))
  assert.deepEqual(missing, [])
})

test('the MCP write tools are verbs, and gated verbs are not tools', () => {
  const src = read('server/utils/agentOps.ts')
  const tools = src.slice(src.indexOf('export const AGENT_TOOLS'))
  const names = [...tools.matchAll(/^ {4}name: '(\w+)'/gm)].map(m => m[1]!)
  const reads = ['vera_brief', 'board_report', 'board_activity', 'board_errors', 'list_claimable', 'get_task']
  assert.deepEqual(names.filter(n => !reads.includes(n)), ['create', 'claim', 'heartbeat', 'comment', 'complete', 'block', 'request_review', 'split'])
  for (const verb of GATED_VERBS) assert.ok(!names.includes(verb))
  for (const name of names) assert.ok(!(AGENT_WRITE_OPS as readonly string[]).includes(name) || name === 'heartbeat', `${name} is an old op name, not a verb`)
})

test('each MCP tool has a one-line description of short', () => {
  const src = read('server/utils/agentOps.ts')
  const tools = src.slice(src.indexOf('export const AGENT_TOOLS'))
  const descriptions = [...tools.matchAll(/^ {4}description: (.*)$/gm)].map(m => m[1]!)
  assert.ok(descriptions.length >= 12)
  for (const d of descriptions) assert.ok(d.length <= 400, `too long (${d.length}): ${d.slice(0, 60)}`)
})

test('both entry points resolve verbs before they check anything', () => {
  assert.equal((read('server/utils/agentOps.ts').match(/resolveOp\(/g) ?? []).length, 1)
  assert.equal((read('server/api/board/[op].post.ts').match(/resolveOp\(/g) ?? []).length, 1)
  assert.match(read('server/routes/mcp.ts'), /resolveOp\(/)
})

test('a door is checked on the wire op, so an alias cannot widen it', () => {
  const allowed = (name: string, args = {}) => { const r = resolveOp(name, args, 'agent'); return r.ok && (DOOR_OPS as readonly string[]).includes(r.op) }
  assert.ok(allowed('comment', { task_id: 'TSK-1', body: 'hi' }))
  assert.ok(allowed('message_agent'))
  assert.ok(allowed('get_task'))
  assert.ok(!allowed('comment', { step_id: 'STP-1', body: 'hi' }))
  assert.ok(!allowed('add_note'))
  assert.ok(!allowed('claim'))
  assert.ok(!allowed('create'))
})
