// The error log (server/utils/errorLogStore.ts) on in-memory Postgres (pglite): write, scrub, group, window, prune, and a
// broken database that must not throw. Run with `pnpm test`.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { ERRORS_DDL, createMemoryErrorLog, createPgErrorLog, groupErrors, readErrorReport, scrub } from '../server/utils/errorLogStore.ts'

const opened: PGlite[] = []
after(async () => { for (const pg of opened) await pg.close() })

function dbOf(pg: PGlite) {
  return {
    query: async (s: string, p?: unknown[]) => { const r = await pg.query(s, p as never[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } },
    exec: async (s: string) => pg.exec(s),
    transaction: async () => { throw new Error('not needed') }
  } as never
}
async function freshLog() {
  const pg = new PGlite()
  opened.push(pg)
  return { pg, log: createPgErrorLog(dbOf(pg)) }
}

test('the DDL in the code and in step-store.sql are the same text', () => {
  const sql = readFileSync(new URL('../server/db/step-store.sql', import.meta.url), 'utf8')
  assert.ok(sql.includes(ERRORS_DDL))
})

test('three errors, two the same: two groups, one counted twice, newest first', async () => {
  const { log } = await freshLog()
  await log.record({ source: 'http', message: 'Bad Gateway: gw.gov-board-read timed out after 30s', path: '/api/board?fresh=1', status: 502 })
  await log.record({ source: 'rollup', message: 'rollup for TSK-930321 not applied: stale', task_id: 'TSK-930321' })
  await log.record({ source: 'http', message: 'Bad Gateway: gw.gov-board-read timed out after 45s', path: '/api/board', status: 502 })
  const report = await readErrorReport(log, 'postgres', {})
  assert.equal(report.total, 3)
  assert.equal(report.groups.length, 2)
  const http = report.groups.find(g => g.source === 'http')!
  assert.equal(http.count, 2)
  assert.deepEqual(http.paths, ['/api/board'])
  assert.equal(report.groups.find(g => g.source === 'rollup')!.task_ids[0], 'TSK-930321')
  assert.match(report.note, /2 distinct faults/)
})

test('credentials are scrubbed before they are stored', async () => {
  const { pg, log } = await freshLog()
  await log.record({ source: 'http', message: 'connect failed postgres://user:s3cret@db.example.com/neon and Authorization: Bearer abc123def456 via https://u:p@host.test/x', path: '/mcp?token=vc1.AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH.sig' })
  const rows = (await pg.query('SELECT message, path FROM board_errors')).rows as { message: string, path: string }[]
  assert.equal(rows.length, 1)
  for (const text of [rows[0]!.message, rows[0]!.path]) {
    assert.doesNotMatch(text, /s3cret|abc123def456|u:p@|vc1\./)
  }
  assert.equal(rows[0]!.path, '/mcp')
  assert.equal(scrub('x'.repeat(900)).length <= 500, true)
})

test('a window, a limit and a bad timestamp', async () => {
  const { pg, log } = await freshLog()
  await log.record({ source: 'http', message: 'old', status: 500 })
  await pg.query("UPDATE board_errors SET created_at = now() - interval '3 hours'")
  await log.record({ source: 'http', message: 'new', status: 500 })
  assert.equal((await readErrorReport(log, 'postgres', {})).total, 1)
  const wide = await readErrorReport(log, 'postgres', { since: new Date(Date.now() - 6 * 3600_000).toISOString() })
  assert.equal(wide.total, 2)
  const capped = await readErrorReport(log, 'postgres', { since: new Date(Date.now() - 6 * 3600_000).toISOString(), limit: 1 })
  assert.equal(capped.truncated, true)
  await assert.rejects(readErrorReport(log, 'postgres', { since: 'yesterday-ish' }), /ISO timestamp/)
  assert.equal((await readErrorReport(log, 'postgres', { since: new Date(Date.now() + 3600_000).toISOString() }).catch(e => e.message)), 'since must be before until')
})

test('prune drops rows older than 30 days and keeps the rest', async () => {
  const { pg, log } = await freshLog()
  await log.record({ source: 'http', message: 'ancient' })
  await pg.query("UPDATE board_errors SET created_at = now() - interval '31 days'")
  await log.record({ source: 'http', message: 'recent' })
  assert.equal(await log.prune(), 1)
  assert.equal(((await pg.query('SELECT count(*)::int AS n FROM board_errors')).rows[0] as { n: number }).n, 1)
})

test('a database that throws does not make record throw', async () => {
  const broken = { query: async () => { throw new Error('connection to postgres://u:pw@h/db refused') }, exec: async () => { throw new Error('down') }, transaction: async () => { throw new Error('down') } } as never
  const seen: string[] = []
  const original = console.error
  console.error = (...a: unknown[]) => { seen.push(a.join(' ')) }
  try {
    await createPgErrorLog(broken).record({ source: 'http', message: 'x' })
  } finally { console.error = original }
  assert.equal(seen.length, 1)
  assert.doesNotMatch(seen[0]!, /pw@/)
})

test('the memory ring answers the same way and keeps 200', async () => {
  const log = createMemoryErrorLog()
  for (let i = 0; i < 210; i++) await log.record({ source: 'http', message: `boom ${i}`, status: 500 })
  const rows = await log.list({ since: new Date(0).toISOString(), until: new Date(Date.now() + 1000).toISOString(), limit: 500 })
  assert.equal(rows.length, 200)
  const report = await readErrorReport(log, 'memory', {})
  assert.equal(report.groups.length, 1)
  assert.equal(report.groups[0]!.count, 200)
  assert.match(report.note, /memory only/)
})

test('numbers and board ids do not split a fault', () => {
  const mk = (message: string, n: number) => ({ seq: n, source: 'rollup', message, path: '', status: null, task_id: '', step_id: '', created_at: new Date(1e12 + n * 1000).toISOString() })
  assert.equal(groupErrors([mk('rollup for TSK-930321 not applied', 2), mk('rollup for TSK-930322 not applied', 1)]).length, 1)
})
