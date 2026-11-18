// The set_switch owner op (n8n holds the agent switches when the gateway has it). Run with `pnpm test`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OP_LABELS, OWNER_OPS, PROPOSED_OPS } from '../app/types/board.ts'

test('set_switch is an owner op, labelled, and proposed so a gateway without it is never called', () => {
  assert.ok((OWNER_OPS as readonly string[]).includes('set_switch'))
  assert.ok((PROPOSED_OPS as readonly string[]).includes('set_switch'))
  assert.equal(OP_LABELS.set_switch, 'Agent switch')
})
