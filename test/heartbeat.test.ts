// Heartbeat pacing on the board server (heartbeat.ts). Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quietHeartbeat, QUIET_REASON } from '../server/utils/heartbeat.ts'

const NOW = Date.parse('2026-10-28T18:00:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const AGENT = 'agt-claude-code-macbook'
const step = (extra: Record<string, unknown> = {}) => ({
  step_id: 'STP-930001', assignee: AGENT, activity: 'running tests', heartbeat_at: ago(2), lease_expires_at: ago(-13), ...extra
})
const beat = (activity = 'running tests') => ({ step_id: 'STP-930001', activity, updated_at: 'x' })

test('the same activity within 5 minutes is refused with the gateway\'s own reason', () => {
  assert.equal(quietHeartbeat([step()], beat(), AGENT, NOW), QUIET_REASON)
})

test('a changed activity, or the same one after 5 minutes, goes to the gateway', () => {
  assert.equal(quietHeartbeat([step()], beat('writing the PR'), AGENT, NOW), '')
  assert.equal(quietHeartbeat([step({ heartbeat_at: ago(5) })], beat(), AGENT, NOW), '')
})

test('a first heartbeat (none recorded) goes to the gateway', () => {
  assert.equal(quietHeartbeat([step({ heartbeat_at: null })], beat(), AGENT, NOW), '')
})

test('another agent\'s step, an expired lease, an unknown step or an unknown caller go to the gateway', () => {
  assert.equal(quietHeartbeat([step({ assignee: 'agt-codex-macbook' })], beat(), AGENT, NOW), '')
  assert.equal(quietHeartbeat([step({ lease_expires_at: ago(1) })], beat(), AGENT, NOW), '')
  assert.equal(quietHeartbeat([step({ lease_expires_at: null })], beat(), AGENT, NOW), '')
  assert.equal(quietHeartbeat([], beat(), AGENT, NOW), '')
  assert.equal(quietHeartbeat([step()], beat(), '', NOW), '')
})
