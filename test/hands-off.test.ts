// Hands-off board: Start, Restart, Send back, hand-off on assign,
// moves that cancel instead of refusing, the Flow view, the goal contract, retry once, and the runner.
// Each test name starts with its criterion id. Plain in-memory rows only. Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

const ME = { person: 'person:meshach' }
const mock = (file: string) => JSON.parse(readFileSync(new URL(`../mock/${file}`, import.meta.url), 'utf8'))
const NOW = '2026-10-30T12:00:00.000Z'

let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
let goal: typeof import('../app/utils/goal.ts')
let rollup: typeof import('../app/utils/rollup.ts')
let boardUrl: typeof import('../app/utils/boardUrl.ts')
before(async () => {
  ({ applyOp } = await import('../app/utils/boardOps.ts'))
  goal = await import('../app/utils/goal.ts')
  rollup = await import('../app/utils/rollup.ts')
  boardUrl = await import('../app/utils/boardUrl.ts')
})

const task = (over: object = {}) => ({
  task_id: 'TSK-1', title: 'Fix the thing', original_request: 'Fix the thing', acceptance_requirements: 'It works | Tests pass', task_type: 'build',
  proposed_assignee: '', assignee: '', upgrade_target: '', execution_policy: '', approval_state: 'not_required', work_state: 'backlog',
  current_step: 0, steps_total: 0, outputs_ref: '', internal_verification: 'none', macro_verification: 'none', escalation: 'none',
  priority: 'normal', project_id: '', created_by: 'person:meshach', created_at: NOW, due_at: null, updated_by: 'x', updated_at: NOW, stage: 'backlog', tags: '', ...over
}) as never
const step = (over: object = {}) => ({
  step_id: 'STP-1', task_id: 'TSK-1', step_no: 1, assignee: 'agt-b', goal: 'builder: Fix the thing', input_ref: '', target_action: 'draft', target_ticket_ref: '',
  step_state: 'awaiting_pull', stop_reason: '', verdict: '', budget_used: '', output_ref: '', output_summary: '', vera_ticket_ref: '', created_at: NOW,
  dispatched_at: null, ended_at: null, updated_at: NOW, claim_key: 'pull:STP-1', lease_owner: '', lease_expires_at: null, acked_at: null, cancelled: false,
  claim_count: 0, last_claimed_at: null, role: 'builder', activity: '', heartbeat_at: null, ...over
}) as never
const agent = (id: string, type: string) => ({ agent_id: id, name: id, lifecycle_status: 'active', agent_type: type }) as never
const board = (tasks: object[], steps: object[] = []) => ({
  tasks: tasks as never[], steps: steps as never[], notes: [] as never[], columns: mock('board_columns.json'),
  registry: [agent('agt-b', 'builder'), agent('agt-c', 'builder'), agent('agt-adv', 'advisor')] as never[]
})
type B = ReturnType<typeof board>
const run = (b: B, op: string, args: object, caller: object = ME) => applyOp(b, op, args as never, caller as never, Date.parse(NOW) + 1000)
const reason = (r: unknown) => String((r as { reason?: string }).reason)
const steps = (b: B, id = 'TSK-1') => (b.steps as { task_id: string, role: string, step_state: string, cancelled: boolean, assignee: string, goal: string }[]).filter(s => s.task_id === id)
const taskOf = (b: B) => b.tasks[0] as { stage: string, work_state: string, internal_verification: string }

test('A1: start_task on a Backlog card with an eligible assignee makes one builder step and moves it to Build', () => {
  const b = board([task({ assignee: 'agt-b' })])
  const r = run(b, 'start_task', { task_id: 'TSK-1', updated_at: NOW })
  assert.equal(r.ok, true)
  assert.equal(taskOf(b).stage, 'build')
  assert.equal(taskOf(b).work_state, 'awaiting_start')
  const s = steps(b).filter(x => x.role === 'builder')
  assert.equal(s.length, 1)
  assert.equal(s[0]!.assignee, 'agt-b')
  assert.equal(s[0]!.step_state, 'awaiting_pull')
})

test('A1: start_task with no assignee uses pool:builder; an advisor assignee is not eligible and also uses the pool', () => {
  const b = board([task()])
  assert.equal(run(b, 'start_task', { task_id: 'TSK-1', updated_at: NOW }).ok, true)
  assert.equal(steps(b)[0]!.assignee, 'pool:builder')
  const c = board([task({ assignee: 'agt-adv' })])
  run(c, 'start_task', { task_id: 'TSK-1', updated_at: NOW })
  assert.equal(steps(c)[0]!.assignee, 'pool:builder')
})

test('A1: start_task is for the owner only, and refused on Review and Done cards', () => {
  const b = board([task()])
  assert.equal(run(b, 'start_task', { task_id: 'TSK-1', updated_at: NOW }, { agent_id: 'agt-b' }).ok, false)
  for (const stage of ['review', 'done']) {
    const c = board([task({ stage, work_state: stage === 'done' ? 'done' : 'verifying' })])
    const r = run(c, 'start_task', { task_id: 'TSK-1', updated_at: NOW })
    assert.equal(r.ok, false)
    assert.equal(steps(c).length, 0)
  }
})

test('A1b: restart makes a fresh builder step when the last failed, was cancelled, or was acked needs_input', () => {
  for (const over of [{ step_state: 'failed' }, { cancelled: true }, { step_state: 'needs_input', acked_at: NOW }]) {
    const b = board([task({ stage: 'build', work_state: 'blocked', assignee: 'agt-b' })], [step(over)])
    const r = run(b, 'start_task', { task_id: 'TSK-1', updated_at: NOW })
    assert.equal(r.ok, true, JSON.stringify(over))
    const fresh = steps(b).filter(x => !x.cancelled && x.step_state === 'awaiting_pull')
    assert.equal(fresh.length, 1)
    assert.equal(taskOf(b).work_state, 'awaiting_start')
  }
})

test('A1b: restart is refused with "already running" while the builder step is open and healthy', () => {
  for (const step_state of ['awaiting_pull', 'awaiting_start', 'dispatched']) {
    const b = board([task({ stage: 'build', work_state: 'awaiting_start' })], [step({ step_state })])
    const r = run(b, 'start_task', { task_id: 'TSK-1', updated_at: NOW })
    assert.equal(r.ok, false)
    assert.match(reason(r), /already running/)
  }
})

test('A2: moving a card out of Build cancels its open builder step, adds one status note, and succeeds', () => {
  const b = board([task({ stage: 'build', work_state: 'awaiting_start' })], [step()])
  const r = run(b, 'move_task', { task_id: 'TSK-1', stage: 'backlog', updated_at: NOW })
  assert.equal(r.ok, true)
  assert.equal(steps(b)[0]!.cancelled, true)
  assert.equal(taskOf(b).stage, 'backlog')
  const notes = b.notes as { kind: string, body: string }[]
  assert.equal(notes.filter(n => n.kind === 'status').length, 1)
  assert.match(notes[0]!.body, /STP-1/)
})

test('A2b: a refused move leaves open steps alone, and the unapproved-plan gate still holds', () => {
  const plan = step({ step_id: 'STP-9', role: 'architect', step_state: 'served', verdict: 'PASS', acked_at: NOW, assignee: 'agt-adv' })
  const b = board([task({ stage: 'architecture', work_state: 'needs_input' })], [plan])
  const r = run(b, 'move_task', { task_id: 'TSK-1', stage: 'build', updated_at: NOW })
  assert.equal(r.ok, false)
  assert.match(reason(r), /unapproved plan/)
  assert.equal(steps(b).every(s => !s.cancelled), true)
  assert.equal(b.notes.length, 0)
})

test('A3: assigning a Build card hands its open step to the new agent', () => {
  const b = board([task({ stage: 'build', work_state: 'awaiting_start', assignee: 'agt-b' })], [step()])
  const r = run(b, 'assign', { task_id: 'TSK-1', assignee: 'agt-c', updated_at: NOW })
  assert.equal(r.ok, true)
  const all = steps(b)
  assert.equal(all[0]!.cancelled, true)
  const open = all.filter(s => !s.cancelled)
  assert.equal(open.length, 1)
  assert.equal(open[0]!.assignee, 'agt-c')
  assert.equal(open[0]!.role, 'builder')
  assert.equal((b.notes as { kind: string }[]).filter(n => n.kind === 'status').length, 1)
})

test('A3: blank assignee or an ineligible agent hands the step to the pool', () => {
  const b = board([task({ stage: 'build', work_state: 'awaiting_start', assignee: 'agt-b' })], [step()])
  run(b, 'assign', { task_id: 'TSK-1', assignee: '', updated_at: NOW })
  assert.equal(steps(b).filter(s => !s.cancelled)[0]!.assignee, 'pool:builder')
})

test('A3b: assigning a Backlog or Review card only changes the assignee', () => {
  for (const stage of ['backlog', 'review']) {
    const b = board([task({ stage, work_state: stage === 'review' ? 'verifying' : 'backlog' })], [])
    assert.equal(run(b, 'assign', { task_id: 'TSK-1', assignee: 'agt-c', updated_at: NOW }).ok, true)
    assert.equal(steps(b).length, 0)
  }
})

test('A4: the old lease owner cannot write a cancelled step', () => {
  const leased = step({ step_state: 'dispatched', lease_owner: 'gw.gov-board-write@agt-b', lease_expires_at: '2026-10-30T13:00:00.000Z', cancelled: true })
  const b = board([task({ stage: 'build', work_state: 'in_progress' })], [leased])
  const a = { step_id: 'STP-1', updated_at: NOW }
  for (const [op, extra] of [['heartbeat', { activity: 'still going' }], ['update_step', { step_state: 'failed', stop_reason: 'x' }], ['complete_step', { step_state: 'served', verdict: 'PASS' }]] as const) {
    const r = run(b, op, { ...a, ...extra }, { agent_id: 'agt-b' })
    assert.equal(r.ok, false, op)
    assert.match(reason(r), /cancelled/)
  }
})

test('A5: send_back moves a Review card to Build with the line in a comment and in the new step goal', () => {
  const b = board([task({ stage: 'review', work_state: 'verifying', assignee: 'agt-b', internal_verification: 'pass (PASS, STP-1)' })], [step({ step_state: 'served', acked_at: NOW, verdict: 'PASS' })])
  const r = run(b, 'send_back', { task_id: 'TSK-1', body: 'Use the phone layout too', updated_at: NOW })
  assert.equal(r.ok, true)
  assert.equal(taskOf(b).stage, 'build')
  assert.equal(taskOf(b).internal_verification, 'none')
  const fresh = steps(b).filter(s => s.step_state === 'awaiting_pull')
  assert.equal(fresh.length, 1)
  assert.match(fresh[0]!.goal, /Use the phone layout too/)
  assert.equal((b.notes as { kind: string, body: string }[]).filter(n => n.kind === 'comment' && n.body === 'Use the phone layout too').length, 1)
})

test('A5: send_back is refused outside Review', () => {
  const b = board([task({ stage: 'build', work_state: 'awaiting_start' })], [step()])
  const r = run(b, 'send_back', { task_id: 'TSK-1', body: 'no', updated_at: NOW })
  assert.equal(r.ok, false)
  assert.match(reason(r), /Review/)
})

test('A5b: publish_task makes one publish step on a passed Review card, and send_back never does', () => {
  const b = board([task({ stage: 'review', work_state: 'verifying', assignee: 'agt-b', internal_verification: 'pass (PASS, STP-1)' })], [step({ step_state: 'served', acked_at: NOW, verdict: 'PASS' })])
  const r = run(b, 'publish_task', { task_id: 'TSK-1', updated_at: NOW })
  assert.equal(r.ok, true)
  const fresh = steps(b).filter(s => s.step_state === 'awaiting_pull')
  assert.equal(fresh.length, 1)
  assert.equal(fresh[0]!.target_action, 'publish')
  assert.match(fresh[0]!.goal, /draft pull request/)
  const c = board([task({ stage: 'review', work_state: 'verifying', assignee: 'agt-b', internal_verification: 'pass (PASS, STP-1)' })], [step({ step_state: 'served', acked_at: NOW, verdict: 'PASS' })])
  run(c, 'send_back', { task_id: 'TSK-1', body: 'push the branch and open a PR', updated_at: NOW })
  assert.notEqual(steps(c).filter(s => s.step_state === 'awaiting_pull')[0]!.target_action, 'publish')
})

test('A5b: publish_task is refused outside Review or without a pass', () => {
  const b = board([task({ stage: 'build', work_state: 'awaiting_start' })], [step()])
  assert.match(reason(run(b, 'publish_task', { task_id: 'TSK-1', updated_at: NOW })), /Review/)
  const c = board([task({ stage: 'review', work_state: 'verifying', internal_verification: 'none' })], [step({ step_state: 'served', acked_at: NOW })])
  assert.match(reason(run(c, 'publish_task', { task_id: 'TSK-1', updated_at: NOW })), /passed verification/)
})

test('A6: matchesColumn accepts a|b lists', () => {
  assert.equal(rollup.matchesColumn('work_state=a|b', { stage: 'build', workState: 'b' }), true)
  assert.equal(rollup.matchesColumn('work_state=a|b', { stage: 'build', workState: 'c' }), false)
  assert.equal(rollup.matchesColumn('stage=build', { stage: 'build', workState: 'c' }), true)
})

test('A6c: the Flow columns are in the preset exactly as the contract lists them', () => {
  const flow = (mock('board_columns.json') as { view: string, name: string, position: number, match: string }[]).filter(c => c.view === 'flow')
  assert.deepEqual(flow.map(c => [c.name, c.position, c.match]), [
    ['Backlog', 1, 'work_state=backlog'],
    ['Running', 2, 'work_state=awaiting_start|in_progress'],
    ['Needs you', 3, 'work_state=needs_input|blocked'],
    ['Review', 4, 'work_state=verifying'],
    ['Done', 5, 'work_state=done']
  ])
})

test('A6d: parseMatch keeps an a|b value whole, and matchesColumn reads it', () => {
  assert.deepEqual(rollup.parseMatch('work_state=a|b'), { field: 'work_state', value: 'a|b' })
  assert.equal(rollup.matchesColumn('work_state=a|b', { stage: 'build', workState: 'b' }), true)
})

test('B1: loopBudget reads budget-N (1 to 20), default 4; goalContract gathers goal, done-when and budget', () => {
  assert.equal(goal.loopBudget([]), 4)
  assert.equal(goal.loopBudget(['x', 'budget-6']), 6)
  assert.equal(goal.loopBudget(['budget-0']), 4)
  assert.equal(goal.loopBudget(['budget-21']), 4)
  assert.deepEqual(goal.goalContract(task({ tags: 'budget-3', acceptance_requirements: 'A | B | ' })), { goal: 'Fix the thing', doneWhen: ['A', 'B'], budget: 3 })
})

test('B2: a failed builder step is retried once; the card goes to awaiting_start, not blocked', () => {
  const leased = step({ step_state: 'dispatched', lease_owner: 'gw.gov-board-write@agt-b', lease_expires_at: '2026-10-30T13:00:00.000Z', assignee: 'agt-b', claim_count: 1 })
  const b = board([task({ stage: 'build', work_state: 'in_progress', assignee: 'agt-b' })], [leased])
  const r = run(b, 'update_step', { step_id: 'STP-1', step_state: 'failed', stop_reason: 'tests red', updated_at: NOW }, { agent_id: 'agt-b' })
  assert.equal(r.ok, true)
  const retry = steps(b).find(s => s.goal.startsWith('retry:'))!
  assert.ok(retry)
  assert.match(retry.goal, /tests red/)
  assert.equal(retry.assignee, 'agt-b')
  assert.equal(retry.step_state, 'awaiting_pull')
  assert.equal(taskOf(b).work_state, 'awaiting_start')
  assert.equal((b.notes as { kind: string }[]).filter(n => n.kind === 'status').length, 1)
})

test('B2: a served builder step with a verdict other than PASS is retried once too', () => {
  const leased = step({ step_state: 'dispatched', lease_owner: 'gw.gov-board-write@agt-b', lease_expires_at: '2026-10-30T13:00:00.000Z', claim_count: 1 })
  const b = board([task({ stage: 'build', work_state: 'in_progress', assignee: 'agt-b' })], [leased])
  run(b, 'complete_step', { step_id: 'STP-1', step_state: 'served', verdict: 'FAIL', updated_at: NOW }, { agent_id: 'agt-b' })
  assert.equal(steps(b).filter(s => s.goal.startsWith('retry:')).length, 1)
  assert.equal(taskOf(b).work_state, 'awaiting_start')
})

test('B2b: a failed retry step is not retried again; the card is blocked', () => {
  const retry = step({ step_id: 'STP-2', step_no: 2, goal: 'retry: builder: Fix the thing', step_state: 'dispatched', lease_owner: 'gw.gov-board-write@agt-b', lease_expires_at: '2026-10-30T13:00:00.000Z', claim_count: 1, assignee: 'agt-b' })
  const b = board([task({ stage: 'build', work_state: 'in_progress', assignee: 'agt-b' })], [step({ step_state: 'failed', acked_at: NOW }), retry])
  run(b, 'update_step', { step_id: 'STP-2', step_state: 'failed', stop_reason: 'still red', updated_at: NOW }, { agent_id: 'agt-b' })
  assert.equal(steps(b).length, 2)
  assert.equal(taskOf(b).work_state, 'blocked')
})

test('B3: attemptsFor counts uncancelled steps of the role and ignores chat', () => {
  const list = [step({ step_id: 'A' }), step({ step_id: 'B', cancelled: true }), step({ step_id: 'C', role: 'chat' }), step({ step_id: 'D', role: 'architect' })] as never[]
  assert.equal(goal.attemptsFor(list, 'builder'), 1)
  assert.equal(goal.attemptsFor(list, 'architect'), 1)
})

// ---------- Phase C: the runner (scripts/board-run.mjs) ----------

let runner: { pickNext: (...a: unknown[]) => { step_id: string }[], buildPrompt: (...a: unknown[]) => string, runStep: (o: unknown) => Promise<{ state: string, verdict?: string }>, parseVerdict: (t: string) => string }
let runOp: typeof import('../app/utils/boardOps.ts').runOp
before(async () => {
  runner = await import('../scripts/board-run.mjs') as never
  ;({ runOp } = await import('../app/utils/boardOps.ts'))
})

test('C1: pickNext orders by priority, then oldest; skips running cards; returns nothing at the cap', () => {
  const tasks = [task({ task_id: 'T-LOW', priority: 'low' }), task({ task_id: 'T-HIGH', priority: 'high' }), task({ task_id: 'T-URG', priority: 'critical' }), task({ task_id: 'T-BUSY', priority: 'urgent' }), task({ task_id: 'T-ODD', priority: 'whenever' }), task({ task_id: 'T-HIGH2', priority: 'high' })]
  const s = (id: string, at: string, over: object = {}) => step({ step_id: `S-${id}`, task_id: id, created_at: at, ...over })
  const steps = [s('T-LOW', '2026-10-01T00:00:00Z'), s('T-HIGH', '2026-10-03T00:00:00Z'), s('T-HIGH2', '2026-10-02T00:00:00Z'), s('T-URG', '2026-10-09T00:00:00Z'), s('T-BUSY', '2026-10-01T00:00:00Z'), s('T-ODD', '2026-10-01T00:00:00Z'), s('T-LOW', '2026-10-01T00:00:00Z', { step_id: 'S-chat', role: 'chat' })]
  const order = runner.pickNext(tasks, steps, [{ task_id: 'T-BUSY' }], 3).map(x => x.step_id)
  assert.deepEqual(order, ['S-T-URG', 'S-T-HIGH2', 'S-T-HIGH', 'S-T-LOW', 'S-T-ODD'])
  assert.deepEqual(runner.pickNext(tasks, steps, [{ task_id: 'a' }, { task_id: 'b' }], 2), [])
})

test('C2: buildPrompt carries the card, goal, every done-when line, the budget, the last three notes and the rules', () => {
  const t = task({ task_id: 'TSK-77', title: 'Ship it', original_request: 'Ship the widget', acceptance_requirements: 'Widget renders | Tests pass', tags: 'budget-3' })
  const notes = [1, 2, 3, 4].map(n => ({ author_id: 'a', kind: 'comment', body: `note ${n}` }))
  const text = runner.buildPrompt(t, step({ step_id: 'STP-5', goal: 'builder: Ship it' }), notes)
  for (const part of ['TSK-77', 'Ship it', 'Ship the widget', 'Widget renders', 'Tests pass', '3 attempts', 'note 4', 'note 3', 'note 2', 'Do not push']) assert.ok(text.includes(part), part)
  assert.equal(text.includes('note 1'), false)
})

// A card in Build with one open builder step, answered by the real op layer.
function live(over: object = {}) {
  const b = board([task({ stage: 'build', work_state: 'awaiting_start', assignee: 'agt-b', ...over })], [step()])
  const api = async (op: string, args: Record<string, unknown>) => {
    if (op !== 'get_task') return runOp(b as never, op, args, { agent_id: 'agt-b' }) as never
    const r = runOp(b as never, 'read_task', args, { agent_id: 'agt-b' }) as unknown as { rows: { tasks: unknown[], steps: unknown[], notes: unknown[] } }
    return { ok: true, task: r.rows.tasks[0], steps: r.rows.steps, notes: r.rows.notes }
  }
  return { b, api }
}
test('C3: verify PASS completes the step and the card reaches Review', async () => {
  const { b, api } = live()
  const out = await runner.runStep({ api, task: b.tasks[0], step: b.steps[0], launch: async () => ({ ok: true, summary: 'built it\nCOMPLETE: done' }), verify: async () => ({ verdict: 'PASS', summary: 'all good' }) })
  assert.deepEqual(out, { state: 'served', verdict: 'PASS' })
  assert.equal(taskOf(b).stage, 'review')
})

test('C3b: verify FAIL completes the step FAIL and the board queues the retry', async () => {
  const { b, api } = live()
  const out = await runner.runStep({ api, task: b.tasks[0], step: b.steps[0], launch: async () => ({ ok: true, summary: 'tried\nCOMPLETE: done' }), verify: async () => ({ verdict: 'FAIL', summary: 'test 2 red' }) })
  assert.deepEqual(out, { state: 'served', verdict: 'FAIL' })
  assert.equal(steps(b).filter(s => s.goal.startsWith('retry:')).length, 1)
  assert.equal(taskOf(b).work_state, 'awaiting_start')
})

test('C3c: a launch error fails the step through update_step, and the board queues the retry', async () => {
  const { b, api } = live()
  const out = await runner.runStep({ api, task: b.tasks[0], step: b.steps[0], launch: async () => { throw new Error('claude not found') }, verify: async () => { throw new Error('should not run') } })
  assert.equal(out.state, 'failed')
  assert.match((b.steps[0] as unknown as { stop_reason: string }).stop_reason, /claude not found/)
  assert.equal(steps(b).filter(s => s.goal.startsWith('retry:')).length, 1)
})

test('C4: over budget, the runner claims the step, does not launch, and parks it in Needs you', async () => {
  const b = board([task({ stage: 'build', work_state: 'awaiting_start', assignee: 'agt-b', tags: 'budget-1' })], [step({ step_id: 'STP-1', step_state: 'failed', acked_at: NOW }), step({ step_id: 'STP-2', step_no: 2, claim_key: 'pull:STP-2', goal: 'retry: builder: Fix the thing' })])
  const api = async (op: string, args: Record<string, unknown>) => {
    if (op !== 'get_task') return runOp(b as never, op, args, { agent_id: 'agt-b' }) as never
    const r = runOp(b as never, 'read_task', args, { agent_id: 'agt-b' }) as unknown as { rows: { tasks: unknown[], steps: unknown[], notes: unknown[] } }
    return { ok: true, task: r.rows.tasks[0], steps: r.rows.steps, notes: r.rows.notes }
  }
  let launched = false
  const out = await runner.runStep({ api, task: b.tasks[0], step: b.steps[1], launch: async () => { launched = true; return { ok: true, summary: '' } }, verify: async () => ({ verdict: 'PASS', summary: '' }) })
  assert.equal(out.state, 'budget')
  assert.equal(launched, false)
  const parked = b.steps[1] as unknown as { step_state: string, stop_reason: string }
  assert.equal(parked.step_state, 'needs_input')
  assert.match(parked.stop_reason, /budget/i)
  assert.equal(taskOf(b).work_state, 'needs_input')
})

test('C4: a verdict line decides PASS; no line counts as FAIL', () => {
  assert.equal(runner.parseVerdict('checked\nVERDICT: PASS'), 'PASS')
  assert.equal(runner.parseVerdict('VERDICT: FAIL\nthen\nVERDICT: PASS'), 'PASS')
  assert.equal(runner.parseVerdict('looks fine to me'), 'FAIL')
})
