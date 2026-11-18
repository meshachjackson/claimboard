// Card step summary: verified is done, every other step state is open.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

let m: typeof import('../app/utils/steps.ts')
before(async () => { m = await import('../app/utils/steps.ts') })

test('counts done and open across all seven step states', () => {
  const states = ['awaiting_start', 'awaiting_pull', 'dispatched', 'served', 'needs_input', 'failed', 'verified'] as const
  assert.deepEqual(m.stepCounts(states.map(step_state => ({ step_state }))), { done: 1, open: 6 })
})

test('two verified, one working', () => {
  assert.deepEqual(m.stepCounts([{ step_state: 'verified' }, { step_state: 'verified' }, { step_state: 'dispatched' }]), { done: 2, open: 1 })
})

test('no steps gives zero of each', () => {
  assert.deepEqual(m.stepCounts([]), { done: 0, open: 0 })
})
