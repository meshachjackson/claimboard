// Saved views: what a view keeps, saving and removing by name, links, and reading storage back.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

let sv: typeof import('../app/utils/savedViews.ts')
before(async () => { sv = await import('../app/utils/savedViews.ts') })

test('viewFrom keeps string query values in key order and drops blanks, arrays, the open ticket and the phone column', () => {
  assert.deepEqual(sv.viewFrom({ view: 'states', q: '', task: 'TSK-1', col: 'c1', priority: 'urgent,high', tags: ['a'] }), { priority: 'urgent,high', view: 'states' })
  assert.deepEqual(sv.viewFrom({}), {})
})

test('saveView adds, replaces by name ignoring case and spaces, and ignores a blank name', () => {
  const a = sv.saveView([], 'Urgent', { priority: 'urgent' })
  assert.deepEqual(a, [{ name: 'Urgent', query: { priority: 'urgent' } }])
  const b = sv.saveView(a, '  urgent ', { priority: 'urgent,high', task: 'TSK-1' })
  assert.deepEqual(b, [{ name: 'urgent', query: { priority: 'urgent,high' } }])
  assert.equal(sv.saveView(b, '   ', { q: 'x' }), b)
  assert.deepEqual(a, [{ name: 'Urgent', query: { priority: 'urgent' } }]) // the input is not changed
})

test('removeView drops by name and returns the same array when nothing matched', () => {
  const list = [{ name: 'A', query: {} }, { name: 'B', query: { q: 'x' } }]
  assert.deepEqual(sv.removeView(list, 'a'), [{ name: 'B', query: { q: 'x' } }])
  assert.equal(sv.removeView(list, 'zz'), list)
})

test('viewHref is the board link, and isCurrent matches the whole saved query', () => {
  const v = { name: 'Table of urgent', query: { layout: 'table', priority: 'urgent', q: 'a b' } }
  assert.equal(sv.viewHref(v), '/board?layout=table&priority=urgent&q=a+b')
  assert.equal(sv.viewHref({ name: 'Home', query: {} }), '/board')
  assert.equal(sv.isCurrent(v, { priority: 'urgent', layout: 'table', q: 'a b', task: 'TSK-9' }), true)
  assert.equal(sv.isCurrent(v, { priority: 'urgent', layout: 'table' }), false)
  assert.equal(sv.isCurrent(v, { priority: 'urgent', layout: 'table', q: 'a b', tags: 'ui' }), false)
})

test('parseViews reads storage back safely and drops anything that is not a named view', () => {
  assert.deepEqual(sv.parseViews(null), [])
  assert.deepEqual(sv.parseViews('not json'), [])
  assert.deepEqual(sv.parseViews('{"name":"x"}'), [])
  const raw = JSON.stringify([
    { name: 'Good', query: { view: 'states', n: 3, blank: '', task: 'TSK-1' } },
    { name: '', query: {} },
    { name: 'NoQuery' },
    { name: 'good', query: { q: 'dupe' } },
    'junk',
    null
  ])
  assert.deepEqual(sv.parseViews(raw), [{ name: 'Good', query: { view: 'states' } }])
})
