// Compact card red dot: which cards need Meshach.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

let m: typeof import('../app/utils/attention.ts')
before(async () => { m = await import('../app/utils/attention.ts') })

const now = new Date(2026, 10, 3, 12).getTime()
// A quiet card: nothing that needs attention.
const card = (over: Record<string, unknown> = {}, due_at: string | null = null) =>
  ({ task: { due_at }, workState: 'in_progress', approvalPending: false, stranded: '', ...over }) as unknown as Parameters<typeof m.cardNeedsAttention>[0]

test('a quiet card has no dot', () => {
  assert.equal(m.cardNeedsAttention(card(), now), false)
})

test('blocked and needs_input get a dot', () => {
  assert.equal(m.cardNeedsAttention(card({ workState: 'blocked' }), now), true)
  assert.equal(m.cardNeedsAttention(card({ workState: 'needs_input' }), now), true)
})

test('a plan awaiting approval gets a dot', () => {
  assert.equal(m.cardNeedsAttention(card({ approvalPending: true }), now), true)
})

test('a stranded step gets a dot', () => {
  assert.equal(m.cardNeedsAttention(card({ stranded: 'No agent can take it' }), now), true)
})

test('past due gets a dot, due today or later does not', () => {
  assert.equal(m.cardNeedsAttention(card({}, '2026-11-02'), now), true)
  assert.equal(m.cardNeedsAttention(card({}, '2026-11-03'), now), false)
  assert.equal(m.cardNeedsAttention(card({}, '2026-11-10'), now), false)
})

test('a done card past due has no dot', () => {
  assert.equal(m.cardNeedsAttention(card({ workState: 'done' }, '2026-10-01'), now), false)
})
