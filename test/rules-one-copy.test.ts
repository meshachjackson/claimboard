// Rules 12 to 15 and chatTarget are defined once, in app/utils/boardOps.ts. This guards against a second copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const root = new URL('../', import.meta.url).pathname

test('the definitions of chatTarget, retryOnce and the retry prefix appear only in boardOps.ts and goal.ts', () => {
  const out = execFileSync('grep', ['-rlE', 'function chatTarget|const retryOnce|RETRY_PREFIX =', 'app', 'server', 'shared', 'scripts', '--include=*.ts', '--include=*.vue', '--include=*.mjs'], { cwd: root }).toString()
  assert.deepEqual(out.split('\n').filter(Boolean).sort(), ['app/utils/boardOps.ts', 'app/utils/goal.ts'])
})

test('the Postgres step store reuses applyOp for card ops and does not restate a column rule', () => {
  const src = execFileSync('cat', ['server/utils/pgStepStore.ts'], { cwd: root }).toString()
  assert.match(src, /applyOp\(board as never, op, args, \{ person: boardOwner\(\) \}/)
  for (const forbidden of [/chatTarget/, /retryOnce/, /RETRY_PREFIX/, /cancelStep/, /stagedMove/]) assert.doesNotMatch(src, forbidden)
})
