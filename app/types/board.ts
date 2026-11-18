// Board types, labels, and colors.
// Field names and enum values match ../registry/schema/tables.json exactly.
// This is the only file where labels and colors live (CLAUDE.md).

// ---------- Enums from schema/tables.json ----------

// Shown by the live dot when the server keeps the fixtures-mode rows in NUXT_BOARD_FILE.
export const LOCAL_FILE_LABEL = 'Local file'

export const WORK_STATES = ['backlog', 'awaiting_start', 'in_progress', 'needs_input', 'blocked', 'verifying', 'done'] as const
export type WorkState = typeof WORK_STATES[number]

export const STEP_STATES = ['awaiting_start', 'awaiting_pull', 'dispatched', 'served', 'needs_input', 'failed', 'verified'] as const
export type StepState = typeof STEP_STATES[number]

export const APPROVAL_STATES = ['not_required', 'pending', 'approved', 'rejected'] as const
export type ApprovalState = typeof APPROVAL_STATES[number]

export const TASK_TYPES = ['operational', 'build', 'upgrade'] as const
export type TaskType = typeof TASK_TYPES[number]

// ---------- Stages and note kinds (schema 1.5 and later;  and 6) ----------

export const STAGES = ['backlog', 'architecture', 'build', 'review', 'done'] as const
export type Stage = typeof STAGES[number]

// 'system' is not in tables.json (comment|question|proposal|summary|status) and the task-write workflow does not write it. Not live; kept for fixtures and rendering only.
export const NOTE_KINDS = ['comment', 'question', 'proposal', 'summary', 'status', 'system'] as const
export type NoteKind = typeof NOTE_KINDS[number]

/** The one column view. Flow and States were retired on 11/3/2026; old ?view=flow and ?view=states links open Stages. */
export type ViewId = 'stages'
/** What a device opens on: a column view or the table (Settings). */
export type DefaultView = ViewId | 'table'

/** priority is free text ("a person's call"); these are the choices the editor offers. */
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const PRIORITY_LABELS: Record<string, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
/** Priority facet rows in the filter panel: fixed order, dot color ('' draws a hollow ring). Stored values go through PRIORITY_SYNONYMS first. */
export const PRIORITY_FACET_ORDER = ['urgent', 'high', 'normal', 'low'] as const
export const PRIORITY_FACET_DOTS: Record<string, string> = { urgent: '#F97066', high: '#FB923C', normal: '#8A93A3', low: '' }

/** Priorities that get a badge on the card. */
export const PRIORITY_BADGES: Record<string, { bg: string, fg: string }> = {
  high: { bg: 'var(--ab-orange-pale)', fg: 'var(--ab-orange-strong)' },
  urgent: { bg: 'var(--ab-red-bg)', fg: 'var(--ab-red-text)' }
}

/**
 * Board report project colors (docs/design/report/README.md §3). Slots are fixed, never by rank, so a project keeps its color
 * when a filter changes. NUXT_PUBLIC_PROJECT_COLORS (a JSON list of project ids) fills slots 1, 2, 3 in order; any other project
 * takes the next free slot in the order the board first shows it; past eight, "Other".
 * Values are CSS variables written from PALETTE (--ab-proj-<slot>), so one name serves light and dark.
 */
let projectOrder: string[] = []
export function setProjectColorOrder(list: string[]): void {
  projectOrder = list.slice(0, PROJECT_SLOTS)
}
const PROJECT_SLOTS = 8
export const PROJECT_NONE_COLOR = 'var(--ab-proj-none)'
export const PROJECT_OTHER_COLOR = 'var(--ab-proj-other)'

/** The color for a project id. `known` lists the board's projects in the order they first appear, to place the ones the configured order lacks. */
export function projectColor(project: string, known: readonly string[] = []): string {
  if (!project) return PROJECT_NONE_COLOR
  const slots = [...projectOrder, ...known.filter(p => p && !projectOrder.includes(p))]
  const i = slots.indexOf(project)
  return i >= 0 && i < PROJECT_SLOTS ? `var(--ab-proj-${i + 1})` : PROJECT_OTHER_COLOR
}

/** What the report's tools look like: tile accent, icon chip and glyph (status meanings; always shown with an icon and a label). */
export const REPORT_TOOL_LOOKS: Record<string, { accent: string, bg: string, glyph: string, label: string }> = {
  orphans: { accent: 'var(--ab-finding-orphans)', bg: 'var(--ab-finding-orphans-bg)', glyph: '?', label: 'Orphan cards' },
  batchable: { accent: 'var(--ab-finding-batch)', bg: 'var(--ab-finding-batch-bg)', glyph: '≡', label: 'Cards to batch' },
  almost_done: { accent: 'var(--ab-finding-good)', bg: 'var(--ab-finding-good-bg)', glyph: '✓', label: 'Close to done' },
  behind: { accent: 'var(--ab-finding-late)', bg: 'var(--ab-finding-late-bg)', glyph: '!', label: 'Projects behind' },
  overdue: { accent: 'var(--ab-finding-late)', bg: 'var(--ab-finding-late-bg)', glyph: '!', label: 'Due dates' },
  progress: { accent: 'var(--ab-finding-good)', bg: 'var(--ab-finding-good-bg)', glyph: '%', label: 'Project progress' },
  breakdown: { accent: 'var(--color-accent)', bg: 'var(--ab-blue-bg)', glyph: '▤', label: 'Open cards by field' }
}

/** Step role for a direct message to an agent (message_agent). It belongs to no column, so it never moves the card. */
export const CHAT_ROLE = 'chat'
/** Who answers a message on a card with no agent on it, or whose agent can't take messages. Set from NUXT_PUBLIC_ORCHESTRATOR_AGENT_ID. */
let orchestrator = 'agt-orchestrator'
export function setOrchestrator(id: string): void {
  if (!/^agt-[a-z0-9-]+$/.test(id)) throw new Error(`ORCHESTRATOR_AGENT_ID ${id} must look like agt-<name>`)
  orchestrator = id
}
export const orchestratorId = (): string => orchestrator
/** What the UI calls the orchestrator ("Ask <name>"). Set from NUXT_PUBLIC_ORCHESTRATOR_NAME. */
let orchestratorLabel = 'Orchestrator'
export function setOrchestratorName(name: string): void {
  if (name.trim()) orchestratorLabel = name.trim()
}
export const orchestratorName = (): string => orchestratorLabel
/** The agent the registry pages ask about access and drift, and what the UI calls it. Set from NUXT_PUBLIC_REGISTRAR_AGENT_ID and _NAME. */
let registrar = { id: 'agt-registrar', name: 'Registrar' }
export function setRegistrar(id: string, name: string): void {
  if (id && !/^agt-[a-z0-9-]+$/.test(id)) throw new Error(`REGISTRAR_AGENT_ID ${id} must look like agt-<name>`)
  registrar = { id: id || registrar.id, name: name.trim() || registrar.name }
}
export const registrarAgent = (): { id: string, name: string } => registrar
/** The vault folder name the note-body check watches for ('' turns the check off). Set from NUXT_PUBLIC_VAULT_FOLDER. */
let vaultFolder = ''
export function setVaultFolder(name: string): void {
  if (name && !/^[A-Za-z0-9 _-]+$/.test(name)) throw new Error(`VAULT_FOLDER ${name} must be a plain folder name`)
  vaultFolder = name
}
export const vaultFolderName = (): string => vaultFolder
/** Vault subfolders whose notes may never be named in card text, like `Private-Notes`. Set from NUXT_PUBLIC_VAULT_PERSONAL_FOLDERS (a JSON list). */
let vaultPersonal: string[] = []
export function setVaultPersonalFolders(names: string[]): void {
  for (const n of names) if (!/^[A-Za-z0-9 _-]+$/.test(n)) throw new Error(`VAULT_PERSONAL_FOLDERS entry ${n} must be a plain folder name`)
  vaultPersonal = names
}
export const vaultPersonalFolders = (): string[] => vaultPersonal
/** The request type an agent's registry row lists when it can answer board messages. */
export const BOARD_REPLY = 'board_reply'
/** Done cards older than this are offered for cleanup (hidden after 14 days). */
export const ARCHIVE_AFTER_DAYS = 14
/** Hours an open message may wait before the card shows "No reply" under Needs you: hosted agents answer in minutes, laptop agents when a session runs. */
export const NO_REPLY_HOURS = { hosted: 4, laptop: 24 }

// ---------- Board triage ----------

/** Days without any activity before the rules pass flags an open card. The owner's call; the plan defaults to 7. */
export const TRIAGE_STALE_DAYS = 7
/** Hours the owner's comment may wait for a reply before the rules pass flags the card. Plan default: 24. */
export const TRIAGE_REPLY_HOURS = 24

/** Strongest first. A card that several rules flag gets the first action it earned. */
export const TRIAGE_ACTIONS = ['close', 'archive', 'fold', 'rewrite', 'keep'] as const
export type TriageAction = typeof TRIAGE_ACTIONS[number]
export const TRIAGE_ACTION_LABELS: Record<TriageAction, string> = {
  close: 'Close', archive: 'Archive', fold: 'Fold', rewrite: 'Rewrite', keep: 'Keep'
}
/** Only close and archive have a write path today; the rest are advice for the owner to act on by hand. */
export const TRIAGE_APPLIABLE: TriageAction[] = ['close', 'archive']
/** The tag on a triage card ("File as card"), so the board can find and filter the plans. */
export const TRIAGE_CARD_TAG = 'triage'

export const TRIAGE_RULES = [
  'stale', 'test_card', 'duplicate', 'done_old', 'done_open_steps', 'unreachable_step', 'no_reply', 'no_criteria'
] as const
export type TriageRule = typeof TRIAGE_RULES[number]
export const TRIAGE_RULE_LABELS: Record<TriageRule, string> = {
  stale: 'No activity',
  test_card: 'Test card',
  duplicate: 'Likely duplicate',
  done_old: 'Done a while ago',
  done_open_steps: 'Done with open steps',
  unreachable_step: 'Step nobody can pick up',
  no_reply: 'Comment with no reply',
  no_criteria: 'No acceptance criteria'
}

/** One line of a triage plan. `source` says which pass found it; the evidence pass (not built) adds 'evidence'. */
export interface TriageFinding {
  task_id: string
  action: TriageAction
  reason: string
  evidence: string
  rules: TriageRule[]
  source: 'rules' | 'evidence'
}

// ---------- Column sort ----------

export const SORT_KEYS = ['created', 'updated', 'priority', 'due', 'title'] as const
export type SortKey = typeof SORT_KEYS[number]
export const SORT_LABELS: Record<SortKey, string> = {
  created: 'Created',
  updated: 'Updated',
  priority: 'Priority',
  due: 'Due date',
  title: 'Title'
}

// ---------- Rows ----------

/** One gov_tasks row. Columns match schema/tables.json 1.9 (retry_count and retry_cap are 1.9, draft until applied); board_id and pinned_at are not in tables.json. */
export interface GovTask {
  task_id: string
  title: string
  original_request: string
  acceptance_requirements: string // checkable lines separated by " | "
  task_type: TaskType
  proposed_assignee: string
  assignee: string // agt-<id> or person:<name>, blank when unassigned
  upgrade_target: string
  execution_policy: string // auto | manual | ask
  approval_state: ApprovalState
  work_state: WorkState
  current_step: number
  steps_total: number
  outputs_ref: string
  internal_verification: string // none | pass | send_back | fail, plus the source ticket
  macro_verification: string
  escalation: string // none, or step_id plus stop_reason
  priority: string
  project_id: string
  board_id?: string // not in tables.json 1.9, not live: which board the card is on; blank means the main board (shared/access.ts)
  created_by: string
  created_at: string
  due_at: string | null
  updated_by: string
  updated_at: string
  stage?: Stage
  tags?: string // comma-separated
  archived_at?: string | null // schema 1.6: set by archive_task
  pinned_at?: string | null // not in tables.json 1.9, not live (the 1.7 that was planned for it became the door change): set by pin_task; a pinned card is never archived and sorts first
  retry_count?: number | null // schema 1.9 (draft): automatic builder retries started; blank means 0
  retry_cap?: number | null // schema 1.9 (draft): most automatic retries; blank means 2
}

/** One gov_task_steps row. Columns match schema/tables.json 1.9; the last four are draft until applied. */
export interface GovTaskStep {
  step_id: string
  task_id: string
  step_no: number
  assignee: string // agt-<id>, person:<name>, or pool:<agent_type>
  goal: string
  input_ref: string
  target_action: string
  target_ticket_ref: string
  step_state: StepState
  stop_reason: string
  verdict: string
  budget_used: string
  output_ref: string
  output_summary: string
  vera_ticket_ref: string
  created_at: string
  dispatched_at: string | null
  ended_at: string | null
  updated_at: string
  claim_key: string
  lease_owner: string
  lease_expires_at: string | null
  acked_at: string | null
  cancelled: boolean
  claim_count: number
  last_claimed_at: string | null
  role?: string
  activity?: string
  heartbeat_at?: string | null
  job_id?: string // schema 1.9 (draft): job:<task_id>:<step_no>:<attempt>; blank when not an async job
  timeout_sec?: number | null // schema 1.9 (draft): blank means the role default in gov_config board.timeouts
  tokens_in?: number | null // schema 1.9 (draft)
  tokens_out?: number | null // schema 1.9 (draft)
}

export const EVENT_KINDS = ['status_change', 'dispatch', 'callback', 'verify', 'retry', 'escalate', 'timeout', 'token_spend'] as const
export type EventKind = typeof EVENT_KINDS[number]

/** One board_events row (schema 1.9, draft until applied). Append-only; event_id is unique. */
export interface BoardEvent {
  event_id: string
  task_id: string
  step_id: string // blank for card-level events
  job_id: string // blank when no job
  actor: string // agt-<id>, person:<name> or system
  kind: EventKind
  old_value: string
  new_value: string
  tokens_in: number | null
  tokens_out: number | null
  created_at: string
}

/** One gov_task_notes row (schema 1.5). */
export interface GovTaskNote {
  note_id: string
  task_id: string
  step_id: string
  author_id: string
  kind: NoteKind
  body: string
  created_at: string
}

/** One role inside board_columns.roles_json. */
export interface ColumnRole {
  role: string
  required: boolean
  agent_types?: string[]
  request_types?: string[]
  action?: string
  pool?: string // pool:<agent_type>
  assignee?: string // fixed assignee, e.g. person:<name>
}

/** One board_columns row (schema 1.5). `match` is "field=value". */
export interface BoardColumn {
  column_id: string
  view: string // the data still carries 'flow' and 'states' preset rows; only 'stages' is drawn
  name: string
  position: number
  match: string
  hint: string
  roles_json: string
}

/** The gov_registry fields the board reads. */
export interface RegistryAgent {
  agent_id: string
  name: string
  description: string
  owner: string
  domain: string
  lifecycle_status: string
  runtime: string
  agent_type: string | null
  type_version: string | null
  host: string | null
  inference: string | null
  reachability: string | null
  request_types: string | null
  status_interface: string
  /** gw.api-run marks an API agent. Sent by gw.gov-board-read once it carries it; blank until then. */
  deploy_ref?: string | null
  /** Class slugs from the agent's board:class:* access rows, e.g. ['general']. Empty: the agent is not class-scoped. */
  classes?: string[]
  /** The owner's switch (Settings > Agents), added by GET /api/board. Not a gov_registry field; blank means on. */
  switch?: 'on' | 'auto' | 'off'
  /** True when gov_config board.wake names a workflow for this agent, so the board wakes it when a card is moved to it. Not a gov_registry field; blank until gw.gov-board-read sends it. */
  wakes?: boolean
}

/** The gw.gov-board-read response (HANDOFF.md, "The gw.gov-board-read contract"). */
export interface BoardData {
  generated_at: string
  tasks: GovTask[]
  steps: GovTaskStep[]
  notes: GovTaskNote[]
  columns: BoardColumn[]
  registry: RegistryAgent[]
  /** Fixtures only: stands in for gov_config board.async. Absent from the gateway, so off. */
  board_async?: boolean
}

/** Where /api/board got its rows. Only `fixtures` allows local edits. */
export type BoardSource = 'fixtures' | 'gateway'

// ---------- People and system (valid authors/assignees, not in gov_registry) ----------

// The board owner: the one person who writes through the browser (BOARD_OWNER, e.g. person:<name>). The app sets it once at
// startup from runtime config (app/plugins/owner.ts, server/plugins/owner.ts), so the id never sits in the code.
const owner = { id: 'person:owner', name: 'Owner' }
export function setBoardOwner(id: string, name = ''): void {
  if (!/^person:[a-z0-9_-]+$/.test(id)) throw new Error(`BOARD_OWNER ${id} must look like person:<name>`)
  owner.id = id
  owner.name = name || id.slice('person:'.length)
}
export const boardOwner = (): string => owner.id

// The agent Start hands an unassigned card to (NUXT_PUBLIC_DEFAULT_RUNNER). Blank means the pool, as before.
let runner = ''
export function setDefaultRunner(id: string): void {
  if (!/^(agt-[a-z0-9-]+)?$/.test(id)) throw new Error(`DEFAULT_RUNNER ${id} must look like agt-<name> or be blank`)
  runner = id
}
export const defaultRunner = (): string => runner
export const boardOwnerName = (): string => owner.name
export const SYSTEM = 'system'
export const POOL_PREFIX = 'pool:'

const NON_REGISTRY_NAMES: Record<string, string> = { [SYSTEM]: 'System' }

/** The display name of the owner or the system author, else undefined (registry agents come from the registry). */
export function nonRegistryName(id: string): string | undefined {
  return id === owner.id ? owner.name : NON_REGISTRY_NAMES[id]
}

// ---------- Labels ----------

export const STAGE_LABELS: Record<Stage, string> = {
  backlog: 'Backlog',
  architecture: 'Architecture',
  build: 'Build',
  review: 'Review',
  done: 'Done'
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  operational: 'Operational',
  build: 'Build',
  upgrade: 'Upgrade'
}

export const WORK_STATE_LABELS: Record<WorkState, string> = {
  backlog: 'Backlog',
  awaiting_start: 'Awaiting start',
  in_progress: 'Working',
  needs_input: 'Needs you',
  blocked: 'Blocked',
  verifying: 'Ready for review',
  done: 'Done'
}

export const STEP_STATE_LABELS: Record<StepState, string> = {
  awaiting_start: 'Awaiting start',
  awaiting_pull: 'Waiting for an agent',
  dispatched: 'Working',
  served: 'Done, checking',
  needs_input: 'Needs you',
  failed: 'Failed',
  verified: 'Verified'
}

// Card step summary: "2 done, 1 open" (Comfortable cards only).
export const stepSummaryLabel = (done: number, open: number) => `${done} done, ${open} open`

export const APPROVAL_LABELS: Record<ApprovalState, string> = {
  not_required: 'Not required',
  pending: 'Approval pending',
  approved: 'Approved',
  rejected: 'Rejected'
}

// ---------- Colors ----------

/**
 * Status colors as [light, dark]. app/plugins/palette.ts writes each as a CSS variable (--ab-<name>) on :root and
 * .dark, and the styles below use var(--ab-<name>). Neutral UI tokens (ink, line, surface…) are in main.css.
 */
export const PALETTE: Record<string, [string, string]> = {
  'neutral-bg': ['#E9ECEF', '#22304A'],
  'neutral-strong': ['#DCE0E5', '#2C3A50'],
  'neutral-soft': ['#F4F5F7', '#132033'],
  'neutral-dot': ['#5F6B7D', '#9AA6B8'],
  // A picked card on the board (Board v4): border and fill. Dark values are the design's #3B82F6 and #18202F.
  'pick-border': ['#2A4BD7', '#8DA4FF'],
  'pick-bg': ['#E6ECFF', '#1C2A52'],
  'blue-bg': ['#E3E9FF', '#1C2A52'],
  'blue-tint': ['#F1F4FF', '#16223F'],
  'blue-line': ['#BCC9F7', '#33467F'],
  'blue-strong': ['#1F3AAE', '#C3CFFF'],
  'blue-link': ['#2A4BD7', '#A9BAFF'],
  'orange-bg': ['#FFE3A3', '#4A3608'],
  'orange-fg': ['#5C3B00', '#FFD47A'],
  'orange-strong': ['#6B4300', '#FFC94D'],
  'orange-dot': ['#E69A00', '#FFB81C'],
  'orange-line': ['#E0A21B', '#9A6E10'],
  'orange-tint': ['#FFF6DE', '#2A2210'],
  'orange-tint-line': ['#F2D58C', '#5A4614'],
  'orange-soft': ['#FFF6DE', '#2A2210'],
  'orange-soft-line': ['#F2D58C', '#5A4614'],
  'orange-pale': ['#FFF3D6', '#2A2210'],
  'green-bg': ['#DDF1E7', '#123326'],
  'green-fg': ['#0B6B45', '#7FE0B5'],
  'green-dot': ['#0E7A4F', '#3CC98E'],
  'green-tint': ['#F0F9F4', '#10261D'],
  'red': ['#C42B21', '#C42B21'], // fills, dots and borders; white text sits on it
  'red-text': ['#C42B21', '#F26B5E'],
  'red-line': ['#E39B93', '#7A2E28'],
  'red-bg': ['#FBE4E2', '#3A1614'],
  'red-soft-line': ['#F4D7D3', '#4A1E1A'],
  // Header bar and filter panel (header refresh v3)
  'bar': ['#E4E7EA', '#0F1A2A'],
  'row-hover': ['#D9DEE3', '#1C2940'],
  // Board report project slots (docs/design/report/README.md §3): validated for dark on #14171C, light on #FFFFFF
  'proj-1': ['#2A78D6', '#3987E5'],
  'proj-2': ['#EB6834', '#D95926'],
  'proj-3': ['#1BAF7A', '#199E70'],
  'proj-4': ['#EDA100', '#C98500'],
  'proj-5': ['#E87BA4', '#D55181'],
  'proj-6': ['#008300', '#008300'],
  'proj-7': ['#6250D6', '#9085E9'],
  'proj-8': ['#E34948', '#E66767'],
  'proj-none': ['#A3A9B4', '#5B6270'],
  'proj-other': ['#7A8291', '#7A8291'],
  // Board report finding tiles: the accent bar and icon, and the icon chip behind it
  'finding-orphans': ['#EA580C', '#FB923C'],
  'finding-orphans-bg': ['#FFE8CC', '#4A2E12'],
  'finding-batch': ['#6250D6', '#9085E9'],
  'finding-batch-bg': ['#ECE9FD', '#26214A'],
  'finding-good': ['#16A34A', '#22C55E'],
  'finding-good-bg': ['#E6F4EA', '#163322'],
  'finding-late': ['#D92D20', '#F97066'],
  'finding-late-bg': ['#FDE8E7', '#3A1614'],
  'row-on': ['#E6ECFF', '#1C2A52'],
  // Direction B signals (docs/design/README.md): the Needs you lamp, On the floor, Shipped. Text on amber is always ink.
  'amber': ['#FFB81C', '#FFB81C'],
  'amber-fg': ['#0F1A2A', '#0F1A2A'], // text on amber stays dark in both themes
  'floor': ['#0F1A2A', '#172234'],
  'floor-fg': ['#FFFFFF', '#E4E7EA'],
  'floor-dim': ['#8A96A8', '#66758C'],
  'run': ['#0E7A4F', '#3CC98E'],
  'run-fg': ['#FFFFFF', '#0F1A2A'],
  'seg-track': ['#D5DAE0', '#1C2940'],
  'seg-on': ['#FFFFFF', '#2C3A50']
}

/**
 * The tag on a Needs you card (the Floor, direction B), keyed by work_state, plus `approve` for approval_state = pending.
 * `open` is the label of the button that opens the card.
 */
export const MOVE_SIGNALS: Record<string, { label: string, bg: string, fg: string, open: string }> = {
  blocked: { label: 'Stopped', bg: 'var(--ab-red)', fg: '#FFFFFF', open: 'Open' },
  needs_input: { label: 'Question', bg: 'var(--ab-amber)', fg: 'var(--ab-amber-fg)', open: 'Answer' },
  verifying: { label: 'Review', bg: 'var(--color-accent)', fg: 'var(--color-surface)', open: 'Review' },
  approve: { label: 'Approve', bg: 'var(--color-accent)', fg: 'var(--color-surface)', open: 'Review' },
  unheld: { label: 'Nobody has it', bg: 'var(--ab-neutral-strong)', fg: 'var(--color-ink)', open: 'Open' },
  // No agent can take the open step (utils/whoseMove noTaker): ink fill, a tag no other signal uses.
  stranded: { label: 'No agent can take it', bg: 'var(--color-ink)', fg: 'var(--color-surface)', open: 'Open' }
}

/**
 * The rule under a board column's name (direction B), keyed by the first value its match names: a stage or a
 * work_state. Columns not listed get the ink rule.
 */
export const COLUMN_RULES: Record<string, string> = {
  backlog: 'var(--color-dash)',
  needs_input: 'var(--ab-amber)',
  blocked: 'var(--ab-amber)',
  review: 'var(--color-accent)',
  verifying: 'var(--color-accent)',
  done: 'var(--ab-run)'
}

export interface PillStyle {
  label: string
  bg: string
  fg: string
  dot: string
  border: string // full CSS border value
  pulse?: boolean
}

/**
 * work_state pills. `backlog` shows no pill. Quiet color (UX Phase 6): on a card only Working, Needs you and Blocked use color;
 * every other state is neutral and tells itself apart by its words (test/quiet-color.test.ts holds the line).
 */
export const WORK_STATE_PILLS: Record<Exclude<WorkState, 'backlog'>, PillStyle> = {
  awaiting_start: { label: 'Awaiting start', bg: 'var(--ab-neutral-bg)', fg: 'var(--color-text2)', dot: 'var(--ab-neutral-dot)', border: '1px solid var(--ab-neutral-bg)' },
  in_progress: { label: 'Working', bg: 'var(--ab-blue-bg)', fg: 'var(--ab-blue-strong)', dot: 'var(--color-accent)', border: '1px solid var(--ab-blue-bg)', pulse: true },
  needs_input: { label: 'Needs you', bg: 'var(--ab-orange-bg)', fg: 'var(--ab-orange-fg)', dot: 'var(--ab-orange-dot)', border: '1px solid var(--ab-orange-bg)' },
  blocked: { label: 'Blocked', bg: 'var(--ab-red)', fg: '#FFFFFF', dot: '#FFFFFF', border: '1px solid var(--ab-red)' },
  verifying: { label: 'Ready for review', bg: 'var(--ab-neutral-bg)', fg: 'var(--color-text2)', dot: 'var(--ab-neutral-dot)', border: '1px solid var(--color-dash)' },
  done: { label: 'Done', bg: 'var(--ab-neutral-bg)', fg: 'var(--color-text2)', dot: 'var(--color-dash)', border: '1px solid var(--ab-neutral-bg)' }
}

/** Step awaiting_pull on a pool:* assignee. */
export const OPEN_PILL: PillStyle = {
  label: 'Open to any agent', bg: 'var(--color-surface)', fg: 'var(--color-text2)', dot: 'var(--color-dash)', border: '1px dashed var(--color-dash)'
}

/** The red dot on a Compact card that needs the owner (utils/attention). */
export const ATTENTION_DOT = { label: 'Needs your attention', color: 'var(--ab-red)' }

/** Card badge when approval_state = pending. Uses the canvas's approve-banner blues. */
export const APPROVAL_BADGE = { bg: 'var(--ab-blue-tint)', fg: 'var(--ab-blue-strong)', border: 'var(--ab-blue-line)' }

/** Small step-chip colors, keyed by step_state. */
export const STEP_STATE_DOTS: Record<StepState, string> = {
  awaiting_start: 'var(--ab-neutral-dot)',
  awaiting_pull: 'var(--color-dash)',
  dispatched: 'var(--color-accent)',
  served: 'var(--ab-neutral-dot)',
  needs_input: 'var(--ab-orange-dot)',
  failed: 'var(--ab-red)',
  verified: 'var(--ab-neutral-dot)'
}

/** Card border and shadow extras by work_state. */
// Direction B: a card has no outline of its own (its edge is the surface on the ground); a card that waits on
// The owner gets an amber outline and ring, a stopped one a red outline.
const TICKET_SHADOW = '0 1px 0 var(--color-line), 0 6px 12px -8px rgba(15,26,42,0.35)'
export const CARD_EXTRAS: Partial<Record<WorkState, { border: string, shadow: string }>> = {
  needs_input: { border: 'var(--ab-orange-line)', shadow: '0 0 0 3px rgba(255,184,28,0.28)' },
  blocked: { border: 'var(--ab-red)', shadow: TICKET_SHADOW }
}
export const CARD_DEFAULT = { border: 'var(--color-surface)', shadow: TICKET_SHADOW }

/** Filter panel State column: fixed order and the dot beside each label ('' draws a hollow ring). */
export const STATE_FILTER_ORDER: readonly WorkState[] = ['needs_input', 'blocked', 'in_progress', 'awaiting_start', 'backlog', 'verifying', 'done']
export const STATE_FILTER_DOTS: Record<WorkState, string> = {
  needs_input: 'var(--ab-orange-dot)',
  blocked: 'var(--ab-red)',
  in_progress: 'var(--color-accent)',
  awaiting_start: 'var(--ab-neutral-dot)',
  backlog: '',
  verifying: 'var(--ab-neutral-dot)',
  done: 'var(--color-dash)'
}

/** The two State values that also sit in the bar as pills. */
export const BOARD_PILLS = [
  { value: 'needs_input', label: 'Needs you', tone: 'orange' },
  { value: 'blocked', label: 'Blocked', tone: 'red' }
] as const

/** Bar pill colors when on. Off pills use the neutral line and ink. */
export const PILL_TONES: Record<'orange' | 'red', { bg: string, border: string, fg: string, dot: string }> = {
  orange: { bg: 'var(--ab-orange-bg)', border: 'var(--ab-orange-line)', fg: 'var(--ab-orange-fg)', dot: 'var(--ab-orange-dot)' },
  red: { bg: 'var(--ab-red-bg)', border: 'var(--ab-red-line)', fg: 'var(--ab-red-text)', dot: 'var(--ab-red)' }
}

/** Old links used ?quick= (one chip at a time). Each maps to the key and value that replaced it. */
export const LEGACY_QUICK: Record<string, { key: 'work_state' | 'agent', value: string }> = {
  needs: { key: 'work_state', value: 'needs_input' },
  blocked: { key: 'work_state', value: 'blocked' },
  unassigned: { key: 'agent', value: '_none' }
}

export interface NoteKindStyle {
  label: string
  bg: string
  fg: string
  bubble: string // '' means no bubble
  bubbleBorder?: string
}

/** Thread badges. `comment` has no badge; `system` renders as a centered line. */
export const NOTE_KIND_STYLES: Partial<Record<NoteKind, NoteKindStyle>> = {
  question: { label: 'Question', bg: 'var(--ab-orange-bg)', fg: 'var(--ab-orange-fg)', bubble: 'var(--ab-orange-tint)', bubbleBorder: 'var(--ab-orange-tint-line)' },
  proposal: { label: 'Proposal', bg: 'var(--ab-blue-bg)', fg: 'var(--color-approve)', bubble: 'var(--ab-blue-tint)' },
  summary: { label: 'Summary', bg: 'var(--ab-green-bg)', fg: 'var(--ab-green-fg)', bubble: 'var(--ab-green-tint)' },
  status: { label: 'Status', bg: 'var(--ab-neutral-bg)', fg: 'var(--color-text2)', bubble: '' }
}

export interface AvatarStyle {
  mono: string
  color: string
}

/** Monogram avatars, filled from NUXT_PUBLIC_AGENT_AVATARS (JSON: {"agt-id": {"mono": "AB", "color": "#7C3AED"}}). Only the system author is built in. */
export const AVATARS: Record<string, AvatarStyle> = {
  [SYSTEM]: { mono: 'SY', color: '#98A1B2' }
}
export function setAgentAvatars(map: Record<string, unknown>): void {
  for (const [id, v] of Object.entries(map)) {
    const a = v as Partial<AvatarStyle> | null
    if (!a || typeof a.mono !== 'string' || typeof a.color !== 'string') throw new Error(`AGENT_AVATARS ${id} needs {"mono","color"}`)
    AVATARS[id] = { mono: a.mono, color: a.color }
  }
}
export const AVATAR_FALLBACK_COLOR = '#475467'

const initials = (name: string) => name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??'

/** Avatar for any agent id: the table above, else the first two letters of its name. */
export function avatarFor(id: string, name: string): AvatarStyle {
  const known = AVATARS[id]
  if (known) return known
  if (id === owner.id) return { mono: initials(name || owner.name), color: '#2563EB' }
  const letters = name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '??'
  return { mono: letters, color: AVATAR_FALLBACK_COLOR }
}

// ---------- Board writes (gw.gov-board-write) ----------

/** The owner's ops, sent by the board server as the owner (BOARD_OWNER). */
export const OWNER_OPS = [
  'create_task', 'assign', 'move_task', 'approve_plan', 'approve_task', 'done_no_steps', 'reply', 'add_note',
  'update_task', 'message_agent', 'nudge', 'archive_task', 'cancel_step', 'pin_task', 'unpin_task', 'start_task', 'send_back', 'publish_task', 'set_switch', 'reopen_task', 'split_task'
] as const
/**
 * Ops and its
 * (cancel_step, accepted 10/26/2026)'s my_steps's read_task (get_task for an OAuth caller). gw.gov-board-write
 * may not have them yet, so in gateway mode each one stays off until NUXT_BOARD_LIVE_OPS names it. Fixtures mode runs them all.
 */
export const PROPOSED_OPS = ['update_task', 'message_agent', 'nudge', 'archive_task', 'cancel_step', 'pin_task', 'unpin_task', 'start_task', 'send_back', 'publish_task', 'set_switch', 'my_steps', 'read_task', 'reopen_task', 'split_task', 'apply_rollup'] as const
/**
 * Agent ops that write, sent with the agent's own token. create_task and message_agent are the orchestrator hand-off.
 * split_task is the architect's fan-out: the agent holding the card's open architect step files its children.
 */
export const AGENT_WRITE_OPS = ['claim_step', 'heartbeat', 'add_note', 'update_step', 'complete_step', 'create_task', 'message_agent', 'split_task'] as const
/**
 * Agent ops that read. list_claimable and get_task are served from the board server's read cache. vera_brief is not: it
 * always runs the gateway's read_brief, for any caller, because the class rule runs in n8n.
 * read_brief is live on the host, so it is not in PROPOSED_OPS and NUXT_BOARD_LIVE_OPS needs no entry for it.
 */
export const AGENT_READ_OPS = ['list_claimable', 'get_task', 'vera_brief', 'board_report', 'board_activity', 'board_errors'] as const
/**
 * Ask the orchestrator (live on the droplet since 11/02/2026): ask_vera sends the owner's words to the orchestrator and
 * waits for her answer (up to about 100 s); vera_reply fetches one that came back pending. Sent with the caller's own token.
 */
export const ASK_OPS = ['ask_vera', 'vera_reply'] as const

export type OwnerOp = typeof OWNER_OPS[number]
export type AgentWriteOp = typeof AGENT_WRITE_OPS[number]
export type BoardOp = OwnerOp | AgentWriteOp

/** Who a write is for. The gateway resolves a token to an agent_id; the app never stores tokens. */
export type Caller = { person: string } | { agent_id: string }

/** The rows a write changed. The board merges them instead of re-reading. */
export interface WriteRows {
  tasks?: GovTask[]
  steps?: GovTaskStep[]
  notes?: GovTaskNote[]
}

/** One open loop in a brief (gw.gov-board-write read_brief). */
export interface BriefLoop {
  loop_id: string
  bucket: string
  loop: string
  owner: string
  rank: number | null
  watch: boolean
  stale: boolean
  opened: string
}

/**
 * The GitHub block in a brief (step 4, built in the task-write workflow). `age_line` comes first and is worked out
 * at read time. A caller without the personal class gets `withheld: true`, an empty `age_line` and `text`, and a note;
 * the other fields are then absent. `stale` and `source_ok` are null when the gateway cannot tell.
 */
export interface BriefGithub {
  withheld: boolean
  age_line: string
  never_synced?: boolean
  stale?: boolean | null
  source_ok?: boolean | null
  built_at?: string
  row_count?: number
  notes: string[]
  text: string
}

/** The Linear block in a brief (step 4). `text` leads with the digest age line; `needs_input` means the stale rule is undefined. */
export interface BriefLinear {
  text: string
  stale: boolean
  needs_input: boolean
}

/** The orchestrator's state as read_brief answers it. `focus` is null for a class-scoped caller. `github` is absent from a gateway that predates. */
export interface Brief {
  /** A plain-language opening line; absent from a gateway that predates it. */
  headline?: string
  as_of: string
  scope: { kind: 'all' | 'class', classes?: string[], buckets: string[] }
  focus: { now_id: string, focus: string, session_date: string, stale: boolean } | null
  next_up: BriefLoop[]
  watch: BriefLoop[]
  counts: { open: number, stale_open: number, by_bucket: Record<string, number> }
  github?: BriefGithub
  linear?: BriefLinear
  notes: string[]
}

/** `200 { ok, op, rows }` or `200 { ok: false, reason }`. `agent_id` comes back only from whoami and my_steps; `brief` only from read_brief. */
export type WriteResult =
  | { ok: true, op: string, rows: WriteRows, agent_id?: string, brief?: Brief, ref?: string, pending?: boolean, answer?: string, status?: string, ticket_id?: string }
  | { ok: false, op?: string, reason: string }

export const OP_LABELS: Record<BoardOp, string> = {
  create_task: 'Create',
  assign: 'Assign',
  move_task: 'Move',
  reopen_task: 'Reopen',
  split_task: 'Split into child cards',
  approve_plan: 'Approve plan',
  approve_task: 'Approve',
  done_no_steps: 'Done (on my word)',
  reply: 'Reply',
  add_note: 'Note',
  claim_step: 'Claim',
  heartbeat: 'Heartbeat',
  update_step: 'Update step',
  complete_step: 'Complete step',
  update_task: 'Save',
  message_agent: 'Message',
  nudge: 'Respond now',
  archive_task: 'Archive',
  cancel_step: 'Cancel step',
  pin_task: 'Pin',
  unpin_task: 'Unpin',
  start_task: 'Start',
  send_back: 'Send back',
  publish_task: 'Publish',
  set_switch: 'Agent switch'
}

/**
 * Plain-language text for gw.gov-board-write's fixed refusal reasons (the ops repo). Every other reason is
 * already a sentence naming the rule that failed (for example "Done needs internal_verification pass (schema rule 8);
 * it is none") and shows as sent.
 */
/** Drawer buttons while an agent's question is open: a note stays in the thread, a reply starts a new step. */
export const QUESTION_NOTE_LABEL = 'Add note · no step'
export const QUESTION_REPLY_LABEL = 'Reply · starts a step'

/** Shown under "Move to…" when a move was refused because the plan isn't approved yet. */
export const UNAPPROVED_PLAN_HINT = 'Approve the plan above first, then move the card.'

export const REFUSAL_LABELS: Record<string, string> = {
  'stale': 'Someone changed this card first. The board re-read it; try again.',
  'unknown token': 'The agent token isn\'t recognized.',
  'another claim changed the step first': 'Another agent claimed this step first.',
  'read only': 'Board writes are off until the write gateway is connected.',
  'signed out': 'Sign in again to make changes.',
  'no response': 'The board server didn\'t answer. Nothing was changed.',
  'op not live': 'The write gateway doesn\'t support this yet. Nothing was changed.'
}

// ---------- Agent lanes and data classes ----------

export type Lane = 'api' | 'harness'
export const API_DEPLOY_REF = 'gw.api-run'
export const HARNESS_RUNTIME = 'local_harness'
export const LANE_LABELS: Record<Lane, string> = { api: 'API', harness: 'Harness' }

/** A card carries its data class as a tag: class-general, class-personal, class-catalyst, class-fj. */
export const CLASS_TAG_PREFIX = 'class-'
export const GENERAL_CLASS = 'general'

/** Why a card will not run for its agent. `needed` is the card's missing class slugs, `held` the agent's classes. */
export function classMismatchLabel(needed: string[], held: string[]): string {
  const holds = `agent holds only ${held.join(', ')}`
  return needed.length
    ? `Will not run: needs ${needed.map(c => CLASS_TAG_PREFIX + c).join(', ')}, ${holds}`
    : `Will not run: no class tag on the card (add ${CLASS_TAG_PREFIX}${GENERAL_CLASS} if nothing private is in it), ${holds}`
}

export const REGISTER_API_AGENT_LABEL = 'Register API agent'
export const REGISTER_API_AGENT_HINT = 'Opens the registry form with the API agent fields filled. The key is an n8n credential; this app never asks for one.'
export const BUDGET_USED_LABEL = 'Budget used'
export const AGENT_NOTE_LABEL = 'Agent note'

// Quiet mode (board cleanup, 11/02/2026): automatic records fold away so the conversation reads first. Nothing is hidden for good.
/** The folded line for a run of automatic status notes in a card's thread. */
export const statusFoldLabel = (n: number, open: boolean): string =>
  open ? `Hide ${n} automatic update${n === 1 ? '' : 's'}` : `${n} automatic update${n === 1 ? '' : 's'}`
/** The toggle for a card's chat steps (each message to an agent and its answer, already in the thread). */
export const chatStepsLabel = (n: number, open: boolean): string =>
  open ? `Hide ${n} chat step${n === 1 ? '' : 's'}` : `Show ${n} chat step${n === 1 ? '' : 's'}`
/** The Plan page: epics, milestones and releases with their progress. Sketch is a tab on the same page. */
export const PLAN_LABEL = 'Plan'
export const PLAN_HREF = '/plan'

/** What each nav badge counts, by nav item. Shown as the badge's tooltip and read aloud as its label. */
export const NAV_BADGE_WHAT: Record<string, string> = {
  Floor: 'cards waiting on you',
  Board: 'open cards',
  Agents: 'agents working now',
  Shipped: 'cards shipped today'
}
/** The badge text. Until the board has loaded the count is unknown, so it shows a dash, not a false zero. */
export const navBadgeText = (count: number, loaded: boolean): string => loaded ? (count ? String(count) : '') : '–'
/** The badge's tooltip and aria-label, e.g. "3 cards waiting on you". */
export const navBadgeLabel = (item: string, count: number, loaded: boolean): string => {
  const what = NAV_BADGE_WHAT[item] ?? ''
  return loaded ? `${count} ${what}` : `Counting ${what}`
}

/** Registry fields the "Register API agent" shortcut fills. Values only, never a key. */
export const API_AGENT_PREFILL: Record<string, string> = {
  domain: 'personal',
  runtime: 'n8n_cloud',
  host: 'hosted',
  inference: 'cloud',
  reachability: 'outbound_only',
  agent_type: 'builder',
  request_types: 'api_task',
  environment: 'production',
  deploy_ref: API_DEPLOY_REF,
  exclusions: 'No tools, no repo or table access, no memory between steps, no personal or client data. Takes only cards tagged class-general.'
}
/** The access row every API agent needs first: it may see class-general cards and no other class. */
export const API_AGENT_CLASS_RESOURCE = `board:class:${GENERAL_CLASS}`

// ---------- CSV import and export ----------

/**
 * The card fields a CSV import can fill: the card editor's fields, which create_task and assign accept, plus the card's id.
 * `aliases` are header names (lowercase letters and digits only) that auto-match the field: this covers Jira, Linear and
 * GitHub Projects exports. A row with a Task ID updates that card (update_task's fields) instead of creating one; the only
 * alias is the board's own name, so a Jira "Issue key" or Linear "ID" column is never taken for a board id by mistake.
 */
export const IMPORT_FIELDS = [
  { field: 'task_id', label: 'Card ID (updates the card)', required: false, aliases: ['taskid'] },
  { field: 'title', label: 'Title', required: true, aliases: ['title', 'summary', 'name', 'subject', 'issuetitle'] },
  { field: 'original_request', label: 'Original request', required: false, aliases: ['originalrequest', 'description', 'body', 'details'] },
  { field: 'acceptance_requirements', label: 'Acceptance requirements', required: false, aliases: ['acceptancerequirements', 'acceptancecriteria', 'definitionofdone'] },
  { field: 'task_type', label: 'Card type', required: false, aliases: ['tasktype', 'type', 'issuetype'] },
  { field: 'priority', label: 'Priority', required: false, aliases: ['priority', 'severity'] },
  { field: 'project_id', label: 'Project', required: false, aliases: ['projectid', 'project', 'projectname', 'projectkey', 'team', 'epic', 'epiclink', 'milestone'] },
  { field: 'tags', label: 'Tags', required: false, aliases: ['tags', 'labels', 'label'] },
  { field: 'due_at', label: 'Due date', required: false, aliases: ['dueat', 'due', 'duedate', 'targetdate', 'deadline'] },
  { field: 'assignee', label: 'Assignee', required: false, aliases: ['assignee', 'assignedto', 'owner'] },
  { field: 'approval_state', label: 'Approval', required: false, aliases: ['approvalstate'] }
] as const
export type ImportField = typeof IMPORT_FIELDS[number]['field']

/** Other tools' priority words, folded onto the editor's choices. Anything not listed is lowercased and kept (priority is free text). */
export const PRIORITY_SYNONYMS: Record<string, string> = {
  lowest: 'low', minor: 'low', trivial: 'low',
  medium: 'normal', none: 'normal', major: 'high',
  highest: 'urgent', critical: 'urgent', blocker: 'urgent'
}

/** Most cards one import creates. Each card is one gateway write (an n8n execution), so a large file is split by the user. */
export const MAX_IMPORT_ROWS = 200

/** The columns of the CSV export, in order. The names are the schema's, so exporting and re-importing maps every column by name. */
export const EXPORT_COLUMNS = [
  'task_id', 'title', 'original_request', 'acceptance_requirements', 'task_type', 'priority', 'project_id', 'tags', 'due_at',
  'assignee', 'approval_state', 'work_state', 'stage', 'created_at'
] as const

// ---------- Table view and bulk edit ----------

export const TABLE_SORT_KEYS = ['id', 'title', 'stage', 'state', 'assignee', 'project', 'epic', 'milestone', 'type', 'priority', 'due', 'updated'] as const
export type TableSortKey = typeof TABLE_SORT_KEYS[number]
export const TABLE_SORT_LABELS: Record<TableSortKey, string> = {
  id: 'ID',
  title: 'Title',
  stage: 'Stage',
  state: 'Status',
  assignee: 'Assignee',
  project: 'Project',
  epic: 'Epic',
  milestone: 'Milestone',
  type: 'Type',
  priority: 'Priority',
  due: 'Due',
  updated: 'Updated'
}

/** The bulk edits. Each one is a single-card edit the board already has, repeated per card. */
export const BULK_KINDS = ['stage', 'assignee', 'priority', 'task_type', 'project_id', 'due_at', 'clear_due', 'add_tag', 'remove_tag', 'approve', 'pin', 'unpin', 'archive', 'delete'] as const
export type BulkKind = typeof BULK_KINDS[number]
export const BULK_LABELS: Record<BulkKind, string> = {
  stage: 'Move to stage',
  assignee: 'Assign to',
  priority: 'Set priority',
  task_type: 'Set type',
  project_id: 'Set project',
  due_at: 'Set due date',
  clear_due: 'Clear due date',
  add_tag: 'Add tag',
  remove_tag: 'Remove tag',
  approve: 'Approve',
  pin: 'Pin',
  unpin: 'Unpin',
  archive: 'Archive',
  delete: 'Delete'
}
/** The proposed op each bulk edit repeats; the bar hides an edit whose op the gateway doesn't have yet (board.canUse). */
export const BULK_OPS: Partial<Record<BulkKind, typeof PROPOSED_OPS[number]>> = {
  priority: 'update_task',
  task_type: 'update_task',
  project_id: 'update_task',
  due_at: 'update_task',
  clear_due: 'update_task',
  add_tag: 'update_task',
  remove_tag: 'update_task',
  pin: 'pin_task',
  unpin: 'unpin_task',
  archive: 'archive_task',
  delete: 'archive_task'
}

// ---------- Board v4: view switch, density, shortcuts (docs/design/v4/README.md) ----------

/** What the view switch offers. `stages` is the column view (no URL key needed); `table` is ?layout=table. */
export const BOARD_VIEWS = ['stages', 'table'] as const
export type BoardView = typeof BOARD_VIEWS[number]
export const BOARD_VIEW_LABELS: Record<BoardView, string> = { stages: 'Stages', table: 'Table' }
export const BOARD_VIEW_HINTS: Record<BoardView, string> = {
  stages: 'Backlog to Done',
  table: 'One row per card'
}

export const DENSITIES = ['comfortable', 'compact'] as const
export type Density = typeof DENSITIES[number]
export const DENSITY_LABELS: Record<Density, string> = { comfortable: 'Comfortable', compact: 'Compact' }

/** Keyboard shortcuts, in the order the shortcuts dialog and Settings list them. */
export const SHORTCUTS: { keys: string, action: string }[] = [
  { keys: '⌘K', action: 'Command palette: pages, cards, actions, or ask the orchestrator' },
  { keys: 'G  then  F B A S', action: 'Floor, Board, Agents, Shipped' },
  { keys: '/', action: 'Focus search (Board, Agents Roster, the orchestrator history, Shipped)' },
  { keys: 'F', action: 'Open or close filters (Board, Registry)' },
  { keys: 'N', action: 'New card' },
  { keys: '1  2', action: 'Stages, Table (Board)' },
  { keys: 'X', action: 'Select the focused card' },
  { keys: 'J  K', action: 'Next or previous card, with a card open' },
  { keys: 'R  M  A', action: 'Reply, Move, Assign, with a card open' },
  { keys: 'Esc', action: 'Close the top panel, then clear the selection (works while typing too)' },
  { keys: ',', action: 'Settings' },
  { keys: '[', action: 'Hide or show the sidebar (desktop)' },
  { keys: '?', action: 'Keyboard shortcuts' },
  { keys: 'Tab', action: 'Move to the next control. The first stop on every page is "Skip to content"' }
]

// ---------- Help and explanations (plain-language text for the drawer, cards and /help) ----------

/**
 * Text that comes from board data (columns, step activity) and still carries a retired word. The live tables are not ours
 * to edit, so the app shows its own wording for these exact strings. Add a pair here, not a rename in the data.
 */
export const DATA_TEXT_OVERRIDES: Record<string, string> = {
  'Logged + archived': 'Done, then archived',
  'Logged': 'Signed off',
  'Claimable by builder agents': 'Open to any builder agent'
}
export const plainData = (text: string): string => DATA_TEXT_OVERRIDES[text] ?? text

/** The two voices of the assistant panel: the name on replies and the one-line role under the panel header. */
export const VOICES = {
  get orchestrator() { return { name: orchestratorLabel, role: `${orchestratorLabel}: answers and routes` } },
  manager: { name: 'Board manager', role: 'Board manager: edits cards in bulk' }
}

/** One line per work_state: the pill's tooltip and the /help glossary. */
export const WORK_STATE_HELP: Record<WorkState, string> = {
  backlog: 'Nothing is working on this card. Move it to Architecture or Build to bring an agent in.',
  awaiting_start: 'An agent is lined up but has not started. It starts when the agent next checks the board, or when you approve it if approval is pending.',
  in_progress: 'An agent has claimed a step and is working on it now.',
  needs_input: 'An agent stopped to ask you something, or a plan is waiting for your approval. Nothing moves until you answer.',
  blocked: 'A step failed or was cancelled and nothing else is running. The board does not retry on its own, so you pick the next move.',
  verifying: 'The agent work is finished and passed its check. It is ready for your review and sign-off.',
  done: 'Signed off and done. Done cards are archived after 14 days.'
}

/** What a card in each stage is waiting for. */
export const STAGE_HELP: Record<Stage, string> = {
  backlog: 'Ideas and requests. No agent touches a card here.',
  architecture: 'An advisor reads the card and posts a plan. You approve the plan, then move the card to Build.',
  build: 'A builder does the work. When every required step passes, the card moves itself to Review.',
  review: 'Your sign-off. Move it to Done to approve, or back to Build to send it back with a note.',
  done: 'Finished. Nothing more runs here.'
}

/** What each step role means, in words. Roles come from board_columns.roles_json. */
export const ROLE_LABELS: Record<string, string> = {
  architect: 'Plans the work',
  builder: 'Builds it',
  consult: 'Gives a second opinion',
  auditor: 'Checks the result',
  cleanup: 'Logs and archives',
  chat: 'Answers a message'
}

/** What an agent's request_types entries mean, for the "Who does what" list. */
export const REQUEST_TYPE_LABELS: Record<string, string> = {
  plan_container: 'Plan a new agent',
  explain_spec: 'Explain how the system works',
  audit_container: 'Audit an agent (read only)',
  draft_workflow: 'Draft an n8n workflow',
  api_task: 'Answer a request from the card text alone',
  board_reply: 'Answer messages on a card'
}

/** The usual reasons an agent has not responded to a card, most common first. Shown on /help above the agent list. */
export const NO_RESPONSE_REASONS = [
  'The card is still in Backlog or Review. Agents only work cards in Architecture and Build. Create and start or Start moves a card there; assigning someone alone does not.',
  'The agent cannot be woken. The dispatcher starts the laptop agent\'s build and plan steps within about a minute while it runs, but a message waits for an open session. The cloud builder is woken by the dispatcher, otherwise it runs every 6 hours.',
  'The agent is in no pool (no agent type in the registry). It only gets a step when you name it on a card, then move the card into a column.',
  'The agent does not take messages. A comment goes to the orchestrator instead, so the agent never sees it.',
  'The card is missing the class tag the agent needs (for example class-general), so the board will not run it.',
  'The agent is not in service (in development, or a template).'
]

/** Behaviors that surprise people. Shown on /help and kept next to the rule that causes each. */
export const BOARD_QUIRKS: { title: string, body: string }[] = [
  {
    title: 'Needs you is about cards; Agent problems is about agents',
    body: 'Needs you counts cards that wait on your answer or approval. Agent problems (Agents, Problems tab) lists agents with a gap, drift or access that is not current.'
  },
  {
    title: 'Step words: Waiting for an agent, Done, checking, Open to any agent',
    body: 'A step is Waiting for an agent until one picks it up. It is Done, checking once the agent has handed in its work and the check has not finished. Open to any agent means any agent in the pool may pick the step up.'
  },
  {
    title: 'Ask the orchestrator, or the board manager',
    body: 'Every Ask the orchestrator button opens one panel. The orchestrator answers and routes. The Board manager edits cards in bulk; switch to it in the panel header or pick Ask the board manager in the command palette. Each reply names who wrote it.'
  },
  {
    title: 'Changing the assignee does not start or hand over work',
    body: 'The assignee is only used the next time the card enters Architecture or Build. A step that already exists keeps its agent. To switch agents on a card in progress: cancel the open step, move the card out of the column, then move it back in. The new step goes to the new assignee.'
  },
  {
    title: 'A card cannot leave a column while its step is open',
    body: 'Finish the step, or cancel it first (Steps list in the card). Cancelling turns the card Blocked until you move it.'
  },
  {
    title: 'You cannot change the assignee of a Done card',
    body: 'Done is final. Make a new card if more work is needed.'
  },
  {
    title: 'Approving a plan does not move the card',
    body: 'Approve the plan, then move the card to Build yourself.'
  },
  {
    title: 'A reply starts a new step, a note does not',
    body: 'When an agent asks a question, Reply gives the agent a new step to work on. Add note only records text; the agent is not woken.'
  },
  {
    title: 'Some agents answer in minutes, others only when a session is open',
    body: 'The orchestrator is hosted and can be woken with Respond now. The dispatcher starts the laptop agent\'s build and plan steps within about a minute; its messages wait for an open session. The cloud builder runs when woken, or every 6 hours.'
  },
  {
    title: 'Blocked cards are not retried',
    body: 'A failed or cancelled step stays that way. Fix the cause, then move the card out and back in to run a fresh step.'
  }
]
