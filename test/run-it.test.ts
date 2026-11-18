// "Run it": the routing rule that picks an agent for a blank assignee, and the op sequence the store sends
// (create_task, assign, then start_task or move_task). The store needs Nuxt, so this runs the same ops on plain rows.
// Run with `pnpm test`.
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
const NOW = '2026-11-06T12:00:00.000Z'
let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
let pickRunner: typeof import('../app/utils/runnerRule.ts').pickRunner
let columnRoles: typeof import('../app/utils/rollup.ts').columnRoles
let deriveStage: typeof import('../app/utils/rollup.ts').deriveStage
before(async () => {
  ({ applyOp } = await import('../app/utils/boardOps.ts'));
  ({ pickRunner } = await import('../app/utils/runnerRule.ts'));
  const rollup = await import('../app/utils/rollup.ts')
  columnRoles = rollup.columnRoles
  deriveStage = rollup.deriveStage
})

const columns = JSON.parse(readFileSync(new URL('../mock/board_columns.json', import.meta.url), 'utf8'))
const agent = (id: string, over: object = {}) => ({ agent_id: id, name: id, lifecycle_status: 'active', agent_type: null, ...over })
const registry = [
  agent('agt-a'), agent('agt-b'), agent('agt-scoped', { classes: ['catalyst'] }), agent('agt-off', { switch: 'off' }), agent('agt-dev', { lifecycle_status: 'in_development' })
] as never[]
const old = (id: string, project: string, assignee: string, stage: string, at: string) =>
  ({ task_id: id, project_id: project, assignee, stage, updated_at: at }) as never
const role = () => columnRoles(columns.find((c: { view: string, match: string }) => c.view === 'stages' && c.match === 'stage=build')).find(r => r.role === 'builder')!
const pick = (over: object) => pickRunner({ tasks: [], registry, role: role(), project: '', tags: [], fallback: '', stageOf: (t: never) => deriveStage(t, [], registry), ...over })

test('the project runner is the assignee of its most recent card that reached Build', () => {
  const tasks = [old('T1', 'p', 'agt-a', 'done', '2026-11-01'), old('T2', 'p', 'agt-b', 'review', '2026-11-04'), old('T3', 'p', 'agt-a', 'backlog', '2026-11-05'), old('T4', 'q', 'agt-a', 'build', '2026-11-05')]
  assert.equal(pick({ tasks, project: 'p', fallback: 'agt-a' }), 'agt-b')
})

test('gateway rows with a blank stage count by work_state, as the store derives it', () => {
  // No stage key: a verifying card is in Review, a backlog card never reached Build.
  const row = (id: string, assignee: string, work_state: string) => ({ task_id: id, project_id: 'p', assignee, work_state, updated_at: '2026-11-05' }) as never
  assert.equal(pick({ tasks: [row('T1', 'agt-b', 'verifying'), row('T2', 'agt-a', 'backlog')], project: 'p' }), 'agt-b')
})

test('a project runner who is off, not active or not in the registry is skipped', () => {
  const tasks = [old('T1', 'p', 'agt-off', 'build', '2026-11-05'), old('T2', 'p', 'agt-dev', 'build', '2026-11-04'), old('T3', 'p', 'agt-gone', 'build', '2026-11-03')]
  assert.equal(pick({ tasks, project: 'p', fallback: 'agt-a' }), 'agt-a')
})

test('with no project history, a class tag picks a scoped agent that holds the class', () => {
  assert.equal(pick({ tags: ['class-catalyst'], fallback: 'agt-a' }), 'agt-scoped')
  // A class nobody holds falls through to the default runner.
  assert.equal(pick({ tags: ['class-personal'], fallback: 'agt-a' }), 'agt-a')
})

test('the default runner is used last, and only when it can take a builder step', () => {
  assert.equal(pick({ fallback: 'agt-b' }), 'agt-b')
  assert.equal(pick({ fallback: 'agt-off' }), '')
  assert.equal(pick({ fallback: 'agt-dev' }), '')
})

test('nothing eligible gives blank, so the step goes to the pool', () => {
  assert.equal(pick({}), '')
})

// The same ops the store sends, on plain rows.
const board = () => ({ tasks: [] as never[], steps: [] as never[], notes: [] as never[], columns, registry: [agent('agt-a', { agent_type: 'builder' })] as never[] })
const run = (b: ReturnType<typeof board>, op: string, args: object) => applyOp(b, op, args as never, ME as never, Date.parse(NOW))
const row = (b: ReturnType<typeof board>) => b.tasks[0] as unknown as { task_id: string, stage: string, work_state: string, assignee: string, updated_at: string }

function create(b: ReturnType<typeof board>) {
  assert.equal(run(b, 'create_task', { title: 'Try Run it' }).ok, true)
  assert.equal(run(b, 'assign', { task_id: row(b).task_id, assignee: 'agt-a', updated_at: row(b).updated_at }).ok, true)
}

test('Run it: create, assign, start_task leaves a Build card with a builder step for the assignee', () => {
  const b = board()
  create(b)
  assert.equal(run(b, 'start_task', { task_id: row(b).task_id, updated_at: row(b).updated_at }).ok, true)
  assert.equal(row(b).stage, 'build')
  assert.equal(row(b).work_state, 'awaiting_start')
  assert.equal(row(b).assignee, 'agt-a')
  const steps = b.steps as unknown as { role: string, assignee: string }[]
  assert.deepEqual(steps.map(s => [s.role, s.assignee]), [['builder', 'agt-a']])
})

test('Run it without start_task live: move_task to build gives the same card', () => {
  const b = board()
  create(b)
  assert.equal(run(b, 'move_task', { task_id: row(b).task_id, stage: 'build', updated_at: row(b).updated_at }).ok, true)
  assert.equal(row(b).stage, 'build')
  assert.equal((b.steps as unknown as { role: string }[]).filter(s => s.role === 'builder').length, 1)
})

test('Plan first: move_task to architecture gives an architect step, not a builder step', () => {
  const b = board()
  create(b)
  assert.equal(run(b, 'move_task', { task_id: row(b).task_id, stage: 'architecture', updated_at: row(b).updated_at }).ok, true)
  assert.equal(row(b).stage, 'architecture')
  assert.deepEqual((b.steps as unknown as { role: string }[]).map(s => s.role), ['architect'])
})
