// The board's read cache for gw.gov-board-read: 5 minutes normally, 30 with NUXT_STEP_STORE=postgres (server/utils/gateway.ts).
// Each gateway read is one billable n8n run, so these tests count fetches. $fetch, useRuntimeConfig and createError (Nitro
// auto-imports, with the cache helpers from runtimeCache.ts) are stood in for by globals, and Date.now is moved by hand. Run with `pnpm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

const root = new URL('../', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~~/')) spec = new URL(spec.slice(3) + (spec.endsWith('.json') ? '' : '.ts'), ${JSON.stringify(root)}).href
  else if (spec.startsWith('~/')) spec = new URL('app/' + spec.slice(2) + '.ts', ${JSON.stringify(root)}).href
  const out = await next(spec, ctx)
  return out.url.endsWith('.json') ? { ...out, importAttributes: { type: 'json' } } : out
}`))
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

const MIN = 60_000
const g = globalThis as Record<string, unknown>
const realNow = Date.now
const info = console.info
let boardRead: typeof import('../server/utils/gateway.ts').boardRead
let boardWrite: typeof import('../server/utils/gateway.ts').boardWrite
let stepStore = '' // what NUXT_STEP_STORE holds
let clock = 0 // minutes added to the real time
let reads = 0 // gateway reads so far
let task = { task_id: 'TSK-1', title: 'from n8n' }

before(async () => {
  g.useRuntimeConfig = () => ({
    boardSource: 'gateway', boardReadUrl: 'https://n8n.test/read', boardHeaderName: 'x-h', boardHeaderValue: 'v',
    boardWriteUrl: 'https://n8n.test/write', boardWriteHeaderName: 'x-h', boardWriteHeaderValue: 'v', stepStore
  })
  const cache = await import('../server/utils/runtimeCache.ts')
  Object.assign(g, { cacheGet: cache.cacheGet, cacheSet: cache.cacheSet, cacheDelete: cache.cacheDelete })
  g.createError = (o: { statusMessage: string }) => Object.assign(new Error(o.statusMessage), o)
  g.$fetch = async (_url: string, opts: { method: string }) => {
    if (opts.method === 'GET') {
      reads++
      return { generated_at: 'now', tasks: [{ ...task }], steps: [], notes: [], columns: [], registry: [] }
    }
    // A write answers the changed card, as gw.gov-board-write does.
    return { ok: true, rows: { tasks: [{ task_id: 'TSK-1', title: 'moved on the board' }] } }
  }
  Date.now = () => realNow() + clock * MIN
  console.info = () => {}
  ;({ boardRead, boardWrite } = await import('../server/utils/gateway.ts'))
})

after(() => {
  Date.now = realNow
  console.info = info
  for (const key of ['useRuntimeConfig', 'createError', '$fetch', 'cacheGet', 'cacheSet', 'cacheDelete']) delete g[key]
})

// Every test sets the flag, then starts with a fresh fetch (Refresh) so the snapshot's life matches that flag, and counts from zero.
async function begin(flag: string) {
  stepStore = flag
  clock += 1000 // far from the last test's snapshot
  task = { task_id: 'TSK-1', title: 'from n8n' }
  await boardRead(true)
  reads = 0
}

const titleOf = async () => (await boardRead()).tasks[0].title

test('flag off: a read is reused for 4 minutes and fetched again after 5', async () => {
  await begin('')
  await boardRead()
  clock += 4
  await boardRead()
  assert.equal(reads, 0)
  clock += 1.5
  await boardRead()
  assert.equal(reads, 1)
})

test('flag on (postgres): a read is reused for 29 minutes and fetched again after 30', async () => {
  await begin('postgres')
  clock += 29
  await boardRead()
  assert.equal(reads, 0)
  clock += 1.5
  await boardRead()
  assert.equal(reads, 1)
})

test('flag on: an edit made in n8n does not show inside the window, and shows after it', async () => {
  await begin('postgres')
  task = { task_id: 'TSK-1', title: 'edited in n8n' }
  clock += 10
  assert.equal(await titleOf(), 'from n8n')
  clock += 21
  assert.equal(await titleOf(), 'edited in n8n')
})

test('flag on: a write made through the board merges into the cache at once, with no new read', async () => {
  await begin('postgres')
  const result = await boardWrite('move_task', { task_id: 'TSK-1' }, { person: 'person:meshach' })
  assert.equal(result.ok, true)
  assert.equal(await titleOf(), 'moved on the board')
  assert.equal(reads, 0)
})

test('a write does not lengthen the window: it still ends 30 minutes after the read', async () => {
  await begin('postgres')
  clock += 20
  await boardWrite('move_task', { task_id: 'TSK-1' }, { person: 'person:meshach' })
  clock += 11
  await boardRead()
  assert.equal(reads, 1)
})

test('Refresh skips the cache in both modes', async () => {
  for (const flag of ['', 'postgres']) {
    await begin(flag)
    await boardRead(true)
    assert.equal(reads, 1)
  }
})
