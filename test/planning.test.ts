// Macro planning: epic, milestone and release tags, roll-up counts, orphans, lanes, definitions, sketches.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

let p: typeof import('../app/utils/planning.ts')
before(async () => { p = await import('../app/utils/planning.ts') })

test('epic, milestone and release ride in tags and read back', () => {
  const tags = ['ui', 'epic-auth', 'rel-1-0', 'col-ideas']
  assert.equal(p.epicOf(tags), 'epic-auth')
  assert.equal(p.milestoneOf(tags), 'rel-1-0')
  assert.equal(p.planLabel('epic-auth'), 'auth')
  assert.deepEqual(p.plainTags(tags), ['ui'])
})

test('setPlanTag replaces one slot, clears on blank, and a release replaces a milestone', () => {
  assert.deepEqual(p.setPlanTag(['ui', 'epic-a'], 'epic', 'Big Idea'), ['ui', 'epic-big-idea'])
  assert.deepEqual(p.setPlanTag(['ui', 'epic-a'], 'epic', ''), ['ui'])
  assert.deepEqual(p.setPlanTag(['ms-beta'], 'release', '1.0'), ['rel-1-0'])
  assert.deepEqual(p.setPlanTag(['x'], 'milestone', 'ms-beta'), ['x', 'ms-beta'])
})

test('orphans have no epic and no milestone or release', () => {
  assert.equal(p.isOrphan(['ui']), true)
  assert.equal(p.isOrphan(['epic-a']), false)
  assert.equal(p.isOrphan(['ms-b']), false)
  assert.equal(p.planValue(['ui'], 'epic'), p.NONE)
})

test('rollup counts cards per epic and milestone, keeps defined empty ones, flags overdue, sorts by deadline', () => {
  const cards = [
    { tags: ['epic-a', 'ms-beta'], done: true },
    { tags: ['epic-a'], done: false },
    { tags: ['epic-b', 'rel-1'], done: false },
    { tags: [], done: false }
  ]
  const items = p.savePlanItem(p.savePlanItem([], 'milestone', 'beta', '2026-10-01'), 'epic', 'empty', '2026-12-01')
  const rows = p.rollup(cards, items, '2026-10-30')
  const by = Object.fromEntries(rows.map(r => [r.tag, r]))
  assert.equal(by['epic-a']!.total, 2)
  assert.equal(by['epic-a']!.done, 1)
  assert.equal(by['ms-beta']!.total, 1)
  assert.equal(by['ms-beta']!.overdue, false) // its one card is done
  assert.equal(by['epic-empty']!.total, 0)
  assert.equal(rows[0]!.tag, 'ms-beta') // earliest deadline first
  assert.equal(rows.at(-1)!.due_at, '') // undated last
  assert.deepEqual(p.sortPlanRows(rows, 'cards')[0]!.tag, 'epic-a')
  const overdue = p.rollup([{ tags: ['ms-beta'], done: false }], items, '2026-10-30')
  assert.equal(overdue.find(r => r.tag === 'ms-beta')!.overdue, true)
})

test('definitions save, update a deadline, remove, and read back safely', () => {
  let list = p.savePlanItem([], 'release', 'v2', '2027-01-15T00:00:00Z')
  list = p.savePlanItem(list, 'release', 'v2', '2027-02-01')
  assert.deepEqual(list, [{ tag: 'rel-v2', kind: 'release', due_at: '2027-02-01' }])
  assert.deepEqual(p.removePlanItem(list, 'rel-v2'), [])
  assert.deepEqual(p.parsePlanItems(JSON.stringify(list)), list)
  assert.deepEqual(p.parsePlanItems('nonsense'), [])
  assert.deepEqual(p.parsePlanItems('[{"tag":"plain"},{"tag":5}]'), [])
})

test('lanes group by project, epic or milestone and label the unplaced', () => {
  const card = { task: { project_id: 'proj' }, tags: ['epic-a'] }
  assert.equal(p.cardLane(card, 'project'), 'proj')
  assert.equal(p.cardLane(card, 'epic'), 'epic-a')
  assert.equal(p.cardLane(card, 'milestone'), p.NONE)
  assert.equal(p.laneLabel(p.NONE, 'milestone'), 'No milestone')
  assert.equal(p.laneLabel('epic-a', 'epic'), 'a')
  assert.equal(p.laneLabel('', 'project'), 'No project')
  // gw.gov-board-read sends null for a blank project (seen 11/6/2026: 50 live cards blanked the desktop Stages view).
  assert.equal(p.cardLane({ task: { project_id: null }, tags: [] }, 'project'), '')
})

test('sketch boards read back with their columns and saved flag; a bad row is dropped', () => {
  const s = { id: 'sk-1', name: 'New Feature', columns: ['Ideas', 'Doing'], notes: [{ text: 'a', col: 'Ideas' }], saved: false }
  assert.deepEqual(p.parseSketches(JSON.stringify([s, { id: 'x' }])), [s])
  assert.equal(p.sketchProject(s), 'new-feature')
  assert.deepEqual(p.parseSketches('{'), [])
})
