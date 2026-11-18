// The orchestrator feature flag (shared/features.ts): off by default, on for an instance that sets NUXT_PUBLIC_FEATURE_ORCHESTRATOR.
// Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentInstructionsFor, agentToolsFor, featureOn, isConnectorPath, isOrchestratorOp } from '../shared/features.ts'

test('the flag is off unless it is set to a true value', () => {
  assert.equal(featureOn(undefined), false)
  assert.equal(featureOn(''), false)
  assert.equal(featureOn(false), false)
  assert.equal(featureOn('false'), false)
  assert.equal(featureOn(0), false)
  assert.equal(featureOn(true), true)
  assert.equal(featureOn('true'), true)
  assert.equal(featureOn(1), true)
  assert.equal(featureOn('1'), true)
})

const tools = ['vera_brief', 'create', 'comment', 'list_claimable', 'get_task', 'ask_vera', 'vera_reply'].map(name => ({ name }))

test('with the flag off, /mcp lists no ask tools', () => {
  const names = agentToolsFor(tools, false).map(t => t.name)
  assert.equal(names.includes('ask_vera'), false)
  assert.equal(names.includes('vera_reply'), false)
  assert.deepEqual(names, ['vera_brief', 'create', 'comment', 'list_claimable', 'get_task'])
})

test('with the flag on, /mcp lists every tool unchanged', () => {
  assert.deepEqual(agentToolsFor(tools, true), tools)
})

test('with the flag off, the instructions drop the line that names ask_vera', () => {
  const lines = ['Verbs: create, claim.', 'To get the answer now, use ask_vera.']
  assert.equal(agentInstructionsFor(lines, false), 'Verbs: create, claim.')
  assert.equal(agentInstructionsFor(lines, true), lines.join('\n'))
})

test('the ask ops are the ones refused with the flag off', () => {
  assert.equal(isOrchestratorOp('ask_vera'), true)
  assert.equal(isOrchestratorOp('vera_reply'), true)
  assert.equal(isOrchestratorOp('vera_brief'), false)
  assert.equal(isOrchestratorOp('claim_step'), false)
})

test('the connector routes are matched, the agent contract is not', () => {
  for (const p of ['/oauth/token', '/oauth/register', '/oauth/authorize', '/api/oauth/consent', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp']) {
    assert.equal(isConnectorPath(p), true, p)
  }
  for (const p of ['/mcp', '/api/agent/claim_step', '/api/board', '/orchestrator', '/']) {
    assert.equal(isConnectorPath(p), false, p)
  }
})
