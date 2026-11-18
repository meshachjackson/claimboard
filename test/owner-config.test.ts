// The board owner and the allowed logins are settings, not code (docs/design/open-source.md).
// Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~~/')) spec = new URL(spec.slice(3) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  else if (spec.startsWith('~/')) spec = new URL('app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))

const types = await import('../app/types/board.ts')
const { parseLogins, loginAllowed } = await import('../server/utils/logins.ts')
const root = new URL('../', import.meta.url).pathname

test('setBoardOwner sets the id and name; a bad id is refused and changes nothing', () => {
  types.setBoardOwner('person:alice', 'Alice Smith')
  assert.equal(types.boardOwner(), 'person:alice')
  assert.equal(types.nonRegistryName('person:alice'), 'Alice Smith')
  assert.equal(types.avatarFor('person:alice', 'Alice Smith').mono, 'AS')
  assert.throws(() => types.setBoardOwner('alice'), /person:<name>/)
  assert.equal(types.boardOwner(), 'person:alice')
  types.setBoardOwner('person:bob') // the name defaults to what follows person:
  assert.equal(types.boardOwnerName(), 'bob')
  assert.equal(types.nonRegistryName('system'), 'System')
  assert.equal(types.nonRegistryName('person:alice'), undefined) // no longer the owner
})

test('two allowed logins both pass and a third is refused; the old single setting still counts', () => {
  const list = parseLogins('', 'Alice, bob')
  assert.equal(loginAllowed('alice', list), true)
  assert.equal(loginAllowed('BOB', list), true)
  assert.equal(loginAllowed('carol', list), false)
  const merged = parseLogins('Carol', 'alice,bob,carol')
  assert.deepEqual(merged, ['carol', 'alice', 'bob'])
  assert.equal(loginAllowed('carol', merged), true)
})

test('no login set lets nobody in', () => {
  assert.equal(loginAllowed('alice', parseLogins('', undefined)), false)
  assert.equal(loginAllowed(undefined, parseLogins('alice')), false)
})

test('the owner id is not written into any source file', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|vue|mjs)$/.test(n) ? [p] : []
  })
  const files = [...['app', 'server', 'shared', 'scripts'].flatMap(d => walk(join(root, d))), join(root, 'nuxt.config.ts')]
  const hits = files.filter(f => readFileSync(f, 'utf8').includes('person:meshach')).map(f => f.slice(root.length))
  assert.deepEqual(hits, [])
})
