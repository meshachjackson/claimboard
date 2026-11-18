// The reference adapter (server/utils/sqliteStore.ts): the same op answers as the in-memory runner, rows that survive a
// restart, and access.json deciding which agent token may call which op. Run with `pnpm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'
import type { BoardData, WriteResult } from '../app/types/board.ts'

const root = new URL('../', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~~/')) spec = new URL(spec.slice(3) + (spec.endsWith('.json') ? '' : '.ts'), ${JSON.stringify(root)}).href
  else if (spec.startsWith('~/')) spec = new URL('app/' + spec.slice(2) + '.ts', ${JSON.stringify(root)}).href
  const out = await next(spec, ctx)
  return out.url.endsWith('.json') ? { ...out, importAttributes: { type: 'json' } } : out
}`))
// These fixtures are the owner's: the board owner is a setting, so the tests set it.
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

let createSqliteStore: typeof import('../server/utils/sqliteStore.ts').createSqliteStore
let seedBoard: typeof import('../server/utils/fixtures.ts').seedBoard
let runOp: typeof import('../app/utils/boardOps.ts').runOp
let dir = ''
before(async () => {
  ({ createSqliteStore } = await import('../server/utils/sqliteStore.ts'))
  ;({ seedBoard } = await import('../server/utils/fixtures.ts'))
  ;({ runOp } = await import('../app/utils/boardOps.ts'))
  dir = mkdtempSync(join(tmpdir(), 'sqlite-store-'))
})
after(() => rmSync(dir, { recursive: true, force: true }))

const TOKEN = 'test-token-not-a-secret'
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
const AGENT = 'agt-builder-local'
const MESHACH = { person: 'person:meshach' }
let n = 0
/** A fresh store with its own database file and access.json. */
function newStore(agents: object[] = [{ agent_id: AGENT, token_sha256: sha(TOKEN) }], name = `db${n++}`) {
  const accessFile = join(dir, `${name}.access.json`)
  writeFileSync(accessFile, JSON.stringify({ agents }))
  return { store: createSqliteStore({ file: join(dir, `${name}.sqlite`), accessFile, seed: seedBoard }), name, accessFile }
}

// The seed is fixed mock rows, so a step can be read from it without a server.
const seedStep = (id: string) => JSON.parse(JSON.stringify(seedBoard().steps.find(x => x.step_id === id)))

const ids = (r: WriteResult) => r.ok ? [...(r.rows.tasks ?? []).map(x => x.task_id), ...(r.rows.steps ?? []).map(x => x.step_id), ...(r.rows.notes ?? []).map(x => x.note_id)] : []

test('same answers as the in-memory runner for the same ops', async () => {
  const { store } = newStore()
  const memory = seedBoard()
  const claim = { step_id: 'STP-900001', claim_key: 'pull:STP-900001', updated_at: seedStep('STP-900001').updated_at }
  const cases: Array<[string, string, Record<string, unknown>, 'person' | 'agent']> = [
    ['add_note', 'ok', { task_id: 'TSK-900002', kind: 'comment', body: 'Parity check.' }, 'person'],
    ['add_note', 'blank body', { task_id: 'TSK-900002', kind: 'comment', body: '   ' }, 'person'],
    ['no_such_op', 'unknown op', {}, 'person'],
    ['claim_step', 'ok', claim, 'agent'],
    ['claim_step', 'second claim', claim, 'agent'],
    ['add_note', 'agent note without a step', { task_id: 'TSK-900002', kind: 'comment', body: 'x' }, 'agent']
  ]
  for (const [op, label, args, who] of cases) {
    const want = runOp(memory, op, args, who === 'person' ? MESHACH : { agent_id: AGENT })
    const got = await store.write(op, args, who === 'person' ? MESHACH : { token: TOKEN })
    assert.equal(got.ok, want.ok, label)
    // A lease refusal names the lease's end time, which differs by a millisecond between the two runs.
    const calm = (r: string) => r.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>')
    if (!got.ok && !want.ok) assert.equal(calm(got.reason), calm(want.reason), label)
    assert.deepEqual(ids(got), ids(want), label)
  }
})

test('a write is still there when a new store opens the same file', async () => {
  const { store, name, accessFile } = newStore()
  const before = (await store.read()).notes.length
  assert.equal((await store.write('add_note', { task_id: 'TSK-900002', kind: 'comment', body: 'Survives a restart.' }, MESHACH)).ok, true)
  const reopened = createSqliteStore({ file: join(dir, `${name}.sqlite`), accessFile, seed: seedBoard })
  const board = await reopened.read()
  assert.equal(board.notes.length, before + 1)
  assert.equal(board.notes.at(-1)!.body, 'Survives a restart.')
})

test('a refused write saves nothing', async () => {
  const { store } = newStore()
  const before = await store.read()
  assert.equal((await store.write('add_note', { task_id: 'TSK-900002', kind: 'comment', body: '' }, MESHACH)).ok, false)
  const after = await store.read()
  assert.deepEqual([after.tasks.length, after.steps.length, after.notes.length], [before.tasks.length, before.steps.length, before.notes.length])
})

test('a token with no access.json entry is refused', async () => {
  const { store } = newStore()
  const r = await store.write('whoami', {}, { token: 'some-other-token' })
  assert.deepEqual(r.ok ? null : r.reason, 'unknown token')
})

test('no access.json lets no agent in; a person still works', async () => {
  const { store } = newStore([])
  assert.equal((await store.write('whoami', {}, { token: TOKEN })).ok, false)
  assert.equal((await store.write('add_note', { task_id: 'TSK-900002', kind: 'comment', body: 'Person is checked by the route.' }, MESHACH)).ok, true)
})

test('a token that matches access.json but no registry agent is refused', async () => {
  const { store } = newStore([{ agent_id: 'agt-not-in-registry', token_sha256: sha(TOKEN) }])
  const r = await store.write('whoami', {}, { token: TOKEN })
  assert.deepEqual(r.ok ? null : r.reason, 'unknown token')
})

test('an op outside the entry\'s ops list is refused; one inside works', async () => {
  const { store } = newStore([{ agent_id: AGENT, token_sha256: sha(TOKEN), ops: ['whoami'] }])
  const step = seedStep('STP-900001')
  const no = await store.write('claim_step', { step_id: step.step_id, claim_key: `pull:${step.step_id}`, updated_at: step.updated_at }, { token: TOKEN })
  assert.deepEqual(no.ok ? null : no.reason, `${AGENT} may not call claim_step`)
  const yes = await store.write('whoami', {}, { token: TOKEN })
  assert.equal(yes.ok && yes.agent_id, AGENT)
})

test('capabilities and registry: saved, writable, all proposed ops, registry rows from the database', async () => {
  const { store } = newStore()
  const caps = store.capabilities()
  assert.equal(caps.saved, true)
  assert.equal(caps.writable, true)
  assert.ok(caps.liveOps.includes('update_task'))
  const reg = await store.readRegistry()
  assert.equal(reg.registry.length, seedBoard().registry.length)
  assert.deepEqual(reg.access, [])
})
