// Backlog cap (UX Phase 5): capColumn orders by priority then newest, cuts to N, and cuts nothing when short or expanded.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './board-helpers.ts'
const { capColumn, backlogOrder, BACKLOG_CAP } = await import('../app/utils/backlogCap.ts')

let n = 0
// Synthetic Backlog cards: the fixtures hold only a few, so the cap never bites on them.
const card = (priority: string, createdAt: string, pinned = false) => {
  n++
  return { pinned, task: { task_id: `TSK-${String(n).padStart(3, '0')}`, priority, created_at: createdAt } } as never
}
const ids = (cards: { task: { task_id: string } }[]) => cards.map(c => c.task.task_id)

test('the named constant starts at 15', () => assert.equal(BACKLOG_CAP, 15))

test('sorted by priority, then newest first', () => {
  const low = card('low', '2026-11-05T00:00:00Z')
  const oldHigh = card('high', '2026-11-01T00:00:00Z')
  const newHigh = card('high', '2026-11-04T00:00:00Z')
  const urgent = card('urgent', '2026-10-01T00:00:00Z')
  const medium = card('medium', '2026-11-03T00:00:00Z') // a synonym of normal
  assert.deepEqual(ids(backlogOrder([low, oldHigh, newHigh, urgent, medium])), ids([urgent, newHigh, oldHigh, medium, low]))
})

test('free-text priority ranks after the known ones', () => {
  const odd = card('someday', '2026-11-05T00:00:00Z')
  const low = card('low', '2026-10-01T00:00:00Z')
  assert.deepEqual(ids(backlogOrder([odd, low])), ids([low, odd]))
})

test('capped at N, with the rest counted as hidden', () => {
  const cards = Array.from({ length: 20 }, (_, i) => card('normal', `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z`))
  const out = capColumn(cards, 15, false)
  assert.equal(out.cards.length, 15)
  assert.equal(out.hidden, 5)
  assert.equal(out.cards[0]!.task.created_at, '2026-11-20T00:00:00Z') // newest first
})

test('no cap when the length is at most N', () => {
  const cards = [card('low', '2026-11-01T00:00:00Z'), card('high', '2026-11-02T00:00:00Z')]
  assert.deepEqual(capColumn(cards, 2, false), { cards, hidden: 0 })
  assert.deepEqual(capColumn(cards, 15, false), { cards, hidden: 0 })
})

test('expanded returns every card', () => {
  const cards = Array.from({ length: 20 }, () => card('normal', '2026-11-01T00:00:00Z'))
  const out = capColumn(cards, 15, true)
  assert.equal(out.cards.length, 20)
  assert.equal(out.hidden, 0)
})
