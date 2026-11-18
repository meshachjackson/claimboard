// The push signal (server/utils/boardEvents.ts). Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { announceBoardChange, changesBoard, onBoardChange } from '../server/utils/boardEvents.ts'

test('only finished board writes count as a change', () => {
  assert.equal(changesBoard('message_agent', true), true)
  assert.equal(changesBoard('claim_step', true), true)
  assert.equal(changesBoard('move_task', true), true)
  assert.equal(changesBoard('claim_step', false), false, 'a refusal changes nothing')
  assert.equal(changesBoard('whoami', true), false)
  assert.equal(changesBoard('my_steps', true), false)
  assert.equal(changesBoard('read_brief', true), false)
})

test('every listener hears a change until it unsubscribes', () => {
  let a = 0
  let b = 0
  const offA = onBoardChange(() => { a++ })
  const offB = onBoardChange(() => { b++ })
  announceBoardChange()
  offA()
  announceBoardChange()
  offB()
  announceBoardChange()
  assert.deepEqual([a, b], [1, 2])
})
