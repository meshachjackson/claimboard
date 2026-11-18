// Board report tools (app/utils/report.ts): the four briefing findings, the generic tools, and a large board. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GovTask } from '../app/types/board.ts'
import { BRIEFING_TOOLS, buildReport, parseTools, reportFilter, REPORT_PAGE_TOOLS } from '../app/utils/report.ts'

const NOW = Date.parse('2026-10-30T12:00:00')
let n = 0
const task = (o: Partial<GovTask> = {}): GovTask => ({
  task_id: `TSK-${String(++n).padStart(6, '0')}`, title: `Card ${n}`, original_request: '', acceptance_requirements: '', task_type: 'build',
  proposed_assignee: '', assignee: 'agt-a', upgrade_target: '', execution_policy: 'auto', approval_state: 'not_required', work_state: 'backlog',
  current_step: 0, steps_total: 0, outputs_ref: '', internal_verification: '', macro_verification: '', escalation: 'none', priority: 'normal',
  project_id: 'p', created_by: '', created_at: '2026-10-01T00:00:00Z', due_at: null, updated_by: '', updated_at: '2026-10-01T00:00:00Z', ...o
})
const run = (tasks: GovTask[], spec: string | string[] = [...BRIEFING_TOOLS]) => buildReport({ tasks }, spec, { now: NOW })
const section = (tasks: GovTask[], tool: string) => run(tasks, tool).sections[0]!

test('orphans: open cards with no project and no assignee only', () => {
  const s = section([
    task({ project_id: '', assignee: '' }),
    task({ project_id: '', assignee: '', work_state: 'done' }),
    task({ project_id: '', assignee: '', archived_at: '2026-10-02T00:00:00Z' }),
    task({ project_id: '', assignee: 'agt-a' }),
    task({ project_id: 'p', assignee: '' })
  ], 'orphans')
  assert.equal(s.count, 1)
  assert.equal(s.task_ids.length, 1)
})

test('batchable: three or more backlog cards of one project, type and person', () => {
  const same = [task(), task(), task()]
  const s = section([...same, task({ project_id: 'q' }), task({ work_state: 'in_progress' })], 'batchable')
  assert.equal(s.count, 3)
  assert.equal(s.block.kind === 'cards' && s.block.items.length, 1)
  assert.match(s.summary, /3 cards fall into 1 batch/)
  assert.deepEqual(s.task_ids, same.map(t => t.task_id))
  const row = s.block.kind === 'cards' ? s.block.items[0]! : null
  assert.deepEqual(row?.task_ids, same.map(t => t.task_id))
  assert.deepEqual([row?.project, row?.type, row?.who], ['p', 'build', 'agt-a'])
})

test('almost_done: a project with work done and one or two cards left, naming them', () => {
  const s = section([
    task({ project_id: 'near', work_state: 'done' }), task({ project_id: 'near', work_state: 'done' }), task({ project_id: 'near', title: 'Last one' }),
    task({ project_id: 'far', work_state: 'done' }), task({ project_id: 'far' }), task({ project_id: 'far' }), task({ project_id: 'far' }),
    task({ project_id: 'all', work_state: 'done' })
  ], 'almost_done')
  assert.equal(s.count, 1)
  assert.equal(s.block.kind === 'projects' && s.block.rows[0]!.closers[0]!.title, 'Last one')
  // The finding covers the open cards; the row covers the whole project, for its hover.
  assert.equal(s.task_ids.length, 1)
  assert.equal(s.block.kind === 'projects' && s.block.rows[0]!.task_ids.length, 3)
})

test('behind: most open cards overdue, at least two; a bare due day is late only after it ends', () => {
  const late = '2026-10-01'
  const s = section([
    task({ project_id: 'late', due_at: late }), task({ project_id: 'late', due_at: late }), task({ project_id: 'late' }),
    task({ project_id: 'ok', due_at: late }), task({ project_id: 'ok' }), task({ project_id: 'ok' }), task({ project_id: 'ok' }),
    task({ project_id: 'today', due_at: '2026-10-30' }), task({ project_id: 'today', due_at: '2026-10-30' })
  ], 'behind')
  assert.equal(s.count, 1)
  assert.equal(s.block.kind === 'projects' && s.block.rows[0]!.project, 'late')
  assert.equal(s.task_ids.length, 3)
})

test('overdue: a timeline of open cards late or due within 90 days; count is the late ones, split at the second', () => {
  const nowIso = new Date(NOW).toISOString()
  const s = section([
    task({ due_at: '2026-10-29' }), // bare day, ended: late
    task({ due_at: '2026-10-30' }), // bare day, still running: upcoming
    task({ due_at: new Date(NOW - 1000).toISOString() }), // one second ago: late
    task({ due_at: nowIso }), // this exact moment: not yet late
    task({ due_at: '2027-01-27' }), // 89 days out: shown
    task({ due_at: '2027-03-01' }), // beyond 90 days: left off
    task({ due_at: '2026-10-01', work_state: 'done' }), // done: left off
    task({ due_at: null })
  ], 'overdue')
  assert.equal(s.count, 2)
  assert.equal(s.task_ids.length, 2)
  assert.ok(s.block.kind === 'timeline')
  assert.deepEqual(s.block.items.map(i => i.late), [true, true, false, false, false])
  assert.equal(s.block.total, 5)
})

test('progress: every project and No project, covering each non-archived card once, No project last', () => {
  const tasks = [
    task({ project_id: 'a', work_state: 'done' }), task({ project_id: 'a', stage: 'build', work_state: 'in_progress' }), task({ project_id: 'a' }),
    task({ project_id: 'b', stage: 'done', work_state: 'done' }),
    task({ project_id: '' }), task({ project_id: '', work_state: 'done' }), task({ project_id: '', work_state: 'verifying' }),
    task({ project_id: 'a', archived_at: '2026-10-02T00:00:00Z' })
  ]
  const s = section(tasks, 'progress')
  assert.equal(s.count, 0)
  assert.ok(s.block.kind === 'projects')
  assert.deepEqual(s.block.rows.map(r => r.project), ['b', 'a', ''])
  const covered = s.block.rows.flatMap(r => r.task_ids)
  assert.deepEqual([...covered].sort(), tasks.filter(t => !t.archived_at).map(t => t.task_id).sort())
  assert.equal(new Set(covered).size, covered.length)
  const a = s.block.rows.find(r => r.project === 'a')!
  assert.deepEqual([a.total, a.done, a.in_flight, a.open], [3, 1, 1, 2])
  // A card with no stage reads it from work_state: verifying is in flight, backlog is not.
  assert.equal(s.block.rows.find(r => r.project === '')!.in_flight, 1)
})

test('progress is a chart of every project, so the row cap does not apply', () => {
  const tasks = Array.from({ length: 12 }, (_, i) => task({ project_id: `proj-${i}` }))
  const s = run(tasks, 'progress').sections[0]!
  assert.ok(s.block.kind === 'projects' && s.block.rows.length === 12 && s.block.total === 12)
})

test('reportFilter: a finding or one batch by index; unknown keys filter nothing', () => {
  const a = [task({ project_id: 'a' }), task({ project_id: 'a' }), task({ project_id: 'a' })]
  const b = [task({ project_id: 'b' }), task({ project_id: 'b' }), task({ project_id: 'b' }), task({ project_id: 'b' })]
  const rows = { tasks: [...a, ...b, task({ project_id: '', assignee: '' })] }
  assert.equal(reportFilter(rows, 'orphans', { now: NOW })!.task_ids.length, 1)
  assert.deepEqual(reportFilter(rows, 'batchable:0', { now: NOW })!.task_ids, b.map(t => t.task_id)) // the biggest batch is first
  assert.deepEqual(reportFilter(rows, 'batchable:1', { now: NOW })!.task_ids, a.map(t => t.task_id))
  assert.equal(reportFilter(rows, 'batchable:2', { now: NOW }), null)
  assert.equal(reportFilter(rows, 'breakdown:priority', { now: NOW }), null)
  assert.equal(reportFilter(rows, 'nope', { now: NOW }), null)
  assert.equal(reportFilter(rows, 'batchable', { now: NOW })!.task_ids.length, 7)
})

test('the page default is the briefing plus progress', () => {
  assert.deepEqual([...REPORT_PAGE_TOOLS], [...BRIEFING_TOOLS, 'progress'])
})

test('breakdown counts open cards by the named field and falls back to work_state', () => {
  const tasks = [task({ priority: 'high' }), task({ priority: 'high' }), task({ priority: 'low' }), task({ work_state: 'done' })]
  const s = section(tasks, 'breakdown:priority')
  assert.deepEqual(s.block.kind === 'bars' && s.block.rows.map(r => [r.label, r.value, r.task_ids.length]), [['high', 2, 2], ['low', 1, 1]])
  assert.equal(s.count, 0)
  assert.equal(s.task_ids.length, 3)
  assert.equal(section(tasks, 'breakdown:nonsense').block.kind, 'bars')
})

test('parseTools keeps unknown names so a typo is reported', () => {
  assert.deepEqual(parseTools('orphans, nope,breakdown:stage'), { tools: [{ name: 'orphans', arg: '' }, { name: 'breakdown', arg: 'stage' }], unknown: ['nope'] })
})

test('a board with 600 cards reports fast and keeps lists short', () => {
  const tasks = Array.from({ length: 600 }, (_, i) => task({ project_id: i % 3 ? `proj-${i % 40}` : '', assignee: i % 3 ? 'agt-a' : '', due_at: i % 2 ? '2026-09-01' : null }))
  const start = performance.now()
  const r = run(tasks, 'orphans,batchable,almost_done,behind,overdue,breakdown:project_id')
  assert.ok(performance.now() - start < 250)
  for (const s of r.sections) {
    const rows = s.block.kind === 'bars' || s.block.kind === 'projects' ? s.block.rows : s.block.items
    assert.ok(rows.length <= 8)
  }
  assert.equal(r.sections[0]!.count, 200)
  assert.equal(r.sections[0]!.task_ids.length, 200) // ids are never capped
})
