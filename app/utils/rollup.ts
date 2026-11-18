// Card rollup: pure functions over plain rows.
// In gateway mode gw.gov-board-write rolls cards up and the UI only displays work_state.
// Fixtures mode runs the same rules through utils/boardOps.
import type { BoardColumn, ColumnRole, GovTask, GovTaskStep, RegistryAgent, Stage, StepState, WorkState } from '~/types/board'
import { NO_REPLY_HOURS, POOL_PREFIX } from '~/types/board'

export function isPool(assignee: string | null | undefined): boolean {
  // A row written outside the board route can carry a null assignee; null is not a pool.
  return !!assignee && assignee.startsWith(POOL_PREFIX)
}

/** "pool:builder" → "builder". */
export function poolType(assignee: string): string {
  return assignee.slice(POOL_PREFIX.length)
}

/**
 * Steps that still count: not cancelled, and not replaced by a later step for the same role.
 * A reply leaves the answered step acked as needs_input and adds a new one.
 */
export function activeSteps(steps: GovTaskStep[]): GovTaskStep[] {
  const live = steps.filter(s => !s.cancelled)
  return live.filter(s => !s.role || !live.some(l => l.role === s.role && l.step_no > s.step_no))
}

/** Steps without a role are live rows from before roles existed; treat them as required. */
function isRequired(step: GovTaskStep, roles: ColumnRole[]): boolean {
  if (!step.role) return true
  const role = roles.find(r => r.role === step.role)
  return role ? role.required : true
}

function passed(verification: string): boolean {
  return verification.trim().startsWith('pass')
}

/**
 * work_state from the task's steps, following the orchestrator's board_status rules.
 * `roles` are the roles of the task's current column, used to tell required steps from optional ones.
 * With no active steps the stored work_state stands (backlog, or a live row the orchestrator already rolled up).
 */
export function rollupWorkState(task: GovTask, steps: GovTaskStep[], roles: ColumnRole[] = []): WorkState {
  if (passed(task.internal_verification) && passed(task.macro_verification)) return 'done'

  const live = activeSteps(steps)
  if (live.length === 0) return task.work_state

  const has = (state: StepState) => live.some(s => s.step_state === state)
  if (has('needs_input')) return 'needs_input'
  if (has('failed') || (task.escalation && task.escalation !== 'none')) return 'blocked'
  if (has('dispatched')) return 'in_progress'

  const required = live.filter(s => isRequired(s, roles))
  const finished = (s: GovTaskStep) => s.step_state === 'served' || s.step_state === 'verified'
  if (required.length > 0 && required.every(finished)) return 'verifying'

  return 'awaiting_start'
}

/**
 * The step that drives the card's pill, avatar, and activity line.
 * Order: needs_input, failed, dispatched, waiting, then finished; ties go to the latest step_no.
 */
const STEP_PRIORITY: Record<StepState, number> = {
  needs_input: 0,
  failed: 1,
  dispatched: 2,
  awaiting_pull: 3,
  awaiting_start: 3,
  served: 4,
  verified: 4
}

export function primaryStep(steps: GovTaskStep[]): GovTaskStep | null {
  const live = activeSteps(steps)
  if (live.length === 0) return null
  return [...live].sort((a, b) =>
    STEP_PRIORITY[a.step_state] - STEP_PRIORITY[b.step_state] || b.step_no - a.step_no
  )[0] ?? null
}

/**
 * Stage fallback for rows without `stage` (mock/README.md):
 * backlog → backlog, verifying → review, done → done,
 * anything else → architecture if the current step's assignee is an advisor, otherwise build.
 */
export function deriveStage(task: GovTask, steps: GovTaskStep[], registry: RegistryAgent[]): Stage {
  if (task.stage) return task.stage
  if (task.work_state === 'backlog') return 'backlog'
  if (task.work_state === 'verifying') return 'review'
  if (task.work_state === 'done') return 'done'

  const current = primaryStep(steps)
  // An in-progress row with no step and no assignee (written outside the board route) must still render: build.
  const assignee = current?.assignee || task.assignee || ''
  const type = isPool(assignee) ? poolType(assignee) : registry.find(a => a.agent_id === assignee)?.agent_type
  return type === 'advisor' ? 'architecture' : 'build'
}

/**
 * (C): a Build card assigned to one agent whose open step belongs to another.
 * Returns the step holder, or '' when the two agree or there is nothing to say. The usual cause is an
 * assignment made after the drag to Build: the board keeps the step it already created.
 * Pool steps and finished steps stay quiet, because neither has a wrong owner to point at.
 */
const OPEN_STEP_STATES: StepState[] = ['awaiting_pull', 'awaiting_start', 'dispatched']

export function stepHeldBy(task: GovTask, stage: Stage, primary: GovTaskStep | null): string {
  if (stage !== 'build' || !primary || !OPEN_STEP_STATES.includes(primary.step_state)) return ''
  if (!task.assignee || isPool(task.assignee) || !primary.assignee || isPool(primary.assignee)) return ''
  return primary.assignee === task.assignee ? '' : primary.assignee
}

/**
 * Whole hours an open message has waited past its threshold, or 0 while it is still inside it.
 * A message counts as open while its chat step has no ack; the caller passes only that step.
 */
export function noReplyHours(chat: GovTaskStep | null, hosted: boolean, now: number = Date.now()): number {
  if (!chat) return 0
  const waited = Math.floor((now - Date.parse(chat.created_at)) / 3_600_000)
  return waited >= (hosted ? NO_REPLY_HOURS.hosted : NO_REPLY_HOURS.laptop) ? waited : 0
}

/** board_columns.match is "field=value", e.g. "stage=build" or "work_state=blocked". */
export function parseMatch(match: string): { field: 'stage' | 'work_state', value: string } {
  const [field, value] = match.split('=')
  return { field: field === 'work_state' ? 'work_state' : 'stage', value: value ?? '' }
}

/** Whether a card sits in a column. A match value may list several choices with "|", e.g. "work_state=needs_input|blocked". */
export function matchesColumn(match: string, card: { stage: string, workState: string }): boolean {
  const { field, value } = parseMatch(match)
  return value.split('|').includes(field === 'stage' ? card.stage : card.workState)
}

/**
 * The gateway's board_columns rows, plus the bundled preset rows for any view the gateway has none of. A view with no
 * rows draws no columns, so a gateway that predates Flow (or a cached snapshot from before its rows were added) used to
 * leave Flow blank unless it returned no columns at all. Rows the gateway sends always win for the views it has.
 */
export function withPresetViews(rows: BoardColumn[], presets: BoardColumn[]): BoardColumn[] {
  const have = new Set(rows.map(c => c.view))
  return [...rows, ...presets.filter(c => !have.has(c.view))]
}

export function columnRoles(column: BoardColumn | undefined): ColumnRole[] {
  if (!column) return []
  try {
    return JSON.parse(column.roles_json) as ColumnRole[]
  } catch {
    return []
  }
}
