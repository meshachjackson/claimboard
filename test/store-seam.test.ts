// The BoardStore seam (docs/design/open-source.md): routes and agent ops reach the board through
// boardStore() and never call the gateway functions directly. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// A bare call: store.registrySource() is the adapter's method and is fine.
const GATEWAY_CALLS = /(?<![.\w])(boardRead|boardWrite|boardData|cachedBoard|boardCacheFresh|boardSource|boardWritable|boardSaved|liveOps|registryRead|registryData|registrySource)\(/
// Only the adapter itself and the gateways it wraps may name these functions.
const ALLOWED = new Set(['server/utils/store.ts', 'server/utils/gateway.ts', 'server/utils/registryGateway.ts'])

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : []
  })
}

const root = new URL('../', import.meta.url).pathname

test('no server file outside the adapter calls a gateway function', () => {
  const offenders = files(join(root, 'server'))
    .map(f => f.slice(root.length))
    .filter(f => !ALLOWED.has(f))
    .filter(f => GATEWAY_CALLS.test(readFileSync(join(root, f), 'utf8')))
  assert.deepEqual(offenders, [])
})

test('the app side never imports server code', () => {
  const offenders = files(join(root, 'app')).filter(f => /server\/utils\/(gateway|registryGateway|store)/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(offenders, [])
})
