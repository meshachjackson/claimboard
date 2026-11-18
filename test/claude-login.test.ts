// Claude login for the Linear runner and Architect (scripts/lib/claude-login.mjs, docs/linear-runner-login.md).
// A fake `claude` program and fake Linear: no live call, no real login, no token value (only a made-up string).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let L: any, R: any
before(async () => { L = await import('../scripts/lib/claude-login.mjs'); R = await import('../scripts/linear-run.mjs') })

const FAKE = 'fake-token-value-for-tests'

test('the token variable reaches the claude child, other TOKEN, SECRET and KEY names do not', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-')), out = join(dir, 'names.txt')
  // The fake claude lists the env names it received (never values) and prints a valid result.
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\nenv | cut -d= -f1 | sort > "${out}"\ncat >/dev/null\necho '{"result":"COMPLETE: ok","total_cost_usd":0}'\n`)
  chmodSync(join(dir, 'claude'), 0o755)
  const saved = { ...process.env }
  Object.assign(process.env, { PATH: `${dir}:${process.env.PATH}`, CLAUDE_CODE_OAUTH_TOKEN: FAKE, LINEAR_RUN_TOKEN: 'x', MY_SECRET: 'x', SOME_API_KEY: 'x' })
  try { await R.launchClaude({ prompt: 'hi', cwd: dir, lists: { allow: [], deny: [] }, budgetUsd: 1 }) } finally { process.env = saved }
  const names = readFileSync(out, 'utf8').split('\n')
  assert.ok(names.includes('CLAUDE_CODE_OAUTH_TOKEN'))
  for (const n of ['LINEAR_RUN_TOKEN', 'MY_SECRET', 'SOME_API_KEY']) assert.ok(!names.includes(n), n)
})

test('withClaudeToken adds nothing when the variable is unset or empty', () => {
  assert.deepEqual(L.withClaudeToken({ A: '1' }, {}), { A: '1' })
  assert.deepEqual(L.withClaudeToken({ A: '1' }, { CLAUDE_CODE_OAUTH_TOKEN: '' }), { A: '1' })
})

test('checkLogin: logged in, logged out, and a missing program are told apart', () => {
  const run = (status: number, stdout: string, error?: Error) => () => ({ status, stdout, error })
  assert.deepEqual(L.checkLogin({ run: run(0, '{"loggedIn":true,"authMethod":"oauth_token"}') }), { ok: true, reason: '', method: 'oauth_token' })
  assert.match(L.checkLogin({ run: run(1, '{"loggedIn":false}') }).reason, /not logged in/)
  assert.match(L.checkLogin({ run: run(0, 'junk') }).reason, /not logged in/)
  assert.match(L.checkLogin({ run: run(0, '', new Error('ENOENT')) }).reason, /did not run/)
})

test('isLoginError matches the texts claude prints and nothing ordinary', () => {
  assert.ok(L.isLoginError('Not logged in · Please run /login'))
  assert.ok(L.isLoginError('Failed to authenticate. API Error: 401 Invalid bearer token'))
  assert.ok(!L.isLoginError('The tests failed: 2 of 9'))
})

function fakeLinear() {
  const notes: { id: string, body: string }[] = []
  return { notes, linear: { note: async (id: string, body: string) => { notes.push({ id, body }) } } }
}
const queue = () => [{ id: 'a', identifier: 'ENG-1', notes: [] as string[] }, { id: 'b', identifier: 'ENG-2', notes: [] as string[] }]

test('not logged in: one log line across polls, one comment per issue, no work', async () => {
  const { notes, linear } = fakeLinear(), lines: string[] = [], state = {}
  const check = () => ({ ok: false, reason: 'the claude program is not logged in' })
  for (let poll = 0; poll < 3; poll++) {
    assert.equal(await L.loginGate({ check, linear, queue: queue(), name: 'runner', warn: (m: string) => lines.push(m), state }), false)
  }
  assert.equal(lines.length, 1)
  assert.match(lines[0], /docs\/linear-runner-login\.md/)
  assert.equal(notes.length, 2) // each issue once, though the fetch shows no marker on later polls
  assert.ok(notes.every(n => n.body.startsWith(L.WAITING)))
})

test('a comment already on the issue (a restart) is not repeated', async () => {
  const { notes, linear } = fakeLinear(), q = queue()
  q[0].notes = [`${L.WAITING}):** earlier`]
  await L.loginGate({ check: () => ({ ok: false, reason: 'r' }), linear, queue: q, name: 'runner', warn: () => {}, state: {} })
  assert.deepEqual(notes.map(n => n.id), ['b'])
})

test('login comes back: work resumes and the log says so once', async () => {
  const { linear } = fakeLinear(), lines: string[] = [], state = {}
  await L.loginGate({ check: () => ({ ok: false, reason: 'r' }), linear, queue: [], name: 'runner', warn: (m: string) => lines.push(m), state })
  assert.equal(await L.loginGate({ check: () => ({ ok: true, method: 'oauth_token' }), linear, queue: [], name: 'runner', warn: (m: string) => lines.push(m), state }), true)
  assert.ok(lines.some(l => /login is back/.test(l)))
})

test('the token value never appears in a log line or a comment', async () => {
  const { notes, linear } = fakeLinear(), lines: string[] = []
  process.env.CLAUDE_CODE_OAUTH_TOKEN = FAKE
  try {
    await L.loginGate({ check: () => L.checkLogin({ run: () => ({ status: 1, stdout: '' }) }), linear, queue: queue(), name: 'runner', warn: (m: string) => lines.push(m), state: {} })
  } finally { delete process.env.CLAUDE_CODE_OAUTH_TOKEN }
  assert.ok(![...lines, ...notes.map(n => n.body)].some(t => t.includes(FAKE)))
})

test('a launch that reports a refused login marks the gate down, and the result passes through', async () => {
  const state: { down?: string } = {}
  const bad = { ok: false, summary: 'Not logged in · Please run /login' }
  assert.deepEqual(await L.watchLogin(async () => bad, state)({}), bad)
  assert.ok(state.down)
  const { linear } = fakeLinear()
  assert.equal(await L.loginGate({ check: () => ({ ok: true }), linear, queue: [], name: 'runner', warn: () => {}, state }), false)
})
