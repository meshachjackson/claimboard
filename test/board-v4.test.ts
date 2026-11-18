// Board v4 rules that don't need the app running (docs/design/v4/README.md). Run with `pnpm test`.
// The repo's tests use node:test (no vitest dependency), so this file does too.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
// These fixtures are the owner's: the board owner is a setting, so the tests set it.
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

const { normalizePriority, priorityLabel } = await import('../app/utils/priority.ts')
const { listFrom, viewPatch } = await import('../app/utils/boardUrl.ts')
const { keyGuard } = await import('../app/utils/keyGuard.ts')

test('medium normalizes to Normal', () => {
  assert.equal(normalizePriority('medium'), 'normal')
  assert.equal(normalizePriority(' Medium '), 'normal')
  assert.equal(priorityLabel('medium'), 'Normal')
  assert.equal(priorityLabel('p0-ish'), 'p0-ish') // free text is shown as stored
})

test('tstage and tprio rewrite to stage and priority', () => {
  const q = { tstage: 'build,review', tprio: 'medium', stage: 'review' }
  assert.deepEqual(listFrom(q, 'stage'), ['review', 'build'])
  assert.deepEqual(listFrom(q, 'priority'), ['normal'])
})

test('priority facet counts medium under Normal', () => {
  const cards = ['medium', 'normal', 'high', 'Medium']
  const count = (value: string) => cards.filter(p => normalizePriority(p) === value).length
  assert.equal(count('normal'), 3)
  assert.equal(count('high'), 1)
})

test('layout=table leaves view untouched', () => {
  assert.deepEqual(viewPatch('table', 'stages'), { layout: 'table' })
  assert.equal('view' in viewPatch('table', 'stages'), false)
  // Stages clears any old ?view=flow or ?view=states (Flow and States were retired 11/3/2026).
  assert.deepEqual(viewPatch('stages', 'stages'), { view: '', col: '', layout: '' })
  // Settings opens on Table: choosing Stages must say "not the table" in the URL.
  assert.equal(viewPatch('stages', 'table').layout, 'board')
})

test('quick maps to its filter', () => {
  assert.deepEqual(listFrom({ quick: 'needs' }, 'work_state'), ['needs_input'])
  assert.deepEqual(listFrom({ quick: 'blocked', work_state: 'blocked' }, 'work_state'), ['blocked'])
  assert.deepEqual(listFrom({ quick: 'unassigned' }, 'agent'), ['_none'])
})

test('key guard ignores modifiers and inputs', () => {
  const body = { closest: () => null }
  const input = { closest: (s: string) => s.includes('input') ? {} : null }
  const press = (over: object) => ({ key: 'f', metaKey: false, ctrlKey: false, altKey: false, target: body, ...over })
  assert.equal(keyGuard(press({}), false), true)
  assert.equal(keyGuard(press({ metaKey: true }), false), false)
  assert.equal(keyGuard(press({ ctrlKey: true }), false), false)
  assert.equal(keyGuard(press({ altKey: true }), false), false)
  assert.equal(keyGuard(press({ target: input }), false), false)
  assert.equal(keyGuard(press({}), true), false) // a dialog or drawer is open
})
