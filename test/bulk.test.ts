// Multi-select, bulk edit planning, and the table's filter and sort. Run with `pnpm test`.
// The repo's tests use node:test (no vitest dependency), so this file does too.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
// These fixtures are the owner's: the board owner is a setting, so the tests set it.
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

let bulk: typeof import('../app/utils/bulk.ts')
let table: typeof import('../app/utils/tableView.ts')
before(async () => {
  bulk = await import('../app/utils/bulk.ts')
  table = await import('../app/utils/tableView.ts')
})

type Card = import('../app/utils/bulk.ts').BulkCard & import('../app/utils/tableView.ts').TableRow
const card = (id: string, over: Partial<Card> & { task?: Partial<Card['task']> } = {}): Card => ({
  stage: 'build', workState: 'in_progress', archived: false, pinned: false, tags: [], assignee: '',
  ...over,
  task: {
    task_id: id, title: `Title ${id}`, assignee: '', priority: 'normal', task_type: 'build', project_id: 'p1',
    due_at: null, approval_state: 'not_required', updated_at: '2026-10-20T10:00:00Z', ...over.task
  }
})

// ---------- Selection ----------

test('toggleId adds then removes, without changing the input', () => {
  const a: string[] = []
  const b = bulk.toggleId(a, 'TSK-1')
  assert.deepEqual(a, [])
  assert.deepEqual(b, ['TSK-1'])
  assert.deepEqual(bulk.toggleId(b, 'TSK-1'), [])
})

test('toggleAll checks everything shown, then clears; an empty list stays empty', () => {
  const shown = ['a', 'b', 'c']
  assert.deepEqual(bulk.toggleAll(['b'], shown), ['a', 'b', 'c'])
  assert.deepEqual(bulk.toggleAll(['a', 'b', 'c'], shown), [])
  assert.deepEqual(bulk.toggleAll([], []), [])
})

test('selectionState reports all, some and none for the header checkbox', () => {
  assert.equal(bulk.selectionState([], ['a', 'b']), 'none')
  assert.equal(bulk.selectionState(['a'], ['a', 'b']), 'some')
  assert.equal(bulk.selectionState(['a', 'b', 'x'], ['a', 'b']), 'all')
  assert.equal(bulk.selectionState([], []), 'none')
})

test('pruneSelection drops ids that left the screen and keeps the same array when nothing changed', () => {
  const sel = ['a', 'b']
  assert.equal(bulk.pruneSelection(sel, ['a', 'b', 'c']), sel)
  assert.deepEqual(bulk.pruneSelection(sel, ['b', 'c']), ['b'])
})

test('selectRange adds every row between two clicks, in either direction', () => {
  const shown = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(bulk.selectRange([], shown, 'b', 'd'), ['b', 'c', 'd'])
  assert.deepEqual(bulk.selectRange(['a'], shown, 'd', 'c'), ['a', 'c', 'd'])
  // An anchor that is no longer shown falls back to a plain toggle.
  assert.deepEqual(bulk.selectRange([], shown, 'zz', 'c'), ['c'])
})

// ---------- Planning ----------

test('planBulk skips cards the edit would not change, and says why', () => {
  const cards = [card('A', { stage: 'review' }), card('B'), card('C', { archived: true })]
  const p = bulk.planBulk(cards, { kind: 'stage', value: 'review' })
  assert.deepEqual(p.run, ['B'])
  assert.deepEqual(p.skipped, [{ id: 'A', why: 'already there' }, { id: 'C', why: 'archived' }])
})

test('field edits skip Done cards, because update_task and assign refuse them', () => {
  const done = card('D', { workState: 'done', stage: 'done' })
  for (const kind of ['priority', 'task_type', 'project_id', 'add_tag', 'remove_tag', 'due_at', 'clear_due', 'assignee'] as const) {
    assert.equal(bulk.skipReason(done, { kind, value: 'x' }), 'Done', kind)
  }
  assert.equal(bulk.skipReason(card('E'), { kind: 'priority', value: 'normal' }), 'already set')
  assert.equal(bulk.skipReason(card('E'), { kind: 'priority', value: 'urgent' }), '')
})

test('archive runs on unpinned Done cards only', () => {
  const edit = { kind: 'archive', value: '' } as const
  assert.equal(bulk.skipReason(card('A'), edit), 'not Done')
  assert.equal(bulk.skipReason(card('B', { workState: 'done', pinned: true }), edit), 'pinned')
  assert.equal(bulk.skipReason(card('C', { workState: 'done' }), edit), '')
})

test('delete plans every live card, not only unpinned Done ones, and skips an archived one', () => {
  const edit = { kind: 'delete', value: '' } as const
  const cards = [card('A'), card('B', { pinned: true }), card('C', { workState: 'done' }), card('D', { archived: true })]
  assert.deepEqual(bulk.planBulk(cards, edit), { run: ['A', 'B', 'C'], skipped: [{ id: 'D', why: 'archived' }] })
})

test('pin and unpin skip cards already in that state', () => {
  assert.equal(bulk.skipReason(card('A', { pinned: true }), { kind: 'pin', value: '' }), 'already pinned')
  assert.equal(bulk.skipReason(card('A'), { kind: 'unpin', value: '' }), 'not pinned')
  assert.equal(bulk.skipReason(card('A'), { kind: 'pin', value: '' }), '')
})

test('add_tag keeps the card\'s other tags and skips a card that has the tag', () => {
  const c = card('A', { tags: ['ui', 'urgent'] })
  assert.deepEqual(bulk.fieldsFor(c, { kind: 'add_tag', value: 'bulk' }), { tags: 'ui,urgent,bulk' })
  assert.equal(bulk.skipReason(c, { kind: 'add_tag', value: 'ui' }), 'already tagged')
  assert.equal(bulk.fieldsFor(c, { kind: 'pin', value: '' }), null)
})

test('normalizeTag makes a slug; editReady needs a value except for pin, unpin, archive and unassign', () => {
  assert.equal(bulk.normalizeTag('  #Needs Review '), 'needs-review')
  assert.equal(bulk.editReady({ kind: 'archive', value: '' }), true)
  assert.equal(bulk.editReady({ kind: 'assignee', value: '' }), true)
  assert.equal(bulk.editReady({ kind: 'priority', value: '' }), false)
  assert.equal(bulk.editReady({ kind: 'priority', value: 'high' }), true)
  assert.equal(bulk.editReady({ kind: 'add_tag', value: '' }), false)
})

// ---------- Second slice (10/30/2026): due date, tag removal, approve ----------

test('due_at sets a day through update_task and skips a card already due that day', () => {
  const edit = { kind: 'due_at', value: '2026-11-02' } as const
  assert.deepEqual(bulk.fieldsFor(card('A'), edit), { due_at: '2026-11-02' })
  // Stored dates may carry a time; the day is what counts.
  assert.equal(bulk.skipReason(card('B', { task: { due_at: '2026-11-02T15:00:00Z' } }), edit), 'already set')
  assert.equal(bulk.skipReason(card('C', { task: { due_at: '2026-11-03' } }), edit), '')
  assert.equal(bulk.skipReason(card('D'), edit), '')
})

test('clear_due sends a blank due_at and skips cards with no date', () => {
  const edit = { kind: 'clear_due', value: '' } as const
  assert.deepEqual(bulk.fieldsFor(card('A', { task: { due_at: '2026-11-02' } }), edit), { due_at: '' })
  assert.equal(bulk.skipReason(card('A', { task: { due_at: '2026-11-02' } }), edit), '')
  assert.equal(bulk.skipReason(card('B'), edit), 'no due date')
})

test('editReady takes a real day for due_at and nothing for clear_due or approve', () => {
  assert.equal(bulk.editReady({ kind: 'due_at', value: '' }), false)
  assert.equal(bulk.editReady({ kind: 'due_at', value: '11/02/2026' }), false)
  assert.equal(bulk.editReady({ kind: 'due_at', value: '2026-13-45' }), false)
  assert.equal(bulk.editReady({ kind: 'due_at', value: '2026-11-02' }), true)
  assert.equal(bulk.editReady({ kind: 'clear_due', value: '' }), true)
  assert.equal(bulk.editReady({ kind: 'approve', value: '' }), true)
  assert.equal(bulk.editReady({ kind: 'remove_tag', value: '' }), false)
  assert.equal(bulk.isDay('2026-02-30'), true) // JavaScript rolls the day over; the gateway's Date.parse does the same
  assert.equal(bulk.dayOf(null), '')
})

test('remove_tag drops only that tag and skips a card without it', () => {
  const c = card('A', { tags: ['ui', 'bulk', 'urgent'] })
  assert.deepEqual(bulk.fieldsFor(c, { kind: 'remove_tag', value: 'bulk' }), { tags: 'ui,urgent' })
  // Removing the last tag sends a blank tags field, which update_task stores as no tags.
  assert.deepEqual(bulk.fieldsFor(card('B', { tags: ['only'] }), { kind: 'remove_tag', value: 'only' }), { tags: '' })
  assert.equal(bulk.skipReason(c, { kind: 'remove_tag', value: 'nope' }), 'not tagged')
  assert.equal(bulk.skipReason(c, { kind: 'remove_tag', value: 'ui' }), '')
})

test('approve runs on pending gates only, and says why the rest are skipped', () => {
  const edit = { kind: 'approve', value: '' } as const
  const cards = [
    card('A', { task: { approval_state: 'pending' } }),
    card('B', { task: { approval_state: 'approved' } }),
    card('C', { task: { approval_state: '' } }),
    card('D', { workState: 'done', stage: 'done', task: { approval_state: 'pending' } }),
    card('E', { archived: true, task: { approval_state: 'pending' } })
  ]
  const p = bulk.planBulk(cards, edit)
  assert.deepEqual(p.run, ['A'])
  assert.deepEqual(p.skipped, [{ id: 'B', why: 'not pending' }, { id: 'C', why: 'not pending' }, { id: 'D', why: 'Done' }, { id: 'E', why: 'archived' }])
  // approve_task is its own op, not update_task, so there are no fields.
  assert.equal(bulk.fieldsFor(cards[0]!, edit), null)
})

// ---------- Table filter and sort ----------

const names: Record<string, string> = { 'agt-b': 'Beta', 'agt-a': 'Alpha' }
const nameOf = (id: string) => names[id] ?? id

test('sortRows orders by priority with most urgent first, and flips', () => {
  const rows = [
    card('A', { task: { priority: 'low' } }),
    card('B', { task: { priority: 'urgent' } }),
    card('C', { task: { priority: 'normal' } }),
    card('D', { task: { priority: 'whatever' } })
  ]
  assert.deepEqual(table.sortRows(rows, 'priority', false, nameOf).map(r => r.task.task_id), ['B', 'C', 'A', 'D'])
  assert.deepEqual(table.sortRows(rows, 'priority', true, nameOf).map(r => r.task.task_id), ['D', 'A', 'C', 'B'])
})

test('sortRows by stage follows the board order, not the alphabet', () => {
  const rows = [card('A', { stage: 'review' }), card('B', { stage: 'backlog' }), card('C', { stage: 'done' }), card('D', { stage: 'architecture' })]
  assert.deepEqual(table.sortRows(rows, 'stage', false, nameOf).map(r => r.stage), ['backlog', 'architecture', 'review', 'done'])
})

test('sortRows by assignee sorts by display name, unassigned last, and by due date with no date last', () => {
  const rows = [
    card('A', { assignee: 'agt-b' }),
    card('B', { assignee: '' }),
    card('C', { assignee: 'agt-a' })
  ]
  assert.deepEqual(table.sortRows(rows, 'assignee', false, nameOf).map(r => r.task.task_id), ['C', 'A', 'B'])
  const due = [card('A', { task: { due_at: null } }), card('B', { task: { due_at: '2026-11-02' } }), card('C', { task: { due_at: '2026-10-30' } })]
  assert.deepEqual(table.sortRows(due, 'due', false, nameOf).map(r => r.task.task_id), ['C', 'B', 'A'])
})

test('sortRows keeps pinned rows first in either direction, and breaks ties by newest id', () => {
  const rows = [card('TSK-1'), card('TSK-3'), card('TSK-2', { pinned: true })]
  assert.deepEqual(table.sortRows(rows, 'priority', false, nameOf).map(r => r.task.task_id), ['TSK-2', 'TSK-3', 'TSK-1'])
  assert.deepEqual(table.sortRows(rows, 'title', true, nameOf).map(r => r.task.task_id), ['TSK-2', 'TSK-3', 'TSK-1'])
})

test('sortRows does not change the array it is given', () => {
  const rows = [card('B'), card('A')]
  table.sortRows(rows, 'id', false, nameOf)
  assert.deepEqual(rows.map(r => r.task.task_id), ['B', 'A'])
})

test('filterRows matches the text each column shows, all filters at once, and ignores blank ones', () => {
  const rows = [
    card('TSK-1', { assignee: 'agt-a', task: { title: 'Fix login', project_id: 'web' } }),
    card('TSK-2', { assignee: 'agt-b', task: { title: 'Fix billing', project_id: 'web' } }),
    card('TSK-3', { assignee: 'agt-a', task: { title: 'Write docs', project_id: 'docs' } })
  ]
  const ids = (f: Parameters<typeof table.filterRows>[1]) => table.filterRows(rows, f, nameOf).map(r => r.task.task_id)
  assert.deepEqual(ids({ title: 'FIX' }), ['TSK-1', 'TSK-2'])
  assert.deepEqual(ids({ title: 'fix', assignee: 'alpha' }), ['TSK-1'])
  assert.deepEqual(ids({ id: 'tsk-3', project: ' ' }), ['TSK-3'])
  assert.deepEqual(ids({ project: '' }), ['TSK-1', 'TSK-2', 'TSK-3'])
})

test('nextSort flips the same column and starts a new one ascending', () => {
  assert.deepEqual(table.nextSort({ key: 'title', desc: false }, 'title'), { key: 'title', desc: true })
  assert.deepEqual(table.nextSort({ key: 'title', desc: true }, 'due'), { key: 'due', desc: false })
})
