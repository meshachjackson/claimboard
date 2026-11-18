// scripts/lib/finish-rules.mjs: the finishing-line rules. app/utils/dispatch.ts re-exports them; one copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_NUDGES, MAX_TRANSIENT, BLOCK_KINDS, FINISH_RULES, parseEnd, nudgeText, isTransient } from '../scripts/lib/finish-rules.mjs'

test('parseEnd reads COMPLETE, REVIEW and BLOCKED lines and the old CANNOT PLAN line', () => {
  assert.deepEqual(parseEnd('did it\nCOMPLETE: all done'), { kind: 'complete', summary: 'all done', body: 'did it' })
  assert.equal(parseEnd('REVIEW: look at x').kind, 'review')
  assert.deepEqual(parseEnd('BLOCKED needs_input: which repo?'), { kind: 'block', block: 'needs_input', reason: 'which repo?', body: '' })
  assert.equal(parseEnd('CANNOT PLAN: no spec').kind, 'block')
  assert.deepEqual(parseEnd('no finish line'), { kind: 'none', body: 'no finish line' })
})

test('parseEnd takes the last finishing line and ignores an unknown block kind', () => {
  assert.equal(parseEnd('COMPLETE: a\nBLOCKED dependency: b').kind, 'block')
  assert.equal(parseEnd('BLOCKED nonsense: x').kind, 'none')
  assert.deepEqual([...BLOCK_KINDS], ['needs_input', 'dependency', 'transient', 'capability'])
})

test('nudgeText, FINISH_RULES and the caps', () => {
  assert.equal(MAX_NUDGES, 2)
  assert.equal(MAX_TRANSIENT, 2)
  assert.match(nudgeText(1), /Reminder 1 of 2/)
  assert.ok(FINISH_RULES.some(l => l.includes('COMPLETE:')))
})

test('isTransient spots rate limits and network drops only', () => {
  assert.equal(isTransient('HTTP 429 too many requests'), true)
  assert.equal(isTransient('fetch failed'), true)
  assert.equal(isTransient('syntax error in file'), false)
})

test('dispatch.ts re-exports the same functions, not copies', async () => {
  const d = await import('../app/utils/dispatch.ts')
  assert.equal(d.parseEnd, parseEnd)
  assert.equal(d.nudgeText, nudgeText)
  assert.equal(d.isTransient, isTransient)
  assert.equal(d.FINISH_RULES, FINISH_RULES)
  assert.equal(d.MAX_NUDGES, MAX_NUDGES)
})
