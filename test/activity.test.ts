// Board activity (app/utils/activity.ts): the window, the default start, and the cap. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GovTask, GovTaskNote, GovTaskStep } from '../app/types/board.ts'
import { buildActivity } from '../app/utils/activity.ts'

const OWNER = 'person:owner'
const task = (o: Partial<GovTask>): GovTask => ({ task_id: 'TSK-1', title: 'Card', updated_by: 'agt-a', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', work_state: 'backlog', ...o } as GovTask)
const step = (o: Partial<GovTaskStep>): GovTaskStep => ({ step_id: 'S1', task_id: 'TSK-1', role: 'builder', step_state: 'served', verdict: 'PASS', output_summary: 'Built it', updated_at: '2026-10-01T00:00:00Z', lease_owner: 'agt-a', assignee: 'agt-a', cancelled: false, ...o } as GovTaskStep)
const note = (o: Partial<GovTaskNote>): GovTaskNote => ({ note_id: 'N1', task_id: 'TSK-1', author_id: OWNER, kind: 'comment', body: 'hi', created_at: '2026-10-01T00:00:00Z', ...o } as GovTaskNote)

test('a blank since starts at the owner\'s last action and lists what came after, newest first', () => {
  const rows = {
    tasks: [task({ updated_by: OWNER, updated_at: '2026-11-01T22:00:00Z' }), task({ task_id: 'TSK-2', updated_at: '2026-11-02T03:00:00Z', work_state: 'in_progress' })],
    steps: [step({ updated_at: '2026-11-02T05:00:00Z' }), step({ step_id: 'S0', updated_at: '2026-11-01T20:00:00Z' })],
    notes: [note({ created_at: '2026-11-01T21:00:00Z' }), note({ author_id: 'agt-a', kind: 'question', body: 'Which branch?', created_at: '2026-11-02T04:00:00Z' })]
  }
  const a = buildActivity(rows, { owner: OWNER, now: Date.parse('2026-11-02T11:00:00Z') })
  assert.equal(a.since_source, 'last_owner_action')
  assert.equal(a.since, '2026-11-01T22:00:00.000Z')
  assert.deepEqual(a.events.map(e => e.kind), ['step', 'note', 'card'])
  assert.match(a.events[0]!.what, /served \(PASS\): Built it/)
  assert.deepEqual(a.counts, { cards: 1, steps: 1, notes: 1 })
})

test('a given since wins, and until closes the window', () => {
  const rows = { tasks: [task({ updated_at: '2026-11-02T03:00:00Z' }), task({ task_id: 'TSK-2', updated_at: '2026-11-02T09:00:00Z' })], steps: [], notes: [] }
  const a = buildActivity(rows, { since: '2026-11-02T00:00:00Z', until: '2026-11-02T06:00:00Z', owner: OWNER })
  assert.equal(a.since_source, 'given')
  assert.deepEqual(a.events.map(e => e.task_id), ['TSK-1'])
})

test('no owner action and no since means the whole board; a bad date throws', () => {
  const rows = { tasks: [task({ updated_at: '2026-11-02T03:00:00Z' })], steps: [], notes: [] }
  assert.equal(buildActivity(rows, { owner: OWNER, now: Date.parse('2026-11-03T00:00:00Z') }).since_source, 'none')
  assert.throws(() => buildActivity(rows, { since: 'last night', owner: OWNER }), /since is not a date/)
})

test('the list is capped at 100 but total keeps the true count', () => {
  const notes = Array.from({ length: 150 }, (_, i) => note({ note_id: `N${i}`, author_id: 'agt-a', created_at: '2026-11-02T03:00:00Z' }))
  const a = buildActivity({ tasks: [], steps: [], notes }, { since: '2026-11-01T00:00:00Z', owner: OWNER, now: Date.parse('2026-11-03T00:00:00Z') })
  assert.equal(a.events.length, 100)
  assert.equal(a.total, 150)
})
