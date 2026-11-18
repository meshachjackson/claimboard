import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentRefusal, atLeast, cardIdFor, claimableFor, personRefusal, mayWatch, canEditCard, canViewCard, checkPolicy, filterBoard, levelFor, openPolicy, startingPolicy, visibleBoards } from '../shared/access.ts'
import type { Policy } from '../shared/access.ts'

const owner = 'person:meshach'
const base = startingPolicy(owner, [
  { name: 'Executives', members: ['person:ceo'] },
  { name: 'Developers', members: ['person:dev', 'agt-builder'] }
]) as Policy

const card = (task_id: string, extra: object = {}) => ({ task_id, project_id: '', ...extra })

test('an open policy restricts nothing', () => {
  assert.ok(canEditCard(openPolicy(owner), 'person:anyone', card('TSK-1')))
})

test('onboarding builds the groups and puts every member in everyone', () => {
  assert.deepEqual(base.groups.map(g => g.id), ['admins', 'everyone', 'executives', 'developers'])
  assert.ok(base.groups[1]!.members.includes('agt-builder'))
  assert.equal(typeof startingPolicy(owner, [{ name: '  ' }]), 'string')
})

test('a board for executives only is hidden from developers and their agents', () => {
  const p: Policy = { ...base, rules: [
    { scope: 'board', target: 'exec', group: 'everyone', level: 'none' },
    { scope: 'board', target: 'exec', group: 'executives', level: 'edit' }
  ] }
  const c = card('TSK-2', { board_id: 'exec' })
  // A none from a group you are in beats a grant at the same scope. Everyone includes executives, so the rule hides it from them too.
  assert.equal(canViewCard(p, 'person:ceo', c), false)
  const fixed: Policy = { ...base, rules: [
    { scope: 'board', target: 'exec', group: 'developers', level: 'none' },
    { scope: 'board', target: 'exec', group: 'executives', level: 'edit' }
  ] }
  assert.equal(canEditCard(fixed, 'person:ceo', c), true)
  assert.equal(canViewCard(fixed, 'person:dev', c), false)
  assert.equal(canViewCard(fixed, 'agt-builder', c), false)
  assert.equal(canViewCard(fixed, owner, c), true)
})

test('the most specific rule wins, and view does not allow edit', () => {
  const p: Policy = { ...base, rules: [
    { scope: 'board', target: 'main', group: 'developers', level: 'edit' },
    { scope: 'project', target: 'PRJ-1', group: 'developers', level: 'view' },
    { scope: 'card', target: 'TSK-3', group: 'developers', level: 'edit' }
  ] }
  assert.equal(levelFor(p, 'person:dev', { project: 'PRJ-1' }), 'view')
  assert.equal(canEditCard(p, 'person:dev', card('TSK-4', { project_id: 'PRJ-1' })), false)
  assert.equal(canViewCard(p, 'person:dev', card('TSK-4', { project_id: 'PRJ-1' })), true)
  assert.equal(canEditCard(p, 'person:dev', card('TSK-3', { project_id: 'PRJ-1' })), true)
})

test('a hidden board hides a card even when the card rule grants access', () => {
  const p: Policy = { ...base, rules: [
    { scope: 'board', target: 'exec', group: 'developers', level: 'none' },
    { scope: 'card', target: 'TSK-5', group: 'developers', level: 'edit' }
  ] }
  assert.equal(canViewCard(p, 'person:dev', card('TSK-5', { board_id: 'exec' })), false)
})

test('filterBoard drops hidden cards with their steps and notes', () => {
  const p: Policy = { ...base, rules: [{ scope: 'project', target: 'SECRET', group: 'developers', level: 'none' }] }
  const data = {
    generated_at: '', columns: [], registry: [],
    tasks: [card('A'), card('B', { project_id: 'SECRET' })],
    steps: [{ task_id: 'A' }, { task_id: 'B' }],
    notes: [{ task_id: 'B' }]
  } as never
  const seen = filterBoard(p, 'person:dev', data)
  assert.deepEqual(seen.tasks.map(t => t.task_id), ['A'])
  assert.equal(seen.steps.length, 1)
  assert.equal(seen.notes.length, 0)
  assert.equal(filterBoard(p, owner, data).tasks.length, 2)
})

test('checkPolicy refuses edits that would lock the owner out or name unknown groups', () => {
  assert.equal(checkPolicy(base), null)
  assert.match(checkPolicy({ ...base, groups: base.groups.filter(g => g.id !== 'admins') })!, /cannot be removed/)
  assert.match(checkPolicy({ ...base, rules: [{ scope: 'card', target: 'X', group: 'nobody', level: 'view' }] })!, /unknown group/)
  const agentOnly = { ...base, groups: base.groups.map(g => (g.id === 'admins' ? { ...g, members: ['agt-claude-code-macbook'] } : g)) }
  assert.match(checkPolicy(agentOnly)!, /at least one person/)
  assert.ok(atLeast('manage', 'edit') && !atLeast('view', 'edit'))
})

// The gate runAgentOp applies (server/utils/agentOps.ts) is agentRefusal; the server part only looks the card up.
test('agents are held to the policy: card ops, create_task and the briefs', () => {
  const p: Policy = {
    ...base,
    rules: [
      { scope: 'board', target: 'exec', group: 'developers', level: 'none' },
      { scope: 'board', target: 'exec', group: 'executives', level: 'edit' },
      { scope: 'board', target: 'main', group: 'developers', level: 'view' }
    ]
  }
  const execCard = card('X', { board_id: 'exec' })
  const mainCard = card('M')
  // A developer agent cannot touch or even read a card on the exec board.
  assert.match(agentRefusal(p, 'agt-builder', 'claim_step', { step_id: 'S' }, execCard)!, /may not edit X/)
  assert.match(agentRefusal(p, 'agt-builder', 'get_task', { task_id: 'X' }, execCard)!, /may not view X/)
  // On the main board the developers group only views, so reading passes and writing is refused.
  assert.equal(agentRefusal(p, 'agt-builder', 'get_task', { task_id: 'M' }, mainCard), null)
  assert.match(agentRefusal(p, 'agt-builder', 'add_note', { task_id: 'M' }, mainCard)!, /may not edit M/)
  // create_task is checked against the board it lands on.
  assert.match(agentRefusal(p, 'agt-builder', 'create_task', { board_id: 'exec' }, undefined)!, /may not create cards on exec/)
  assert.match(agentRefusal(p, 'agt-builder', 'create_task', {}, undefined)!, /may not create cards on main/)
  assert.equal(agentRefusal(p, 'person:ceo', 'create_task', { board_id: 'exec' }, undefined), null)
  // The briefs need view on the main board.
  assert.equal(agentRefusal(p, 'agt-builder', 'vera_brief', {}, undefined), null)
  const hidden: Policy = { ...p, rules: [{ scope: 'board', target: 'main', group: 'developers', level: 'none' }] }
  assert.match(agentRefusal(hidden, 'agt-builder', 'read_brief', {}, undefined)!, /may not read the brief/)
  // An unknown card is not this gate's business.
  assert.equal(agentRefusal(p, 'agt-builder', 'claim_step', { step_id: 'nope' }, undefined), null)
})

// The gate the person route applies (server/api/board/[op].post.ts) is personRefusal.
test('a person without edit on a card cannot cancel its step, which names only the step', () => {
  const p: Policy = { ...base, rules: [{ scope: 'board', target: 'main', group: 'developers', level: 'view' }] }
  const board = { tasks: [card('M')], steps: [{ step_id: 'S1', task_id: 'M' }] } as never
  assert.equal(cardIdFor({ step_id: 'S1' }, [{ step_id: 'S1', task_id: 'M' }]), 'M')
  assert.match(personRefusal(p, 'person:dev', 'cancel_step', { step_id: 'S1' }, board)!, /may not edit M/)
  assert.match(personRefusal(p, 'person:dev', 'move_task', { task_id: 'M' }, board)!, /may not edit M/)
  assert.equal(personRefusal(p, owner, 'cancel_step', { step_id: 'S1' }, board), null)
  assert.equal(personRefusal(p, 'person:dev', 'cancel_step', { step_id: 'nope' }, board), null)
  assert.match(personRefusal(p, 'person:dev', 'create_task', {}, board)!, /may not create cards/)
})

test('visibleBoards lists the boards a person may see', () => {
  const p: Policy = { ...base, rules: [{ scope: 'board', target: 'exec', group: 'developers', level: 'none' }, { scope: 'board', target: 'exec', group: 'executives', level: 'view' }] }
  assert.deepEqual(visibleBoards(p, 'person:dev', [{ board_id: 'ops' }]), ['main', 'ops'])
  assert.deepEqual(visibleBoards(p, 'person:ceo', []), ['exec', 'main'])
  assert.deepEqual(visibleBoards(null, 'person:x', []), ['main'])
})

test('list_claimable drops steps on cards the agent cannot edit; streams need one visible board', () => {
  const p: Policy = { ...base, rules: [{ scope: 'board', target: 'exec', group: 'developers', level: 'none' }] }
  const tasks = [card('X', { board_id: 'exec' }), card('M')]
  const steps = [{ task_id: 'X' }, { task_id: 'M' }, { task_id: 'gone' }]
  assert.deepEqual(claimableFor(p, 'agt-builder', steps, tasks).map(s => s.task_id), ['M', 'gone'])
  assert.equal(mayWatch(p, 'agt-builder'), true)
  const none: Policy = { ...base, rules: [{ scope: 'board', target: 'main', group: 'everyone', level: 'none' }] }
  assert.equal(mayWatch(none, 'agt-builder'), false)
  assert.equal(mayWatch(null, 'agt-builder'), true)
})
