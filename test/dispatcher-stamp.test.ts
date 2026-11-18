// The Nudge dispatcher stamp: the button writes it, board-run reads it from /api/agent/dispatch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nudgeDispatcher, nudgeStamp } from '../server/utils/dispatcher.ts'

test('nudge stamp: starts at 0 and a nudge moves it to a later time that the next read returns', async () => {
  assert.equal(await nudgeStamp(), 0)
  const before = Date.now()
  const stamp = await nudgeDispatcher()
  assert.ok(stamp >= before)
  assert.equal(await nudgeStamp(), stamp)
})
