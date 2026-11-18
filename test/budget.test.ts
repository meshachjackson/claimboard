// Claude Code's budget_used on complete_step (build order step 4). Run with `pnpm test`.
import './instance-setup.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lacksBudget, withClaudeCodeBudget, NOT_METERED } from '../server/utils/budget.ts'

const CC = 'agt-claude-code-macbook'
const ack = (extra: Record<string, unknown> = {}) => ({ step_id: 'STP-930001', step_state: 'served', updated_at: 'x', ...extra })

test('a served or failed ack with no budget_used lacks one, blank or spaces included', () => {
  assert.equal(lacksBudget(ack()), true)
  assert.equal(lacksBudget(ack({ step_state: 'failed', budget_used: '   ' })), true)
  assert.equal(lacksBudget(ack({ budget_used: 'in 10, out 5 tokens' })), false)
})

test('needs_input needs no budget_used', () => {
  assert.equal(lacksBudget(ack({ step_state: 'needs_input' })), false)
})

test('Claude Code gets the fixed text, which keeps the "attempts N, tokens N" start that the orchestrator parses', () => {
  assert.equal(withClaudeCodeBudget(ack(), CC).budget_used, NOT_METERED)
  assert.match(NOT_METERED, /^attempts 1, tokens 0 \(not metered/)
})

test('Claude Code keeps a budget_used it sends, and a needs_input ack is untouched', () => {
  assert.equal(withClaudeCodeBudget(ack({ budget_used: 'attempts 2, tokens 0' }), CC).budget_used, 'attempts 2, tokens 0')
  assert.equal('budget_used' in withClaudeCodeBudget(ack({ step_state: 'needs_input' }), CC), false)
})

test('another agent gets nothing filled in, so the gateway refuses it', () => {
  assert.equal('budget_used' in withClaudeCodeBudget(ack(), 'agt-builder-local'), false)
  assert.equal('budget_used' in withClaudeCodeBudget(ack(), ''), false)
})
