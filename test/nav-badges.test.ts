// The nav badges never show a false count: a dash until the board loads, and a label saying what each one counts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { NAV_BADGE_WHAT, navBadgeLabel, navBadgeText } from '../app/types/board.ts'

test('badge text is a dash until the board has loaded, even for a zero count', () => {
  assert.equal(navBadgeText(0, false), '–')
  assert.equal(navBadgeText(7, false), '–')
})

test('badge text is the count once loaded, and empty for zero', () => {
  assert.equal(navBadgeText(7, true), '7')
  assert.equal(navBadgeText(0, true), '')
})

test('each of the four badges says what it counts', () => {
  assert.deepEqual(Object.keys(NAV_BADGE_WHAT), ['Floor', 'Board', 'Agents', 'Shipped'])
  assert.equal(navBadgeLabel('Floor', 3, true), '3 cards waiting on you')
  assert.equal(navBadgeLabel('Board', 12, true), '12 open cards')
  assert.equal(navBadgeLabel('Agents', 2, true), '2 agents working now')
  assert.equal(navBadgeLabel('Shipped', 5, true), '5 cards shipped today')
  assert.equal(navBadgeLabel('Floor', 3, false), 'Counting cards waiting on you')
})
