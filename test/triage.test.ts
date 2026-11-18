// The board triage rules pass: one test per rule, plus pinned cards, merging, and the line grammar.
// Rows are invented. Run with `pnpm test`.
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

let triageBoard: typeof import('../app/utils/triage.ts').triageBoard
let formatFindingLine: typeof import('../app/utils/triage.ts').formatFindingLine
let parseFindingLine: typeof import('../app/utils/triage.ts').parseFindingLine
before(async () => {
  ({ triageBoard, formatFindingLine, parseFindingLine } = await import('../app/utils/triage.ts'))
})

const NOW = Date.parse('2026-10-29T12:00:00.000Z')
const ago = (days: number, hours = 0) => new Date(NOW - days * 86_400_000 - hours * 3_600_000).toISOString()

// Builders return the full row shape the pass reads; each test overrides only what it checks.
const task = (id: string, o: Record<string, unknown> = {}) => ({
  task_id: id, title: `Card ${id}`, original_request: '', acceptance_requirements: 'It works', task_type: 'build',
  proposed_assignee: '', assignee: '', upgrade_target: '', execution_policy: 'manual', approval_state: 'not_required',
  work_state: 'in_progress', current_step: 0, steps_total: 0, outputs_ref: '', internal_verification: 'none', macro_verification: 'none',
  escalation: 'none', priority: 'normal', project_id: 'p', created_by: 'person:meshach', created_at: ago(30), due_at: null,
  updated_by: 'person:meshach', updated_at: ago(1), stage: 'build', tags: '', archived_at: null, pinned_at: null, ...o
}) as never
const step = (id: string, taskId: string, o: Record<string, unknown> = {}) => ({
  step_id: id, task_id: taskId, step_no: 1, assignee: 'agt-a', goal: '', input_ref: '', target_action: '', target_ticket_ref: '',
  step_state: 'awaiting_pull', stop_reason: '', verdict: '', budget_used: '', output_ref: '', output_summary: '', vera_ticket_ref: '',
  created_at: ago(1), dispatched_at: null, ended_at: null, updated_at: ago(1), claim_key: '', lease_owner: '', lease_expires_at: null,
  acked_at: null, cancelled: false, claim_count: 0, last_claimed_at: null, role: 'builder', activity: '', heartbeat_at: null, ...o
}) as never
const note = (id: string, taskId: string, author: string, kind: string, createdAt: string) =>
  ({ note_id: id, task_id: taskId, step_id: '', author_id: author, kind, body: 'x', created_at: createdAt }) as never
const agent = (id: string, o: Record<string, unknown> = {}) => ({ agent_id: id, lifecycle_status: 'active', agent_type: 'builder', ...o }) as never

const run = (tasks: unknown[], steps: unknown[] = [], notes: unknown[] = [], registry: unknown[] = [agent('agt-a')]) =>
  triageBoard({ tasks, steps, notes, registry } as never, { now: NOW })
const only = (f: ReturnType<typeof run>, id: string) => f.find(x => x.task_id === id)

test('stale: an open card with no activity for 7 days is a close; an open step makes it keep', () => {
  const f = run([task('TSK-1', { updated_at: ago(9) }), task('TSK-2', { updated_at: ago(9) }), task('TSK-3', { updated_at: ago(2) })],
    [step('STP-1', 'TSK-2', { updated_at: ago(9) })])
  assert.equal(only(f, 'TSK-1')?.action, 'close')
  assert.deepEqual(only(f, 'TSK-1')?.rules, ['stale'])
  assert.equal(only(f, 'TSK-2')?.action, 'keep')
  assert.equal(only(f, 'TSK-3'), undefined)
})

test('stale: a recent note or step heartbeat counts as activity', () => {
  const f = run([task('TSK-1', { updated_at: ago(20) }), task('TSK-2', { updated_at: ago(20) })],
    [step('STP-1', 'TSK-2', { updated_at: ago(20), heartbeat_at: ago(0, 3) })],
    [note('NTE-1', 'TSK-1', 'agt-a', 'status', ago(1))])
  assert.equal(only(f, 'TSK-1'), undefined)
  assert.equal(only(f, 'TSK-2'), undefined)
})

test('test_card: a test tag or a title starting with Test closes an open card and archives a Done one', () => {
  const f = run([
    task('TSK-1', { tags: 'ops,Test' }), task('TSK-2', { title: 'Test the gateway' }),
    task('TSK-3', { title: 'Testing notes for later' }), task('TSK-4', { title: 'Latest results' }),
    task('TSK-5', { tags: 'test', work_state: 'done', stage: 'done', updated_at: ago(1) })
  ])
  assert.equal(only(f, 'TSK-1')?.action, 'close')
  assert.equal(only(f, 'TSK-2')?.action, 'close')
  assert.equal(only(f, 'TSK-3'), undefined) // "Testing" is not the word "Test"
  assert.equal(only(f, 'TSK-4'), undefined)
  assert.equal(only(f, 'TSK-5')?.action, 'archive')
  assert.deepEqual(only(f, 'TSK-5')?.rules, ['test_card'])
})

test('duplicate: the later card folds into the earlier one; unrelated titles do not match', () => {
  const f = run([
    task('TSK-1', { title: 'Add a pin button to the drawer', created_at: ago(10) }),
    task('TSK-2', { title: 'add a pin button to the drawer!', created_at: ago(3) }),
    task('TSK-3', { title: 'Fix the login redirect', created_at: ago(2) }),
    task('TSK-4', { title: 'Pin', created_at: ago(1) })
  ])
  assert.equal(only(f, 'TSK-1'), undefined)
  assert.equal(only(f, 'TSK-2')?.action, 'fold')
  assert.match(only(f, 'TSK-2')!.reason, /TSK-1/)
  assert.equal(only(f, 'TSK-3'), undefined)
  assert.equal(only(f, 'TSK-4'), undefined)
})

test('duplicate: close titles with most words in common match, short titles need to be identical', () => {
  const f = run([
    task('TSK-1', { title: 'Show the owner name on every card in the board', created_at: ago(5) }),
    task('TSK-2', { title: 'Show the owner name on every card in board', created_at: ago(4) }),
    task('TSK-3', { title: 'Fix login', created_at: ago(3) }),
    task('TSK-4', { title: 'Fix logout', created_at: ago(2) })
  ])
  assert.equal(only(f, 'TSK-2')?.action, 'fold')
  assert.equal(only(f, 'TSK-4'), undefined)
})

test('done_old: a Done card not updated for more than 14 days is archived; 14 days or fewer is left alone', () => {
  const f = run([
    task('TSK-1', { work_state: 'done', stage: 'done', updated_at: ago(15) }),
    task('TSK-2', { work_state: 'done', stage: 'done', updated_at: ago(14) }),
    task('TSK-3', { work_state: 'done', stage: 'done', updated_at: ago(40), archived_at: ago(1) })
  ])
  assert.equal(only(f, 'TSK-1')?.action, 'archive')
  assert.deepEqual(only(f, 'TSK-1')?.rules, ['done_old'])
  assert.equal(only(f, 'TSK-2'), undefined)
  assert.equal(only(f, 'TSK-3'), undefined) // already archived
})

test('done_open_steps: a Done card with an open step is keep, and it is not offered for archive', () => {
  const f = run([task('TSK-1', { work_state: 'done', stage: 'done', updated_at: ago(30) }), task('TSK-2', { work_state: 'done', stage: 'done', updated_at: ago(30) })],
    [step('STP-1', 'TSK-1', { step_state: 'awaiting_pull' }), step('STP-2', 'TSK-2', { step_state: 'served', acked_at: ago(30) }), step('STP-3', 'TSK-2', { cancelled: true })])
  assert.equal(only(f, 'TSK-1')?.action, 'keep')
  assert.deepEqual(only(f, 'TSK-1')?.rules, ['done_open_steps'])
  assert.match(only(f, 'TSK-1')!.evidence, /STP-1/)
  assert.equal(only(f, 'TSK-2')?.action, 'archive') // finished and cancelled steps do not count
})

test('unreachable_step: a waiting step for a missing or inactive agent, or an empty pool, is keep', () => {
  const registry = [agent('agt-a'), agent('agt-asleep', { lifecycle_status: 'retired' }), agent('agt-adv', { agent_type: 'advisor' })]
  const f = run(
    [task('TSK-1'), task('TSK-2'), task('TSK-3'), task('TSK-4'), task('TSK-5'), task('TSK-6')],
    [
      step('STP-1', 'TSK-1', { assignee: 'agt-asleep' }), step('STP-2', 'TSK-2', { assignee: 'agt-ghost' }),
      step('STP-3', 'TSK-3', { assignee: 'pool:reviewer' }), step('STP-4', 'TSK-4', { assignee: 'agt-a' }),
      step('STP-5', 'TSK-5', { assignee: 'pool:advisor' }), step('STP-6', 'TSK-6', { assignee: 'agt-ghost', step_state: 'dispatched' })
    ], [], registry)
  for (const id of ['TSK-1', 'TSK-2', 'TSK-3']) {
    assert.equal(only(f, id)?.action, 'keep', id)
    assert.deepEqual(only(f, id)?.rules, ['unreachable_step'], id)
  }
  assert.equal(only(f, 'TSK-4'), undefined) // active agent
  assert.equal(only(f, 'TSK-5'), undefined) // pool has an active member
  assert.equal(only(f, 'TSK-6'), undefined) // already claimed, not waiting
})

test('no_reply: your comment with no later reply after 24 hours is keep; a reply, a system note, or a newer comment settles it', () => {
  const f = run(
    [task('TSK-1'), task('TSK-2'), task('TSK-3'), task('TSK-4'), task('TSK-5')],
    [],
    [
      note('NTE-1', 'TSK-1', 'person:meshach', 'comment', ago(2)),
      note('NTE-2', 'TSK-2', 'person:meshach', 'comment', ago(2)), note('NTE-3', 'TSK-2', 'agt-a', 'status', ago(1)),
      note('NTE-4', 'TSK-3', 'person:meshach', 'comment', ago(2)), note('NTE-5', 'TSK-3', 'system', 'system', ago(1)),
      note('NTE-6', 'TSK-4', 'person:meshach', 'comment', ago(0, 5)),
      note('NTE-7', 'TSK-5', 'person:meshach', 'status', ago(5))
    ])
  assert.equal(only(f, 'TSK-1')?.action, 'keep')
  assert.deepEqual(only(f, 'TSK-1')?.rules, ['no_reply'])
  assert.equal(only(f, 'TSK-2'), undefined)
  assert.equal(only(f, 'TSK-3')?.action, 'keep') // a system line is not a reply
  assert.equal(only(f, 'TSK-4'), undefined) // 5 hours is inside the threshold
  assert.equal(only(f, 'TSK-5'), undefined) // a status note is not a comment
})

test('no_reply: the thresholds are options', () => {
  const rows = { tasks: [task('TSK-1')], steps: [], notes: [note('NTE-1', 'TSK-1', 'person:meshach', 'comment', ago(0, 5))], registry: [] } as never
  assert.equal(triageBoard(rows, { now: NOW }).length, 0)
  assert.equal(triageBoard(rows, { now: NOW, replyHours: 4 })[0]?.rules[0], 'no_reply')
})

test('no_criteria: an open card with blank acceptance_requirements is a rewrite; Done cards are left alone', () => {
  const f = run([
    task('TSK-1', { acceptance_requirements: '' }), task('TSK-2', { acceptance_requirements: '   ' }),
    task('TSK-3', { acceptance_requirements: 'a | b' }), task('TSK-4', { acceptance_requirements: '', work_state: 'done', stage: 'done', updated_at: ago(1) })
  ])
  assert.equal(only(f, 'TSK-1')?.action, 'rewrite')
  assert.equal(only(f, 'TSK-2')?.action, 'rewrite')
  assert.equal(only(f, 'TSK-3'), undefined)
  assert.equal(only(f, 'TSK-4'), undefined)
})

test('pinned cards are never flagged to close, archive or fold; other flags still show', () => {
  const f = run([
    task('TSK-1', { pinned_at: ago(1), updated_at: ago(30), title: 'Test pinned', acceptance_requirements: '' }),
    task('TSK-2', { pinned_at: ago(1), work_state: 'done', stage: 'done', updated_at: ago(30) }),
    task('TSK-3', { title: 'Same title card here', created_at: ago(9) }),
    task('TSK-4', { title: 'Same title card here', created_at: ago(8), pinned_at: ago(1) })
  ])
  assert.equal(only(f, 'TSK-1')?.action, 'rewrite') // close (stale, test) dropped, the rewrite stays
  assert.deepEqual(only(f, 'TSK-1')?.rules, ['no_criteria'])
  assert.equal(only(f, 'TSK-2'), undefined)
  assert.equal(only(f, 'TSK-4'), undefined)
  assert.ok(f.every(x => !(['TSK-1', 'TSK-2', 'TSK-4'].includes(x.task_id) && ['close', 'archive', 'fold'].includes(x.action))))
})

test('one finding per card: the strongest action wins and reasons and evidence are joined', () => {
  const f = run([task('TSK-1', { updated_at: ago(12), acceptance_requirements: '' }), task('TSK-2')])
  const a = f.filter(x => x.task_id === 'TSK-1')
  assert.equal(a.length, 1)
  assert.equal(a[0]!.action, 'close')
  assert.deepEqual(a[0]!.rules, ['stale', 'no_criteria'])
  assert.match(a[0]!.reason, /No activity for 12 days; No acceptance criteria/)
  assert.equal(a[0]!.source, 'rules')
  // Strongest first in the output list.
  const mixed = run([task('TSK-9', { acceptance_requirements: '' }), task('TSK-8', { updated_at: ago(12) })])
  assert.deepEqual(mixed.map(x => x.action), ['close', 'rewrite'])
})

test('the pass reads only: the rows are not changed', () => {
  const rows = { tasks: [task('TSK-1', { updated_at: ago(12) })], steps: [], notes: [], registry: [] } as never
  const before = JSON.stringify(rows)
  triageBoard(rows, { now: NOW })
  assert.equal(JSON.stringify(rows), before)
})

test('line grammar: format and parse round trip, and a separator inside a field is replaced', () => {
  const f = { task_id: 'TSK-930121', action: 'close' as const, reason: 'No activity for 12 days', evidence: 'last activity 10/17/2026' }
  const line = formatFindingLine(f)
  assert.equal(line, 'TSK-930121 · close · No activity for 12 days · last activity 10/17/2026')
  assert.deepEqual(parseFindingLine(line), f)
  const messy = formatFindingLine({ ...f, reason: 'a · b', evidence: 'x\ny' })
  assert.deepEqual(parseFindingLine(messy), { ...f, reason: 'a, b', evidence: 'x y' })
  assert.equal(parseFindingLine('TSK-1 · explode · r · e'), null)
  assert.equal(parseFindingLine('not a line'), null)
  assert.equal(parseFindingLine('TSK-1 · close · r'), null)
})

// "File as card": the fields of the triage card, and the same-day check.

test('triage card: title carries the American date, tag is triage, the lines are the acceptance text', async () => {
  const { triageCardFields, triageCardTitle, existingTriageCard } = await import('../app/utils/triage.ts')
  const f = run([task('TSK-1', { updated_at: ago(9) }), task('TSK-2', { title: 'Test the gateway' })])
  const fields = triageCardFields(f, NOW)
  assert.equal(fields.title, triageCardTitle(NOW))
  assert.match(fields.title, /^Triage \d{2}\/\d{2}\/\d{4}$/)
  assert.equal(fields.tags, 'triage')
  assert.match(fields.original_request, /2 cards/)
  const lines = fields.acceptance_requirements.split('\n')
  assert.equal(lines.length, 2)
  assert.deepEqual(lines.map(l => parseFindingLine(l)?.task_id), ['TSK-1', 'TSK-2'])

  // The same-day check sees a live card with the title and ignores an archived one.
  const filed = task('TSK-9', { title: fields.title })
  assert.equal(existingTriageCard([task('TSK-8'), filed], fields.title), filed)
  assert.equal(existingTriageCard([task('TSK-9', { title: fields.title, archived_at: ago(0, 1) })], fields.title), undefined)
  assert.equal(existingTriageCard([task('TSK-9', { title: 'Triage 01/01/2020' })], fields.title), undefined)
})

test('the dialog has File as card, and the phone menu has Triage board', async () => {
  const { readFileSync } = await import('node:fs')
  const src = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
  const dialog = src('app/components/TriageBoard.vue')
  assert.ok(dialog.includes('File as card'), 'TriageBoard.vue has no File as card button')
  assert.ok(/createTask\(/.test(dialog), 'File as card does not go through the store')
  const phone = src('app/components/PhoneMore.vue')
  assert.ok(/label: 'Triage board'/.test(phone), 'PhoneMore.vue has no Triage board item')
  assert.ok(/<TriageBoard\s+ref="triage"\s+headless/.test(phone), 'PhoneMore.vue does not mount the triage dialog')
})
