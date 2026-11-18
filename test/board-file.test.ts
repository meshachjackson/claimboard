// NUXT_BOARD_FILE: fixtures mode saves card, step and note writes to a local JSON file and loads them on the next start.
// Runs boardWrite from server/utils/gateway.ts in fixtures mode. Nitro's auto-imports (useRuntimeConfig, fixtureBoard and
// the rest) are stood in for by globals, and a "restart" is a second copy of fixtures.ts loaded under a new query string.
// Run with `pnpm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'

// The server files import through Nuxt's `~/` and `~~/` aliases with no extension, and fixtures.ts imports mock/*.json
// without an import attribute. Point the aliases at the repo and mark the JSON for Node.
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

const mock = (file: string) => JSON.parse(readFileSync(new URL(`../mock/${file}`, import.meta.url), 'utf8'))
const SEED_NOTES = mock('gov_task_notes.json').length
const SEED_TASKS = mock('gov_tasks.synthetic.json').length
const SEED_STEPS = mock('gov_task_steps.synthetic.json').length
const POOL_STEP = mock('gov_task_steps.synthetic.json').find((s: { step_id: string }) => s.step_id === 'STP-900001')
const BUILDER = { token: 'fixture:agt-builder-local' }
const CLAIM = { step_id: POOL_STEP.step_id, claim_key: `pull:${POOL_STEP.step_id}`, updated_at: POOL_STEP.updated_at }
const MESHACH = { person: 'person:meshach' as const }
const TASK = 'TSK-900002'
const NOTE = { task_id: TASK, kind: 'comment', body: 'Saved by the board file test.' }

type Fixtures = typeof import('../server/utils/fixtures.ts')
let boardWrite: typeof import('../server/utils/gateway.ts').boardWrite
let boardSaved: typeof import('../server/utils/gateway.ts').boardSaved
let dir = ''
let file = '' // what NUXT_BOARD_FILE holds for the test at hand
let sourceName = 'fixtures' // what NUXT_BOARD_SOURCE holds
let restarts = 0
const g = globalThis as Record<string, unknown>
const info = console.info

// A new copy of fixtures.ts has fresh module state, which is what a server restart gives.
async function restart(): Promise<Fixtures> {
  const fixtures = await import(`../server/utils/fixtures.ts?restart=${++restarts}`) as Fixtures
  g.fixtureBoard = fixtures.fixtureBoard
  g.saveFixtureBoard = fixtures.saveFixtureBoard
  g.FIXTURE_TOKEN_PREFIX = fixtures.FIXTURE_TOKEN_PREFIX
  return fixtures
}

before(async () => {
  g.useRuntimeConfig = () => ({ boardSource: sourceName, boardFile: file })
  g.createError = (o: { statusMessage: string }) => Object.assign(new Error(o.statusMessage), o)
  console.info = () => {} // boardWrite logs one line per write
  ;({ boardWrite, boardSaved } = await import('../server/utils/gateway.ts'))
})

after(() => {
  console.info = info
  for (const key of ['useRuntimeConfig', 'createError', 'fixtureBoard', 'saveFixtureBoard', 'FIXTURE_TOKEN_PREFIX']) delete g[key]
})

// Each test gets an empty folder and a first start.
async function fresh(withFile = true) {
  dir = mkdtempSync(join(tmpdir(), 'board-file-'))
  file = withFile ? join(dir, 'board.json') : ''
  return restart()
}

test('a good write is saved: the file holds tasks, steps and notes and nothing else', async () => {
  await fresh()
  const result = await boardWrite('add_note', NOTE, MESHACH)
  assert.equal(result.ok, true)
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(Object.keys(saved), ['tasks', 'steps', 'notes'])
  assert.equal(saved.notes.length, SEED_NOTES + 1)
  assert.ok(saved.notes.some((n: { body: string }) => n.body === NOTE.body))
  assert.deepEqual(readdirSync(dir), ['board.json']) // the temp file was renamed away
  rmSync(dir, { recursive: true })
})

test('restart: a write is still there when the server starts again', async () => {
  await fresh()
  await boardWrite('add_note', NOTE, MESHACH)
  const second = await restart()
  const board = second.fixtureBoard(file)
  assert.equal(board.notes.length, SEED_NOTES + 1)
  assert.ok(board.notes.some(n => n.body === NOTE.body))
  assert.equal(board.tasks.length, SEED_TASKS) // untouched rows load too
  assert.ok(board.registry.length > 0 && board.columns.length > 0) // these come from mock/, not the file
  rmSync(dir, { recursive: true })
})

test('reset: deleting the file and restarting returns the seed rows', async () => {
  await fresh()
  await boardWrite('add_note', NOTE, MESHACH)
  assert.equal((await boardWrite('claim_step', CLAIM, BUILDER)).ok, true) // changes a step as well as the notes
  rmSync(file)
  const board = (await restart()).fixtureBoard(file)
  assert.equal(board.tasks.length, SEED_TASKS)
  assert.equal(board.steps.length, SEED_STEPS)
  assert.equal(board.notes.length, SEED_NOTES)
  assert.ok(!board.notes.some(n => n.body === NOTE.body))
  assert.equal(board.steps.find(s => s.step_id === POOL_STEP.step_id)!.step_state, POOL_STEP.step_state) // the claim is gone
  assert.equal(existsSync(file), false) // a read never creates the file
  rmSync(dir, { recursive: true })
})

test('setting off: writes work, no file appears and no .data folder is created', async () => {
  await fresh(false)
  const dataBefore = existsSync(new URL('../.data', import.meta.url))
  const cwdBefore = readdirSync(process.cwd()).sort()
  const result = await boardWrite('add_note', NOTE, MESHACH)
  assert.equal(result.ok, true)
  assert.deepEqual(readdirSync(dir), [])
  assert.deepEqual(readdirSync(process.cwd()).sort(), cwdBefore)
  assert.equal(existsSync(new URL('../.data', import.meta.url)), dataBefore)
  const board = (await restart()).fixtureBoard('') // and a restart forgets the write, as before
  assert.equal(board.notes.length, SEED_NOTES)
  rmSync(dir, { recursive: true })
})

test('a refused write saves nothing', async () => {
  await fresh()
  const refused = await boardWrite('add_note', { ...NOTE, body: '   ' }, MESHACH)
  assert.equal(refused.ok, false)
  assert.equal(existsSync(file), false) // no file for a refusal on a first run
  await boardWrite('add_note', NOTE, MESHACH)
  const before = readFileSync(file, 'utf8')
  const again = await boardWrite('add_note', { ...NOTE, body: '' }, MESHACH)
  assert.equal(again.ok, false)
  assert.equal(readFileSync(file, 'utf8'), before)
  rmSync(dir, { recursive: true })
})

test('a damaged file stops the load with its path and how to delete it, and is left as it was', async () => {
  await fresh()
  for (const bad of ['not json', '{"tasks":[],"steps":[]}']) {
    writeFileSync(file, bad)
    const second = await restart()
    assert.throws(() => second.fixtureBoard(file), (err: Error) => err.message.includes(file) && err.message.includes('delete'))
    assert.equal(readFileSync(file, 'utf8'), bad)
  }
  rmSync(dir, { recursive: true })
})

test('saved flag: true in fixtures mode with a file', async () => {
  await fresh()
  assert.equal(boardSaved(), true)
  rmSync(dir, { recursive: true })
})

test('saved flag: false in fixtures mode with an empty path', async () => {
  await fresh(false)
  assert.equal(boardSaved(), false)
  rmSync(dir, { recursive: true })
})

test('saved flag: false in gateway mode even with a file set', async () => {
  await fresh()
  sourceName = 'gateway'
  try {
    assert.equal(boardSaved(), false)
  } finally {
    sourceName = 'fixtures'
  }
  rmSync(dir, { recursive: true })
})
