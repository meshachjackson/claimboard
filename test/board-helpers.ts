// Small in-memory board builders shared by the column-rule, parent/child and card-op store tests. Not a test file.
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

const root = new URL('../', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~~/')) spec = new URL(spec.slice(3) + (spec.endsWith('.json') ? '' : '.ts'), ${JSON.stringify(root)}).href
  else if (spec.startsWith('~/')) spec = new URL('app/' + spec.slice(2) + '.ts', ${JSON.stringify(root)}).href
  const out = await next(spec, ctx)
  return out.url.endsWith('.json') ? { ...out, importAttributes: { type: 'json' } } : out
}`))
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')
await import('./instance-setup.ts')

export const ME = { person: 'person:meshach' }
export const NOW = '2026-10-30T12:00:00.000Z'
export const NOW_MS = Date.parse(NOW) + 1000
const mock = (file: string) => JSON.parse(readFileSync(new URL(`../mock/${file}`, import.meta.url), 'utf8'))

export const task = (over: object = {}) => ({
  task_id: 'TSK-1', title: 'Fix the thing', original_request: 'Fix the thing', acceptance_requirements: 'It works | Tests pass', task_type: 'build',
  proposed_assignee: '', assignee: '', upgrade_target: '', execution_policy: '', approval_state: 'not_required', work_state: 'backlog',
  current_step: 0, steps_total: 0, outputs_ref: '', internal_verification: 'none', macro_verification: 'none', escalation: 'none',
  priority: 'normal', project_id: '', created_by: 'person:meshach', created_at: NOW, due_at: null, updated_by: 'x', updated_at: NOW, stage: 'backlog', tags: '', ...over
}) as never
export const step = (over: object = {}) => ({
  step_id: 'STP-1', task_id: 'TSK-1', step_no: 1, assignee: 'agt-b', goal: 'builder: Fix the thing', input_ref: '', target_action: 'draft', target_ticket_ref: '',
  step_state: 'awaiting_pull', stop_reason: '', verdict: '', budget_used: '', output_ref: '', output_summary: '', vera_ticket_ref: '', created_at: NOW,
  dispatched_at: null, ended_at: null, updated_at: NOW, claim_key: 'pull:STP-1', lease_owner: '', lease_expires_at: null, acked_at: null, cancelled: false,
  claim_count: 0, last_claimed_at: null, role: 'builder', activity: '', heartbeat_at: null, ...over
}) as never
const agent = (id: string, type: string, extra: object = {}) => ({ agent_id: id, name: id, lifecycle_status: 'active', agent_type: type, ...extra }) as never
export const board = (tasks: object[], steps: object[] = []) => ({
  tasks: tasks as never[], steps: steps as never[], notes: [] as never[], columns: mock('board_columns.json'),
  registry: [agent('agt-b', 'builder'), agent('agt-c', 'builder'), agent('agt-adv', 'advisor'), agent('agt-orchestrator', 'orchestrator'),
    agent('agt-chat', 'builder', { switch: 'on', request_types: 'board_reply' })] as never[]
})
export type B = ReturnType<typeof board>
export const reason = (r: unknown) => String((r as { reason?: string }).reason)
export const stepsOf = (b: B, id = 'TSK-1') => (b.steps as unknown as { task_id: string, role: string, step_state: string, cancelled: boolean, assignee: string, goal: string, step_id: string }[]).filter(s => s.task_id === id)
export const taskOf = (b: B, id = 'TSK-1') => (b.tasks as unknown as { task_id: string, stage: string, work_state: string, tags: string }[]).find(t => t.task_id === id)!
