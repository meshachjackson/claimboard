// The board store's `loaded` flag is false until the first board read finishes, then stays true. Pages use it to show a
// loading placeholder instead of a false zero. Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks, createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'

// The store is Nuxt code: it imports `vue` (not a direct dependency) and the `~/` and `~~/` aliases. Teach plain Node
// those three, using the same `vue` copy that pinia loads, so the test runs the real store.
const root = fileURLToPath(new URL('../', import.meta.url))
const vueFromPinia = createRequire(createRequire(import.meta.url).resolve('pinia')).resolve('vue')
const withTs = (path: string) => pathToFileURL(existsSync(path + '.ts') ? path + '.ts' : path).href
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'vue') return next(pathToFileURL(vueFromPinia).href, context)
    if (specifier.startsWith('~~/')) return next(withTs(root + specifier.slice(3)), context)
    if (specifier.startsWith('~/')) return next(withTs(root + 'app/' + specifier.slice(2)), context)
    return next(specifier, context)
  },
  // The store imports mock/board_columns.json without the `type: json` attribute that Vite does not need.
  load(url, context, next) {
    return next(url, url.endsWith('.json') ? { ...context, importAttributes: { type: 'json' } } : context)
  }
})

type Reply = { resolve: (v: unknown) => void, reject: (e: unknown) => void }
const pending: Reply[] = []
// The store calls Nuxt's global $fetch; hold each read open until the test answers it.
Object.assign(globalThis, {
  $fetch: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }) }),
  navigateTo: async () => {},
  useToast: () => ({ add: () => {} }),
  useSettings: () => ({})
})
const data = { tasks: [], steps: [], notes: [], columns: [], registry: [], source: 'gateway', writable: false, liveOps: [], saved: false }

let useBoardStore: typeof import('../app/stores/board.ts').useBoardStore
before(async () => { ({ useBoardStore } = await import('../app/stores/board.ts')) })

test('loaded is false before the first read resolves, true after, and stays true on later refreshes', async () => {
  setActivePinia(createPinia())
  const board = useBoardStore()
  assert.equal(board.loaded, false)

  const first = board.refresh()
  assert.equal(board.loaded, false, 'still false while the read is in flight')
  pending.shift()!.resolve(data)
  await first
  assert.equal(board.loaded, true)

  const second = board.refresh(true)
  assert.equal(board.loaded, true, 'a refresh does not reset it')
  pending.shift()!.resolve(data)
  await second
  assert.equal(board.loaded, true)
})

test('loaded turns true when the first read fails, so the page can show the error instead of loading forever', async () => {
  setActivePinia(createPinia())
  const board = useBoardStore()
  const first = board.refresh()
  pending.shift()!.reject({ statusCode: 500 })
  await first
  assert.equal(board.loaded, true)
  assert.notEqual(board.loadError, '')
})
