// The agent_handoff token gate is gone: create_task and message_agent follow the normal rules (cutover doc, "Values to keep").
// agentOps.ts needs Nuxt auto-imports, so this checks the source rather than running it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../server/utils/agentOps.ts', import.meta.url), 'utf8')

test('agentOps no longer reads the agent_handoff live-ops token', () => {
  assert.doesNotMatch(src, /agent_handoff|HANDOFF_OPS|handoffLive/)
})

test('agent ops are still gated by the Postgres step store and switches, not by a refusal of "op not live"', () => {
  assert.doesNotMatch(src, /op not live/)
  assert.match(src, /stepStoreHandles\(op\) \|\| op === 'create_task'/)
})
