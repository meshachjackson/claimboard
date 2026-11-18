// scripts/lib/runner-core.mjs: the helpers the Linear runner and the board dispatcher share. Each is imported from its own path,
// and board-run must hand back the very same function (one copy).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseFor, blockedByEnvironment, childEnv, parseClaudeJson, parseVerdict, verifierCommand } from '../scripts/lib/runner-core.mjs'

const gitWith = (rules: Record<string, number>) => (args: string[]) => ({ status: rules[args[3]!] ?? 1, stdout: '', stderr: '' })

test('baseFor: main with no origin/main, main when level or ahead, origin/main when the remote moved on', () => {
  assert.equal(baseFor('/r', gitWith({})), 'main')
  assert.equal(baseFor('/r', gitWith({ '--verify': 0, '--is-ancestor': 0 })), 'main')
  assert.equal(baseFor('/r', gitWith({ '--verify': 0, '--is-ancestor': 1 })), 'origin/main')
})

test('childEnv drops tokens, secrets, passwords and keys but keeps PATH and the Anthropic key', () => {
  const out = childEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'a', GITHUB_TOKEN: 'z', db_password: 'p', STRIPE_KEY: 'k', LANG: 'en' })
  assert.deepEqual(out, { PATH: '/bin', ANTHROPIC_API_KEY: 'a', LANG: 'en' })
})

test('parseClaudeJson reads a result object, an event list and plain text', () => {
  assert.deepEqual(parseClaudeJson('{"type":"result","result":" done ","total_cost_usd":0.25,"is_error":false}'), { summary: 'done', usd: 0.25, isError: false })
  assert.deepEqual(parseClaudeJson('[{"type":"system"},{"type":"result","result":"ok","total_cost_usd":1,"is_error":true,"session_id":"s1"}]'), { summary: 'ok', usd: 1, isError: true, sessionId: 's1' })
  assert.deepEqual(parseClaudeJson('not json'), { summary: 'not json', usd: 0, isError: false })
})

test('parseVerdict takes the last VERDICT line and fails anything else', () => {
  assert.equal(parseVerdict('VERDICT: FAIL\nthen\nVERDICT: PASS'), 'PASS')
  assert.equal(parseVerdict('looks fine'), 'FAIL')
})

test('blockedByEnvironment spots a reply that could not run something here', () => {
  assert.equal(blockedByEnvironment('Bash is denied, so I cannot start the dev server.'), true)
  assert.equal(blockedByEnvironment('I added the filter and the tests pass.'), false)
})

test('verifierCommand runs loop-verifier with push denied and Edit and Write not allowed', () => {
  const a = verifierCommand({ worktree: '/wt', maxUsd: 2, extraDirs: ['/x'] })
  assert.ok(a.includes('loop-verifier'))
  assert.ok(a.includes('--add-dir') && a.includes('/x'))
  assert.ok(a.includes('Bash(git push*)'))
  assert.ok(!a.slice(a.indexOf('--allowedTools'), a.indexOf('--disallowedTools')).includes('Write'))
})

test('board-run re-exports the same functions, not copies', async () => {
  const board = await import('../scripts/board-run.mjs')
  for (const [name, fn] of Object.entries({ baseFor, blockedByEnvironment, childEnv, parseClaudeJson, parseVerdict, verifierCommand })) {
    assert.equal((board as Record<string, unknown>)[name], fn, name)
  }
})
