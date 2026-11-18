// scripts/triage-board.mjs: the scheduled triage run with no model. Every row here is invented.
// The script runs as a child process, the way cron runs it, against a fixture board file and a fake local server.
// Run with `pnpm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'

const script = new URL('../scripts/triage-board.mjs', import.meta.url).pathname
const NOW = '2026-10-29T12:00:00.000Z'
const ago = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString()

// Full task rows, the shape the board file saves. is stale (close), a test card (close), Done long ago
// (archive), has no criteria (rewrite), is fine and must not show.
const task = (id: string, o: Record<string, unknown> = {}) => ({
  task_id: id, title: `Card ${id}`, original_request: '', acceptance_requirements: 'It works', task_type: 'build',
  proposed_assignee: '', assignee: '', upgrade_target: '', execution_policy: 'manual', approval_state: 'not_required',
  work_state: 'in_progress', current_step: 0, steps_total: 0, outputs_ref: '', internal_verification: 'none', macro_verification: 'none',
  escalation: 'none', priority: 'normal', project_id: 'p', created_by: 'person:meshach', created_at: ago(30), due_at: null,
  updated_by: 'person:meshach', updated_at: ago(1), stage: 'build', tags: '', archived_at: null, pinned_at: null, ...o
})
const BOARD = {
  tasks: [
    task('TSK-930001', { updated_at: ago(9) }),
    task('TSK-930002', { title: 'Test the gateway' }),
    task('TSK-930003', { work_state: 'done', stage: 'done', updated_at: ago(20) }),
    task('TSK-930004', { acceptance_requirements: '' }),
    task('TSK-930005')
  ],
  steps: [],
  notes: []
}
const LINE = /^TSK-\d{6} · (close|archive|fold|rewrite|keep) · [^·]+ · [^·]+$/

let dir = ''
let file = ''
let fake: Server
let fakeUrl = ''
let devLogin = true // the fake /auth/dev answers 404 when false, like a server without NUXT_DEV_LOGIN=1
const hits: { path: string, cookie: string }[] = []

// Async on purpose: a sync spawn would block this process, and the fake server below lives in it.
function run(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ status: number | null, stdout: string, stderr: string }>((resolve) => {
    execFile(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } },
      (err, stdout, stderr) => resolve({ status: err ? (err as { code?: number }).code ?? 1 : 0, stdout, stderr }))
  })
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'triage-board-'))
  file = join(dir, 'board.json')
  writeFileSync(file, JSON.stringify(BOARD, null, 2))
  // The parts of the dev server the script touches: the dev sign-in sets a session cookie and redirects, and /api/board
  // answers only with that cookie.
  fake = createServer((req, res) => {
    hits.push({ path: req.url!, cookie: req.headers.cookie ?? '' })
    if (req.url === '/auth/dev') {
      if (!devLogin) { res.statusCode = 404; return res.end() }
      res.statusCode = 302
      res.setHeader('Set-Cookie', ['nuxt-session=s3ss10n; Path=/; HttpOnly; SameSite=Lax', 'ab_return_to=; Max-Age=0; Path=/'])
      res.setHeader('Location', '/')
      return res.end()
    }
    if (req.url === '/api/board') {
      if (!req.headers.cookie?.includes('nuxt-session=s3ss10n')) { res.statusCode = 401; return res.end() }
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ source: 'fixtures', ...BOARD, registry: [], columns: [] }))
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve))
  fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`
})
after(() => {
  fake.close()
  rmSync(dir, { recursive: true, force: true })
})

test('--file: one fixed line per flagged card on stdout, strongest action first, and the board file is untouched', async () => {
  const before = readFileSync(file, 'utf8')
  const res = await run(['--file', file, '--now', NOW])
  assert.equal(res.status, 0, res.stderr)
  const lines = res.stdout.trimEnd().split('\n')
  for (const l of lines) assert.match(l, LINE)
  assert.deepEqual(lines.map(l => l.split(' · ').slice(0, 2).join(' ')),
    ['TSK-930001 close', 'TSK-930002 close', 'TSK-930003 archive', 'TSK-930004 rewrite'])
  assert.ok(!res.stdout.includes('TSK-930005'))
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.match(res.stderr, /triage-board: 4 findings \(close 2, archive 1, rewrite 1\)/)
})

test('--log writes the same lines to <dir>/triage-<yyyy-mm-dd>.txt', async () => {
  const log = join(dir, 'log')
  const res = await run(['--file', file, '--now', NOW, '--log', log])
  assert.equal(res.status, 0, res.stderr)
  // The day is local time, like the dates the board shows.
  const d = new Date(NOW)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const path = join(log, `triage-${day}.txt`)
  assert.ok(existsSync(path), `no ${path}`)
  assert.equal(readFileSync(path, 'utf8'), res.stdout)
  assert.ok(res.stderr.includes(path))
})

test('--url signs in at /auth/dev, sends the cookie to /api/board, and prints the same lines', async () => {
  hits.length = 0
  const res = await run(['--url', fakeUrl, '--now', NOW])
  assert.equal(res.status, 0, res.stderr)
  assert.deepEqual(hits.map(h => h.path), ['/auth/dev', '/api/board'])
  assert.ok(hits[1]!.cookie.includes('nuxt-session=s3ss10n'))
  assert.equal(res.stdout, (await run(['--file', file, '--now', NOW])).stdout)
})

test('--url against a server with the dev sign-in off fails with exit 1 and names NUXT_DEV_LOGIN', async () => {
  devLogin = false
  try {
    const res = await run(['--url', fakeUrl, '--now', NOW])
    assert.equal(res.status, 1)
    assert.ok(res.stderr.includes('NUXT_DEV_LOGIN'), res.stderr)
    assert.equal(res.stdout, '')
  } finally {
    devLogin = true
  }
})

test('a board with nothing to flag prints no lines and exits 0', async () => {
  const clean = join(dir, 'clean.json')
  writeFileSync(clean, JSON.stringify({ tasks: [task('TSK-930005')], steps: [], notes: [] }))
  const res = await run(['--file', clean, '--now', NOW])
  assert.equal(res.status, 0, res.stderr)
  assert.equal(res.stdout, '')
  assert.match(res.stderr, /0 findings/)
})

test('no source, both sources, or a bad --now prints the usage and exits 2; a damaged file exits 1', async () => {
  assert.equal((await run([], { NUXT_BOARD_FILE: '' })).status, 2)
  assert.equal((await run(['--file', file, '--url', fakeUrl])).status, 2)
  assert.equal((await run(['--file', file, '--now', 'yesterday'])).status, 2)
  assert.ok((await run([])).stderr.includes('usage'))
  const bad = join(dir, 'bad.json')
  writeFileSync(bad, JSON.stringify({ tasks: [] }))
  const res = await run(['--file', bad])
  assert.equal(res.status, 1)
  assert.ok(res.stderr.includes('"steps"'), res.stderr)
})

test('with no --file, NUXT_BOARD_FILE names the board', async () => {
  const res = await run(['--now', NOW], { NUXT_BOARD_FILE: file })
  assert.equal(res.status, 0, res.stderr)
  assert.ok(res.stdout.startsWith('TSK-930001 · close'))
})
