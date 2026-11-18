// CSV import and export: header matching, row checks and the exported file. Every row here is invented.
// Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  const root = ${JSON.stringify(new URL('../', import.meta.url).href)}
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', root).href
  if (spec.startsWith('~~/')) spec = new URL('./' + spec.slice(3) + '.ts', root).href
  return next(spec, ctx)
}`))
// These fixtures are the owner's: the board owner is a setting, so the tests set it.
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

let suggestMapping: typeof import('../app/utils/boardCsv.ts').suggestMapping
let buildRows: typeof import('../app/utils/boardCsv.ts').buildRows
let applyProposal: typeof import('../app/utils/csvProposal.ts').applyProposal
let tableProblem: typeof import('../app/utils/boardCsv.ts').tableProblem
let cardsToCsv: typeof import('../app/utils/boardCsv.ts').cardsToCsv
let parseCsv: typeof import('../shared/csv.ts').parseCsv
before(async () => {
  ({ suggestMapping, buildRows, tableProblem, cardsToCsv } = await import('../app/utils/boardCsv.ts'));
  ({ applyProposal } = await import('../app/utils/csvProposal.ts'));
  ({ parseCsv } = await import('../shared/csv.ts'))
})

const ASSIGNEES = ['person:meshach', 'agt-builder-local']

test('a Jira-style header row matches by name, each column once', () => {
  const m = suggestMapping(['Issue key', 'Summary', 'Description', 'Issue Type', 'Priority', 'Labels', 'Due Date', 'Assignee', 'Epic Link', 'Project'])
  assert.deepEqual(
    [m.title, m.original_request, m.task_type, m.priority, m.tags, m.due_at, m.assignee],
    [1, 2, 3, 4, 5, 6, 7]
  )
  assert.equal(m.project_id, 9) // "Project" is listed before "Epic", so it wins
  assert.equal(m.acceptance_requirements, -1)
})

test('an exact field name beats an alias, and a column is used once', () => {
  const m = suggestMapping(['Type', 'task_type', 'Title'])
  assert.equal(m.task_type, 1)
  assert.equal(m.title, 2)
  assert.ok(!Object.values(m).filter(i => i !== -1).some((i, n, all) => all.indexOf(i) !== n))
})

test('headers that match nothing leave every field unmapped', () => {
  assert.ok(Object.values(suggestMapping(['foo', 'bar'])).every(i => i === -1))
})

test('a good row becomes create_task fields; priority words and tags are folded to the editor\'s forms', () => {
  const table = [['Summary', 'Priority', 'Labels', 'Due Date', 'Assignee', 'Type'], ['  Fix login  ', 'Highest', 'Bug Fix; UI', '2026-11-02', 'agt-builder-local', 'Build']]
  const [row] = buildRows(table, suggestMapping(table[0]!), ASSIGNEES)
  assert.deepEqual(row!.errors, [])
  assert.deepEqual(row!.fields, { title: 'Fix login', priority: 'urgent', tags: 'bug-fix,ui', due_at: '2026-11-02', assignee: 'agt-builder-local', task_type: 'build' })
  assert.equal(row!.line, 2)
})

test('rows that create_task would refuse show an error each, and the good rows around them stay ready', () => {
  const table = [
    ['title', 'task_type', 'tags', 'due_at', 'assignee'],
    ['ok', '', '', '', ''],
    ['', '', '', '', ''],
    ['bad type', 'upgrade', '', '', ''],
    ['bad tag', '', 'a/b', '', ''],
    ['bad date', '', '', 'someday', ''],
    ['bad assignee', '', '', '', 'agt-nobody'],
    ['x'.repeat(201), '', '', '', '']
  ]
  const rows = buildRows(table, suggestMapping(table[0]!), ASSIGNEES)
  assert.deepEqual(rows.map(r => r.errors.length), [0, 1, 1, 1, 1, 1, 1])
  assert.match(rows[1]!.errors[0]!, /title is blank/)
  assert.match(rows[2]!.errors[0]!, /upgrade/)
  assert.match(rows[3]!.errors[0]!, /a\/b/)
  assert.match(rows[4]!.errors[0]!, /someday/)
  assert.match(rows[5]!.errors[0]!, /agt-nobody/)
  assert.match(rows[6]!.errors[0]!, /over 200/)
})

test('a short row and an unmapped title give a blank title error, not a crash', () => {
  const table = [['title', 'priority'], ['only a title']]
  assert.deepEqual(buildRows(table, suggestMapping(table[0]!), ASSIGNEES)[0]!.errors, [])
  const none = buildRows(table, { ...suggestMapping(table[0]!), title: -1 }, ASSIGNEES)
  assert.match(none[0]!.errors[0]!, /title is blank/)
})

test('tableProblem refuses a file with no data rows or too many', () => {
  assert.match(tableProblem([['title']]), /no data rows/)
  assert.match(tableProblem([['title'], ...Array.from({ length: 201 }, () => ['x'])]), /at most 200/)
  assert.equal(tableProblem([['title'], ['x']]), '')
})

test('an export round-trips: the same cards re-import with every column matched by name', () => {
  const task = {
    task_id: 'TSK-930900', title: 'Say "hi", then go\nnext', original_request: 'a, b', acceptance_requirements: 'one | two', task_type: 'build',
    priority: 'high', project_id: 'demo', tags: 'x,y', due_at: null, assignee: 'agt-builder-local', approval_state: 'not_required', created_at: '2026-10-29T10:00:00.000Z'
  }
  const csv = cardsToCsv([{ task, stage: 'build', workState: 'in_progress' } as never])
  const table = parseCsv(csv)
  assert.equal(table.length, 2)
  assert.deepEqual(table[0]!.slice(0, 3), ['task_id', 'title', 'original_request'])
  // The export's task_id column is matched, so re-importing updates the same card rather than copying it.
  const rows = buildRows(table, suggestMapping(table[0]!), ASSIGNEES, [{ task_id: task.task_id, title: 'old', work_state: 'in_progress' }])
  assert.deepEqual(rows[0]!.errors, [])
  assert.equal(rows[0]!.action, 'update')
  assert.equal(rows[0]!.taskId, task.task_id)
  assert.equal(rows[0]!.fields.title, task.title)
  assert.equal(rows[0]!.fields.tags, 'x,y')
  assert.equal(rows[0]!.fields.due_at, undefined)
  // Create-only fields are dropped from an update, not refused.
  assert.equal(rows[0]!.fields.original_request, undefined)
  assert.equal(rows[0]!.fields.approval_state, undefined)
  assert.equal(table[1]![table[0]!.indexOf('stage')], 'build')
  assert.equal(table[1]![table[0]!.indexOf('work_state')], 'in_progress')
})

test('toCsv and parseCsv agree on commas, quotes, line breaks and non-ASCII text', async () => {
  const { toCsv } = await import('../shared/csv.ts')
  const rows = [['a', 'b,c', 'say "x"'], ['line1\nline2', ' é ', '']]
  assert.deepEqual(parseCsv(toCsv(rows)), rows)
})

// ---------- Second slice: update by key and the duplicate check ----------

const EXISTING = [
  { task_id: 'TSK-930001', title: 'Fix the login page', work_state: 'in_progress' },
  { task_id: 'TSK-930002', title: 'Old and gone', work_state: 'done', archived_at: '2026-10-01T00:00:00.000Z' },
  { task_id: 'TSK-930003', title: 'Finished', work_state: 'done' }
]

test('a row with a known task_id is an update of that card, with only update_task fields and a typed-in id folded to upper case', () => {
  const table = [['Task ID', 'title', 'priority', 'original_request', 'approval_state', 'assignee'], ['tsk-930001', 'Fix login', 'Highest', 'drop me', 'pending', 'agt-builder-local']]
  const m = suggestMapping(table[0]!)
  assert.equal(m.task_id, 0)
  const [row] = buildRows(table, m, ASSIGNEES, EXISTING)
  assert.deepEqual(row!.errors, [])
  assert.equal(row!.action, 'update')
  assert.equal(row!.taskId, 'TSK-930001')
  assert.deepEqual(row!.fields, { title: 'Fix login', priority: 'urgent', assignee: 'agt-builder-local' })
  assert.equal(row!.duplicate, '')
})

test('an update row may leave the title blank; a row with nothing but an id has nothing to update', () => {
  const table = [['task_id', 'title', 'tags'], ['TSK-930001', '', 'ui'], ['TSK-930001', '', '']]
  const rows = buildRows(table, suggestMapping(table[0]!), ASSIGNEES, EXISTING)
  assert.deepEqual(rows[0]!.errors, [])
  assert.deepEqual(rows[0]!.fields, { tags: 'ui' })
  assert.match(rows[1]!.errors[0]!, /nothing to update/)
})

test('an unknown, archived or done id is refused on its row, and the good rows around it stay ready', () => {
  const table = [['task_id', 'title'], ['TSK-930999', 'x'], ['TSK-930002', 'x'], ['TSK-930003', 'x'], ['TSK-930001', 'x']]
  const rows = buildRows(table, suggestMapping(table[0]!), ASSIGNEES, EXISTING)
  assert.match(rows[0]!.errors[0]!, /no card TSK-930999/)
  assert.match(rows[1]!.errors[0]!, /TSK-930002 is archived/)
  assert.match(rows[2]!.errors[0]!, /TSK-930003 is done/)
  assert.deepEqual(rows[3]!.errors, [])
})

test('a blank task_id cell creates a card; a Jira "Issue key" or Linear "ID" column is never taken for a board id', () => {
  const table = [['task_id', 'title'], ['', 'Brand new']]
  const [row] = buildRows(table, suggestMapping(table[0]!), ASSIGNEES, EXISTING)
  assert.equal(row!.action, 'create')
  assert.deepEqual(row!.errors, [])
  assert.equal(suggestMapping(['Issue key', 'ID', 'Key', 'Summary']).task_id, -1)
})

test('a create row whose title matches a live card is marked a duplicate, case and spacing folded; archived cards do not count', () => {
  const table = [['title'], ['  fix THE   login page '], ['Old and gone'], ['Finished'], ['Something else']]
  const rows = buildRows(table, suggestMapping(table[0]!), ASSIGNEES, EXISTING)
  assert.deepEqual(rows.map(r => r.duplicate), ['TSK-930001', '', 'TSK-930003', ''])
  // A duplicate is a warning, not an error: the user can still check it.
  assert.deepEqual(rows.map(r => r.errors.length), [0, 0, 0, 0])
})

test('an update row is never a duplicate, even when its title matches another card', () => {
  const table = [['task_id', 'title'], ['TSK-930001', 'Something else'], ['TSK-930001', 'Finished']]
  const rows = buildRows(table, suggestMapping(table[0]!), ASSIGNEES, EXISTING)
  assert.deepEqual(rows.map(r => r.duplicate), ['', ''])
})

test('a board manager proposal maps epics and milestones by header name, and bad entries are reported', () => {
  const headers = ['Key', 'Summary', 'Epic Name', 'Fix Version/s']
  const r = applyProposal(JSON.stringify({ mapping: { title: 'summary', project_id: 'EPIC NAME', tags: 'Fix Version/s', priority: 'Urgency', bogus: 'Key', assignee: 'Summary', due_at: null }, notes: 'Epic to Project, version to Tags.' }), headers)
  assert.deepEqual([r.mapping.title, r.mapping.project_id, r.mapping.tags, r.mapping.priority, r.mapping.assignee], [1, 2, 3, -1, -1])
  assert.equal(r.notes, 'Epic to Project, version to Tags.')
  assert.equal(r.problems.length, 3) // no Urgency column, "bogus" is not a field, Summary used twice
})

test('a proposal that is not JSON or has no mapping changes nothing', () => {
  assert.match(applyProposal('nope', ['A']).problems[0]!, /not valid JSON/)
  assert.match(applyProposal('{}', ['A']).problems[0]!, /no "mapping"/)
})
