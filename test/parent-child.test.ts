// A card tagged parent-<id> waits in Backlog until its parent is Done, then is promoted; split_task makes children.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { ME, NOW, NOW_MS, board, reason, step, stepsOf, task, taskOf, type B } from './board-helpers.ts'

let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
let parentOf: typeof import('../app/utils/boardOps.ts').parentOf
before(async () => { ({ applyOp, parentOf } = await import('../app/utils/boardOps.ts')) })
const run = (b: B, op: string, args: object, caller: object = ME) => applyOp(b, op, args as never, caller as never, NOW_MS)
const child = (over: object = {}) => task({ task_id: 'TSK-2', title: 'Child', tags: 'parent-tsk-1', ...over })
const reviewParent = () => task({ stage: 'review', work_state: 'verifying', internal_verification: 'pass (PASS, STP-1)' })

test('parentOf reads the parent-tsk-N tag and ignores other tags', () => {
  assert.equal(parentOf({ tags: 'async,parent-tsk-930123,budget-3' }), 'TSK-930123')
  assert.equal(parentOf({ tags: 'async' }), '')
  assert.equal(parentOf({ tags: 'parent-' }), '')
})

test('a child waits in Backlog: Start and a move out of Backlog are refused while the parent is not Done', () => {
  const b = board([task(), child()])
  assert.match(reason(run(b, 'start_task', { task_id: 'TSK-2', updated_at: NOW })), /TSK-2 waits in Backlog for its parent TSK-1/)
  assert.match(reason(run(b, 'move_task', { task_id: 'TSK-2', stage: 'build', updated_at: NOW })), /waits in Backlog/)
  assert.equal(stepsOf(b, 'TSK-2').length, 0)
  assert.equal(taskOf(b, 'TSK-2').stage, 'backlog')
})

test('a parent that is not on the board does not hold the child', () => {
  const b = board([child({ tags: 'parent-tsk-99' })])
  assert.equal(run(b, 'start_task', { task_id: 'TSK-2', updated_at: NOW }).ok, true)
})

test('promotion: when the parent reaches Done by move_task, every waiting child starts in the same answer', () => {
  const b = board([reviewParent(), child(), child({ task_id: 'TSK-3', title: 'Second' }), child({ task_id: 'TSK-4', tags: 'parent-tsk-7' })], [step({ step_state: 'served', verdict: 'PASS', acked_at: NOW })])
  const r = run(b, 'move_task', { task_id: 'TSK-1', stage: 'done', updated_at: NOW })
  assert.equal(r.ok, true, reason(r))
  for (const id of ['TSK-2', 'TSK-3']) {
    assert.equal(taskOf(b, id).stage, 'build', id)
    assert.equal(stepsOf(b, id).filter(s => s.role === 'builder').length, 1, id)
  }
  assert.equal(taskOf(b, 'TSK-4').stage, 'backlog') // another parent
  const rows = (r as { rows: { tasks: { task_id: string }[], steps: { task_id: string }[], notes: { body: string }[] } }).rows
  assert.deepEqual(rows.tasks.map(t => t.task_id).sort(), ['TSK-1', 'TSK-2', 'TSK-3'])
  assert.equal(rows.steps.filter(s => s.task_id === 'TSK-2').length, 1)
  assert.equal(rows.notes.some(n => /promoted from Backlog to Build/.test(n.body)), true)
})

test('promotion also runs when the parent is closed with done_no_steps', () => {
  const b = board([task(), child()])
  assert.equal(run(b, 'done_no_steps', { task_id: 'TSK-1', updated_at: NOW }).ok, true)
  assert.equal(taskOf(b, 'TSK-2').stage, 'build')
  assert.equal(stepsOf(b, 'TSK-2').length, 1)
})

test('an archived or already started child is not promoted', () => {
  const b = board([task(), child({ archived_at: NOW }), child({ task_id: 'TSK-3', stage: 'build', work_state: 'awaiting_start' })])
  run(b, 'done_no_steps', { task_id: 'TSK-1', updated_at: NOW })
  assert.equal(stepsOf(b, 'TSK-2').length, 0)
  assert.equal(stepsOf(b, 'TSK-3').length, 0)
})

test('create_task checks the parent tag: one parent, a real id, on the board', () => {
  const b = board([task()])
  assert.equal(run(b, 'create_task', { title: 'Kid', tags: 'parent-tsk-1' }).ok, true)
  assert.match(reason(run(b, 'create_task', { title: 'Kid', tags: 'parent-tsk-1,parent-tsk-2' })), /one parent/)
  assert.match(reason(run(b, 'create_task', { title: 'Kid', tags: 'parent-tsk-55' })), /not on the board/)
  assert.match(reason(run(b, 'create_task', { title: 'Kid', tags: 'parent-foo' })), /not a parent tag/)
})

const kids = JSON.stringify([{ title: 'Part one', acceptance_requirements: 'A | B' }, { title: 'Part two' }])

test('split_task by Meshach makes Backlog children tagged with the parent, inheriting class, project and priority', () => {
  const b = board([task({ tags: 'class-fj,async', project_id: 'prj-1', priority: 'high' })])
  const r = run(b, 'split_task', { task_id: 'TSK-1', children: kids, updated_at: NOW })
  assert.equal(r.ok, true, reason(r))
  const made = (b.tasks as unknown as { task_id: string, title: string, tags: string, stage: string, project_id: string, priority: string, acceptance_requirements: string }[]).filter(t => t.task_id !== 'TSK-1')
  assert.equal(made.length, 2)
  for (const c of made) {
    assert.equal(c.tags, 'class-fj,parent-tsk-1')
    assert.equal(c.stage, 'backlog')
    assert.equal(c.project_id, 'prj-1')
    assert.equal(c.priority, 'high')
  }
  assert.equal(made.find(c => c.title === 'Part one')!.acceptance_requirements, 'A | B')
  const rows = (r as { rows: { tasks: { task_id: string }[], notes: { body: string }[] } }).rows
  assert.equal(rows.tasks.length, 3) // the parent and two children
  assert.match(rows.notes[0]!.body, /Split into TSK-/)
  // The children now wait: Start is refused until the parent is done.
  assert.match(reason(run(b, 'start_task', { task_id: made[0]!.task_id, updated_at: (made[0] as unknown as { updated_at: string }).updated_at })), /waits in Backlog/)
})

test('split_task by an agent needs the open architect step on the card', () => {
  const lease = { role: 'architect', assignee: 'agt-adv', step_state: 'dispatched', lease_owner: 'gw.gov-board-write@agt-adv', lease_expires_at: '2026-10-30T13:00:00.000Z' }
  const ok = board([task({ stage: 'architecture', work_state: 'in_progress' })], [step(lease)])
  assert.equal(run(ok, 'split_task', { task_id: 'TSK-1', children: kids, updated_at: NOW }, { agent_id: 'agt-adv' }).ok, true)
  assert.equal(ok.tasks.length, 3)
  const none = board([task()])
  assert.match(reason(run(none, 'split_task', { task_id: 'TSK-1', children: kids, updated_at: NOW }, { agent_id: 'agt-adv' })), /does not hold an open architect step/)
  const builder = board([task({ stage: 'build' })], [step({ ...lease, role: 'builder', assignee: 'agt-b', lease_owner: 'gw.gov-board-write@agt-b' })])
  assert.match(reason(run(builder, 'split_task', { task_id: 'TSK-1', children: kids, updated_at: NOW }, { agent_id: 'agt-b' })), /architect step/)
})

test('split_task refuses a bad list, more than 10 children, a blank title, a stale card and a done card', () => {
  const b = board([task()])
  const split = (children: string, updated_at = NOW) => reason(run(b, 'split_task', { task_id: 'TSK-1', children, updated_at }))
  assert.match(split('not json'), /JSON list/)
  assert.match(split('[]'), /1 to 10/)
  assert.match(split(JSON.stringify(Array.from({ length: 11 }, (_, i) => ({ title: `c${i}` })))), /1 to 10/)
  assert.match(split(JSON.stringify([{ title: '  ' }])), /needs a title/)
  assert.match(split(kids, '2020-01-01T00:00:00.000Z'), /stale/)
  const done = board([task({ work_state: 'done', stage: 'done' })])
  assert.match(reason(run(done, 'split_task', { task_id: 'TSK-1', children: kids, updated_at: NOW })), /is done/)
  assert.equal(b.tasks.length, 1)
})

test('end to end: split, finish the parent, and both children are promoted', () => {
  const b = board([reviewParent()], [step({ step_state: 'served', verdict: 'PASS', acked_at: NOW })])
  const s = run(b, 'split_task', { task_id: 'TSK-1', children: kids, updated_at: NOW })
  assert.equal(s.ok, true)
  const at = taskOf(b).work_state && (b.tasks.find(t => (t as unknown as { task_id: string }).task_id === 'TSK-1') as unknown as { updated_at: string }).updated_at
  assert.equal(run(b, 'move_task', { task_id: 'TSK-1', stage: 'done', updated_at: at }).ok, true)
  const kidsNow = (b.tasks as unknown as { task_id: string, stage: string }[]).filter(t => t.task_id !== 'TSK-1')
  assert.deepEqual(kidsNow.map(k => k.stage), ['build', 'build'])
})
