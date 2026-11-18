// Fixture stand-in for gw.gov-board-write and the task-write workflow's board route, used in fixtures mode only: by the
// browser (edits kept in localStorage) and by the board server (REST and MCP). In gateway mode n8n does all of this
// and the app only merges the rows it returns.
// It ports the ops repo (as of commit 2f808d0), which is the contract: gateways/board-write/nodes/check_op.js and
// the writer's check_board, plan_board, lib_claim, lib_notes and lib_rollup modules. Same op table, the same
// checks in the same order, the same refusal reasons, and the same rows back. Keep them in step when #121 changes.
// Differences: no gov_access here, so a pool claim checks agent_type only (#121 also needs a board:role:<role> row);
// no vera_ledger row; ids continue the fixtures' 900000 range.
// update_task, message_agent, nudge and archive_task follow; cancel_step follows its
//.
// Differences: the orchestrator answers a chat step through its ticket path there (board_reply); here it claims and acks it like any
// agent, so a chat step that a nudge moved to awaiting_start stays open to any agent. No wake call is made.
import type { BoardData, Brief, Caller, ColumnRole, GovTask, GovTaskNote, GovTaskStep, NoteKind, RegistryAgent, Stage, WriteResult, WriteRows } from '~/types/board'
import { BOARD_REPLY, CHAT_ROLE, boardOwner, defaultRunner, boardOwnerName, NOTE_KINDS, orchestratorId, STAGES, vaultPersonalFolders, vaultFolderName } from '~/types/board'
import { attemptsFor, loopBudget, RETRY_PREFIX } from '~/utils/goal'
import { splitList } from '~/utils/format'
import { columnRoles, isPool, poolType } from '~/utils/rollup'

/** Who a role's step goes to: the named agent when eligible (active, agent_type blank or listed for the role), else the pool. */
export function roleAssignee(who: string, r: ColumnRole, registry: RegistryAgent[]): string {
  const types = r.agent_types ?? []
  const reg = registry.find(x => x.agent_id === who)
  const eligible = !!reg && reg.lifecycle_status === 'active' && (s(reg.agent_type) === '' || types.includes(s(reg.agent_type)))
  return eligible ? who : r.pool || `pool:${types[0] ?? 'none'}`
}

export const LEASE_PREFIX = 'gw.gov-board-write@'
const LEASE_MS = 900_000
const QUIET_HEARTBEAT_MS = 300_000
const NOTE_CAP = 2000
// A step's output_summary is cut at 500, except a chat step's: that is the agent's answer and becomes the comment note,
// so it gets the note's 2,000 and is refused over it, as the task-write workflow does.
const SUMMARY_CAP = 500

/**
 * Whether a step keeps a card out of "Done (no agent steps)". A cancelled step never does. An answered chat step is a
 * finished conversation. A finished step (acked, served or verified) is a record that can't
 * be cancelled and has nothing left to run (amendment). An open or stalled step (not acked,
 * needs_input, failed) does: cancel it first. Kept the same as plan_board.js's done_no_steps in the ops repo.
 */
export function holdsCardOut(x: GovTaskStep): boolean {
  if (x.cancelled === true) return false
  if (x.role === CHAT_ROLE && !!x.acked_at) return false
  return !(!!x.acked_at && (x.step_state === 'served' || x.step_state === 'verified'))
}

// The forms' secret regex (rule 7), the same as #121's lib_notes.js and check_op.js.
const SECRET_RE = /(sk-[A-Za-z0-9]{8,}|xox[abpr]-|ghp_[A-Za-z0-9]{10,}|github_pat_|AKIA[0-9A-Z]{12,}|-----BEGIN|bearer\s+[A-Za-z0-9._-]{12,}|(api[_-]?key|password|secret|token)\s*[:=]\s*\S{6,})/i

/** #121's op table (check_op.js / check_board.js): who may call, then the required and optional args. */
const BOARD_OPS: Record<string, { who: 'person' | 'agent' | 'any', req: string[], opt: string[] }> = {
  create_task: { who: 'any', req: ['title'], opt: ['original_request', 'acceptance_requirements', 'task_type', 'priority', 'project_id', 'board_id', 'tags', 'approval_state', 'due_at', 'context'] },
  assign: { who: 'person', req: ['task_id', 'updated_at'], opt: ['assignee'] },
  move_task: { who: 'person', req: ['task_id', 'stage', 'updated_at'], opt: [] },
  // Hands-off board: Start and Restart a card, and Send back from Review.
  start_task: { who: 'person', req: ['task_id', 'updated_at'], opt: [] },
  send_back: { who: 'person', req: ['task_id', 'body', 'updated_at'], opt: [] },
  // Publish: the one step the runner lets push. Only this op sets target_action 'publish'; card text and agents cannot.
  publish_task: { who: 'person', req: ['task_id', 'updated_at'], opt: [] },
  // Raise retry_cap on a card the orchestrator escalated at the cap and send it back to Build.
  reopen_task: { who: 'person', req: ['task_id', 'retry_cap', 'updated_at'], opt: [] },
  approve_plan: { who: 'person', req: ['step_id', 'updated_at'], opt: [] },
  approve_task: { who: 'person', req: ['task_id', 'updated_at'], opt: [] },
  done_no_steps: { who: 'person', req: ['task_id', 'updated_at'], opt: [] },
  reply: { who: 'person', req: ['step_id', 'body', 'updated_at'], opt: [] },
  claim_step: { who: 'agent', req: ['step_id', 'claim_key', 'updated_at'], opt: [] },
  heartbeat: { who: 'agent', req: ['step_id', 'activity', 'updated_at'], opt: [] },
  update_step: { who: 'agent', req: ['step_id', 'step_state', 'stop_reason', 'updated_at'], opt: [] },
  complete_step: { who: 'agent', req: ['step_id', 'step_state', 'updated_at'], opt: ['verdict', 'target_ticket_ref', 'budget_used', 'output_ref', 'output_summary', 'stop_reason'] },
  add_note: { who: 'any', req: ['task_id', 'body'], opt: ['step_id', 'kind'] },
  // Proposed (change request 10/26/2026).
  update_task: { who: 'person', req: ['task_id', 'updated_at'], opt: ['title', 'acceptance_requirements', 'task_type', 'priority', 'project_id', 'board_id', 'tags', 'due_at'] },
  message_agent: { who: 'any', req: ['task_id', 'body'], opt: ['to'] },
  nudge: { who: 'person', req: ['step_id', 'updated_at'], opt: [] },
  archive_task: { who: 'person', req: ['task_id', 'updated_at'], opt: [] },
  cancel_step: { who: 'person', req: ['step_id', 'updated_at'], opt: [] },
  // Pinned cards are skipped by cleanup and sort first.
  pin_task: { who: 'person', req: ['task_id', 'updated_at'], opt: [] },
  unpin_task: { who: 'person', req: ['task_id', 'updated_at'], opt: [] },
  // Split a card into Backlog children tagged parent-<id>. `children` is JSON text: [{ title, acceptance_requirements? }].
  // The owner, or the agent holding the card's open architect step.
  split_task: { who: 'any', req: ['task_id', 'children', 'updated_at'], opt: [] },
  // The orchestrator's state for an agent. No args, no write.
  read_brief: { who: 'agent', req: [], opt: [] },
  // Path B cutover step 4: the drain writes the card fields the step store computed
  // (stage, work_state and the rest of ROLLUP_FIELDS) onto gov_tasks. Board server only, never the UI or an agent; no
  // updated_at guard, because the steps are the truth and the card follows them. Numbers and dates arrive as text.
  apply_rollup: { who: 'person', req: ['task_id'], opt: [] /* filled from ROLLUP_FIELDS below */ },
  // Path B: an agent's create_task makes the card in n8n; this op then makes the hand-off note and the orchestrator's chat step on the
  // step store for that card (the agent branch of create_task). Board server only.
  handoff_step: { who: 'agent', req: ['task_id'], opt: ['context'] }
}

/**
 * The card fields a step-store write may change (every touchTask field that is not a create_task/update_task field). The
 * drain sends them to apply_rollup as text; the op turns counts back into numbers and a blank archived_at into null.
 */
export const ROLLUP_FIELDS = ['stage', 'work_state', 'assignee', 'current_step', 'steps_total', 'internal_verification', 'macro_verification', 'approval_state', 'escalation', 'outputs_ref', 'retry_cap', 'archived_at', 'updated_by'] as const
BOARD_OPS.apply_rollup!.opt = [...ROLLUP_FIELDS]

/** Fields create_task and update_task share. Blank fields are skipped. */
const TASK_FIELDS = ['title', 'acceptance_requirements', 'task_type', 'priority', 'project_id', 'board_id', 'tags', 'due_at'] as const

/** The agent on the card: the one on its open step (not a chat step), else its assigned agent, else ''. */
export function cardAgent(task: GovTask, steps: GovTaskStep[]): string {
  const open = steps
    .filter(x => x.task_id === task.task_id && x.cancelled !== true && blank(x.acked_at) && x.role !== CHAT_ROLE && /^agt-/.test(x.assignee))
    .sort((x, y) => y.step_no - x.step_no)[0]
  if (open) return open.assignee
  return /^agt-/.test(task.assignee) ? task.assignee : ''
}

/** An active agent whose registry row lists board_reply. */
export function takesMessages(id: string, registry: RegistryAgent[]): boolean {
  const r = registry.find(x => x.agent_id === id)
  return !!r && r.lifecycle_status === 'active' && r.switch !== 'off' && s(r.request_types).split(',').map(x => x.trim()).includes(BOARD_REPLY)
}

/**
 * Who a message goes to. The orchestrator is the front door (decided 11/2/2026): a message
 * goes to the agent it names (`to`, the @tag in a comment or the composer's agent picker) when that agent takes
 * messages, and to the orchestrator otherwise. The card's agent no longer gets an untagged message; the orchestrator relays or answers.
 * This supersedes the order (open step's agent, then assignee, then the orchestrator), so the live
 * gateway must change with it. The card's assignee and steps never change.
 */
export function chatTarget(_task: GovTask, _steps: GovTaskStep[], registry: RegistryAgent[], caller = '', to = ''): string {
  // An agent never messages itself; its message falls through to the orchestrator.
  if (to && to !== caller && takesMessages(to, registry)) return to
  return orchestratorId()
}

/** Tag prefix that names a card's parent. The tag is lowercase: `parent-tsk-<number>` waits. */
export const PARENT_PREFIX = 'parent-'

/** The parent task id a card names in its tags ('' when none). */
export function parentOf(task: Pick<GovTask, 'tags'>): string {
  const tag = splitList(task.tags ?? '').find(x => x.startsWith(PARENT_PREFIX) && x.length > PARENT_PREFIX.length)
  return tag ? tag.slice(PARENT_PREFIX.length).toUpperCase() : ''
}

/** The name a comment uses to tag an agent: its id without "agt-" (@orchestrator, @claude-code-macbook). */
export const handleOf = (id: string) => id.replace(/^agt-/, '')

/** Agents a comment can tag: those that take messages. Largo and the like, with no board_reply, are not offered. */
export function taggable(registry: RegistryAgent[]): RegistryAgent[] {
  return registry.filter(r => takesMessages(r.agent_id, registry))
}

/** The first @handle in a comment that names a taggable agent ('' when none). Later tags are ignored. */
export function taggedAgent(body: string, registry: RegistryAgent[]): string {
  const ids = new Map(taggable(registry).map(r => [handleOf(r.agent_id), r.agent_id]))
  for (const m of body.matchAll(/(?<![\w@])@([a-z0-9][a-z0-9-]*)/gi)) {
    const id = ids.get(m[1]!.toLowerCase())
    if (id) return id
  }
  return ''
}

/** An agent a nudge can wake: hosted on n8n_cloud with no reachability limit. Today only the orchestrator. */
export function canWake(id: string, registry: RegistryAgent[]): boolean {
  const r = registry.find(x => x.agent_id === id)
  return !!r && r.lifecycle_status === 'active' && r.switch !== 'off' && r.runtime === 'n8n_cloud' && r.host === 'hosted'
    && !['outbound_only', 'unreachable_when_asleep'].includes(s(r.reachability))
}

type Board = Pick<BoardData, 'tasks' | 'steps' | 'notes' | 'columns' | 'registry' | 'board_async'>

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v))
const blank = (v: unknown) => v === undefined || v === null || v === ''
const clone = <T>(row: T): T => JSON.parse(JSON.stringify(row)) as T
// updated_at values match when they are the same instant (#121's `same`).
const same = (x: unknown, y: unknown) => !blank(x) && !blank(y) && new Date(s(x)).getTime() === new Date(s(y)).getTime()

/** Upserts returned rows by id. Used for the server's read cache and the browser's rows alike. */
export function mergeRows(board: Pick<BoardData, 'tasks' | 'steps' | 'notes'>, rows: WriteRows) {
  const upsert = <T>(list: T[], incoming: T[] | undefined, key: keyof T) => {
    for (const row of incoming ?? []) {
      const i = list.findIndex(r => r[key] === row[key])
      if (i === -1) list.push(row)
      else list.splice(i, 1, row)
    }
  }
  upsert(board.tasks, rows.tasks, 'task_id')
  upsert(board.steps, rows.steps, 'step_id')
  upsert(board.notes, rows.notes, 'note_id')
}

/** Steps an agent may claim now: its own, plus pool steps of its agent_type (lib_claim's fresh or lease-expired). */
export function claimableSteps(board: Board, agentId: string, now = Date.now()): GovTaskStep[] {
  const type = s(board.registry.find(a => a.agent_id === agentId)?.agent_type)
  return board.steps.filter(st =>
    st.cancelled !== true && blank(st.acked_at) && claimableNow(st, now)
    && (st.assignee === agentId || (!!type && isPool(st.assignee) && poolType(st.assignee) === type))
  )
}

function claimableNow(st: GovTaskStep, now: number): boolean {
  if (st.step_state === 'awaiting_pull') return true
  // A nudged chat step. Live, the orchestrator answers it through its ticket path instead of a claim.
  if (st.step_state === 'awaiting_start' && st.role === CHAT_ROLE) return true
  return st.step_state === 'dispatched' && st.claim_count >= 1 && !blank(st.lease_expires_at) && Date.parse(s(st.lease_expires_at)) < now
}

/** lib_rollup's stagedMove: where a card in Architecture or Build goes after its steps change. */
function stagedMove(t: GovTask, steps: GovTaskStep[], board: Board): Partial<GovTask> | null {
  const stage = s(t.stage)
  if (stage !== 'architecture' && stage !== 'build') return null
  const roles = columnRoles(board.columns.find(c => c.view === 'stages' && c.match === `stage=${stage}`)).filter(r => r.role)
  // The current step of a role is its highest step_no (a reply or a reject adds a newer one).
  const latest = (list: GovTaskStep[]) => [...list].sort((a, b) => b.step_no - a.step_no)[0]
  const current = roles.map(r => latest(steps.filter(x => x.task_id === t.task_id && s(x.role) === r.role))).filter(Boolean) as GovTaskStep[]
  if (!current.length) return null
  const eff = (x: GovTaskStep) => {
    if (x.cancelled === true) return 'failed'
    if (x.step_state === 'served' && x.verdict !== 'PASS') return 'failed'
    if (stage === 'architecture' && x.role === 'architect' && x.step_state === 'served') return 'needs_input'
    return x.step_state
  }
  const done = (x: GovTaskStep) => x.cancelled !== true && (stage === 'architecture' ? x.step_state === 'verified' : x.step_state === 'served' && x.verdict === 'PASS')
  const required = roles.filter(r => r.required === true).map(r => r.role)
  let st = stage
  let ws: GovTask['work_state']
  let iv = s(t.internal_verification)
  let esc = s(t.escalation) || 'none'
  let outs = s(t.outputs_ref)
  const states = current.map(eff)
  if (states.includes('needs_input')) ws = 'needs_input'
  else if (states.includes('failed')) {
    ws = 'blocked'
    const f = current.find(x => eff(x) === 'failed')!
    esc = f.step_id + ' ' + (f.cancelled === true ? 'cancelled' : s(f.stop_reason) || 'verdict ' + (s(f.verdict) || 'blank'))
  } else if (states.includes('dispatched')) ws = 'in_progress'
  else if (required.length && required.every(n => { const x = current.find(c => c.role === n); return !!x && done(x) })) {
    ws = 'verifying'
    if (stage === 'build') {
      const last = current.filter(x => required.includes(s(x.role))).sort((a, b) => s(b.acked_at).localeCompare(s(a.acked_at)))[0]!
      st = 'review'
      const ref = s(last.target_ticket_ref) || last.step_id
      iv = `pass (${s(last.verdict)}, ${ref})`
      outs = [outs, ref].filter(Boolean).join(', ')
    }
  } else ws = 'awaiting_start'
  if (ws === t.work_state && st === stage && iv === s(t.internal_verification) && esc === (s(t.escalation) || 'none')) return null
  return { stage: st as Stage, work_state: ws, internal_verification: iv, escalation: esc, outputs_ref: outs }
}

/**
 * Applies one op to `board` in place and returns the gateway's answer.
 * `caller` is already resolved: the board owner from the board server, or an agent_id from a token.
 */
export function applyOp(board: Board, op: string, args: Record<string, unknown>, caller: Caller, nowMs = Date.now()): WriteResult {
  const callerId = 'person' in caller ? caller.person : caller.agent_id
  const reason = checkBoard(op, args, callerId) || planBoard(board, op, args as Record<string, string>, callerId, nowMs)
  if (typeof reason === 'string') return { ok: false, op, reason }
  return { ok: true, op, rows: reason }
}

/**
 * One op for a caller that is already resolved: the owner, or an agent whose token the store has checked. An agent also gets
 * the read ops (whoami, my_steps, read_brief, read_task) that the gateway answers without writing. Shared by fixtures mode
 * and the reference adapter, so both give the same answers.
 */
export function runOp(board: Board, op: string, args: Record<string, unknown>, caller: Caller): WriteResult {
  if ('person' in caller) return applyOp(board, op, args, caller)
  const agentId = caller.agent_id
  if (op === 'whoami') return { ok: true, op, rows: {}, agent_id: agentId }
  if (op === 'my_steps') {
    // The gateway lists by lib_claim's rule; here the read cache's claimableSteps stands in for it.
    const steps = claimableSteps(board, agentId)
    return { ok: true, op, rows: { tasks: board.tasks.filter(t => steps.some(s => s.task_id === t.task_id)), steps, notes: [] }, agent_id: agentId }
  }
  if (op === 'read_brief') {
    // The fixture agents carry no board:class:* row, so every caller is unscoped and gets the full copy.
    return readBrief(args, agentId)
  }
  if (op === 'read_task') {
    // The gateway applies the class rule; fixtures have no classes, so this returns the card.
    const task = board.tasks.find(t => t.task_id === String(args.task_id ?? ''))
    if (!task) return { ok: false, op, reason: `unknown task ${String(args.task_id ?? '')}` }
    return { ok: true, op, rows: { tasks: [task], steps: board.steps.filter(s => s.task_id === task.task_id), notes: board.notes.filter(n => n.task_id === task.task_id) }, agent_id: agentId }
  }
  return applyOp(board, op, args, caller)
}

/**
 * Fixtures mode's read_brief: refuses an argument like the gateway does, else a made-up brief. Every fixture agent is
 * unscoped (the fixtures carry no board:class:* rows), so it is always the full copy; the gateway gives a class-scoped
 * caller no focus and only its mapped buckets.
 */
export function readBrief(args: Record<string, unknown>, agentId: string): WriteResult {
  const reason = checkBoard('read_brief', args, agentId)
  if (reason) return { ok: false, op: 'read_brief', reason }
  return { ok: true, op: 'read_brief', rows: { tasks: [], steps: [], notes: [] }, brief: fixtureBrief() }
}

function fixtureBrief(): Brief {
  const loop = (n: number, bucket: string, text: string, rank: number, watch: boolean, stale: boolean) =>
    ({ loop_id: `LOOP-9000${n}`, bucket, loop: text, owner: boardOwnerName(), rank, watch, stale, opened: '2026-10-20' })
  const next = [
    loop(1, 'work', 'Fixture loop: review the weekly board triage', 1, false, false),
    loop(2, 'side-hustle', 'Fixture loop: send the sample invoice', 2, false, true),
    loop(3, 'work', 'Fixture loop: check the nightly export', 3, false, false)
  ]
  const watch = [loop(4, 'work', 'Fixture loop: watch the Vercel deploy', 9, true, false)]
  return {
    as_of: new Date().toISOString(),
    scope: { kind: 'all', buckets: ['work', 'side-hustle'] },
    focus: { now_id: 'NOW-900001', focus: 'Fixture focus: the board and the orchestrator connector', session_date: '2026-10-27', stale: false },
    next_up: next,
    watch,
    counts: { open: 4, stale_open: 1, by_bucket: { work: 3, 'side-hustle': 1 } },
    github: {
      withheld: false,
      age_line: 'GitHub digest: built 10/27/2026 9:00 AM, 1 hour old.',
      never_synced: false,
      stale: false,
      source_ok: true,
      built_at: '2026-10-27T14:00:00.000Z',
      row_count: 3,
      notes: [],
      text: 'Fixture data: 2 repos, 1 open, 2 merged.'
    },
    linear: { text: 'Linear digest: built 10/27/2026 9:00 AM, 1 hour old.\nFixture data: 2 projects in progress.', stale: false, needs_input: false },
    notes: ['Fixture data: not the orchestrator\'s real state.']
  }
}

/** Check Op / Check Board: the op table, who may call, the args, the secret regex, the note cap. '' when allowed. */
function checkBoard(op: string, args: Record<string, unknown>, caller: string): string {
  const spec = Object.prototype.hasOwnProperty.call(BOARD_OPS, op) ? BOARD_OPS[op]! : null
  if (!spec) return `op ${op} is not allowed`
  const isPerson = caller === boardOwner()
  if (spec.who === 'person' && !isPerson) return `${op} is ${boardOwner()} only`
  if (spec.who === 'agent' && isPerson) return `${op} is for an agent holding the step lease`
  const keys = Object.keys(args)
  const extra = keys.filter(k => !spec.req.includes(k) && !spec.opt.includes(k))
  if (extra.length) return `${op} does not take ${extra.join(', ')}`
  const nonString = keys.filter(k => typeof args[k] !== 'string')
  if (nonString.length) return `${nonString.join(', ')} must be text`
  const missing = spec.req.filter(k => s(args[k]).trim() === '')
  if (missing.length) return `${op} needs ${missing.join(', ')}`
  const secret = keys.find(k => SECRET_RE.test(s(args[k])))
  if (secret) return `the field "${secret}" looks like it holds a secret`
  const vault = keys.find(k => vaultRefusal(s(args[k])))
  if (vault) return `the field "${vault}" ${vaultRefusal(s(args[vault]))}`
  if ('body' in args) return noteRefusal(s(args.body))
  return ''
}

// An agent's hand-off context, a JSON object of text under these keys.
const CONTEXT_KEYS = ['source_surface', 'account', 'repo', 'branch', 'pr_url', 'session_id', 'classification'] as const
const CLASSES = ['personal', 'catalyst', 'fj']
type HandOffContext = Partial<Record<typeof CONTEXT_KEYS[number], string>>

/** The parsed context, or the refusal reason (the same reasons as the task-write workflow's plan_board.js). */
function readContext(v: unknown): HandOffContext | string {
  if (blank(v)) return {}
  let o: unknown
  try { o = JSON.parse(s(v)) } catch { return 'context is not JSON' }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'context is not an object'
  const bad = Object.keys(o).filter(k => !(CONTEXT_KEYS as readonly string[]).includes(k))
  if (bad.length) return `context does not take ${bad.join(', ')}`
  if (Object.values(o).some(x => typeof x !== 'string')) return 'context values must be text'
  const c = o as HandOffContext
  if (!blank(c.classification) && !CLASSES.includes(c.classification!)) return `context classification ${c.classification} is not one of ${CLASSES.join(', ')}`
  return c
}

function noteRefusal(body: string): string {
  if (body.trim() === '') return 'note body is blank'
  if (body.length > NOTE_CAP) return `note body is ${body.length} characters; the cap is 2,000`
  if (SECRET_RE.test(body)) return 'note body looks like it holds a secret'
  return ''
}

// Vault paths: a system file's path may be named, a personal note's never.
// System files are AGENTS.md, README.md, now.md, open-loops.md and anything under _os/. Local port of the check_board.js pattern.
/** Matches a path into the configured vault folder (NUXT_PUBLIC_VAULT_FOLDER); null when none is set. */
function vaultRefRe(): RegExp | null {
  const name = vaultFolderName()
  if (!name) return null
  return new RegExp(`(?:~|\\/Users\\/[^/\\s]+|\\$HOME)?\\/?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/([^\\s)"'\`,;]*)`, 'g')
}
const VAULT_SYSTEM_RE = /^(?:AGENTS\.md|README\.md|now\.md|open-loops\.md|_os(?:\/|$)|$)/
/** Matches a path into one of the configured personal folders (NUXT_PUBLIC_VAULT_PERSONAL_FOLDERS); null when none is set. */
function vaultPersonalRe(): RegExp | null {
  const names = vaultPersonalFolders()
  return names.length ? new RegExp(`(?:${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\/`, 'i') : null
}

/** A refusal reason when the text names a personal vault note, else ''. */
function vaultRefusal(text: string): string {
  if (vaultPersonalRe()?.test(text)) return 'names a personal vault folder; describe where it lives in words'
  const re = vaultRefRe()
  for (const m of re ? text.matchAll(re) : []) {
    if (!VAULT_SYSTEM_RE.test(m[1] ?? '')) return 'names a vault path that is not a system file; describe where it lives in words'
  }
  return ''
}

/** Plan Board and Board Result in one: a refusal reason, or the rows the op changed (Board Response's shape). */
/** A new Backlog card with every field at its starting value; create_task and split_task fill in the rest. */
function blankTask(id: string, title: string, caller: string, now: string, by: string): GovTask {
  return {
    task_id: id, title, original_request: title, acceptance_requirements: '', task_type: 'build', proposed_assignee: '', assignee: '',
    upgrade_target: '', execution_policy: '', approval_state: 'not_required', work_state: 'backlog',
    current_step: 0, steps_total: 0, outputs_ref: '', internal_verification: 'none', macro_verification: 'none', escalation: 'none',
    priority: 'normal', project_id: '', board_id: '', created_by: caller, created_at: now,
    due_at: null, updated_by: by, updated_at: now, stage: 'backlog', tags: ''
  }
}

function planBoard(board: Board, op: string, a: Record<string, string>, caller: string, nowMs: number): string | WriteRows {
  const now = new Date(nowMs).toISOString()
  const by = `${caller} (board)`
  const leaseOwner = /^agt-/.test(caller) ? LEASE_PREFIX + caller : ''
  const taskOf = (id: string) => board.tasks.find(t => t.task_id === id) ?? null
  const stepOf = (id: string) => board.steps.find(x => x.step_id === id) ?? null
  const stepsOf = (id: string) => board.steps.filter(x => x.task_id === id)
  const isOpen = (x: GovTaskStep) => x.cancelled !== true && blank(x.acked_at)
  const latest = (list: GovTaskStep[]) => [...list].sort((x, y) => y.step_no - x.step_no)[0] ?? null
  const maxNo = (ids: string[], prefix: string) => Math.max(900000, ...ids.filter(i => i.startsWith(prefix)).map(i => Number(i.slice(prefix.length)) || 0))
  const nextId = (prefix: string, ids: string[]) => `${prefix}${String(maxNo(ids, prefix) + 1).padStart(6, '0')}`
  const approvedIfPending = (t: GovTask) => (t.approval_state === 'pending' ? 'approved' : t.approval_state)

  // What the answer carries: the card's task row, the steps changed or inserted, the notes inserted.
  let taskId = s(a.task_id)
  const touched = new Set<string>()
  const inserted: GovTaskNote[] = []
  let rollup = false

  const newStep = (t: GovTask, stepNo: number, role: string, assignee: string, goal: string, inputRef: string, action: string): GovTaskStep => {
    const stepId = nextId('STP-', board.steps.map(x => x.step_id))
    const step: GovTaskStep = {
      step_id: stepId, task_id: t.task_id, step_no: stepNo, assignee, goal, input_ref: inputRef, target_action: action || 'read',
      target_ticket_ref: '', step_state: 'awaiting_pull', stop_reason: '', verdict: '', budget_used: '', output_ref: '', output_summary: '',
      vera_ticket_ref: '', created_at: now, dispatched_at: null, ended_at: null, updated_at: now, claim_key: `pull:${stepId}`,
      lease_owner: '', lease_expires_at: null, acked_at: null, cancelled: false, claim_count: 0, last_claimed_at: null,
      role, activity: '', heartbeat_at: null
    }
    board.steps.push(step)
    touched.add(stepId)
    return step
  }
  const addNote = (t: GovTask, stepId: string, author: string, kind: NoteKind, body: string) => {
    const note: GovTaskNote = { note_id: nextId('NTE-', board.notes.map(n => n.note_id)), task_id: t.task_id, step_id: stepId, author_id: author, kind, body, created_at: now }
    board.notes.push(note)
    inserted.push(note)
    return note
  }
  const touchTask = (t: GovTask, fields: Partial<GovTask>) => Object.assign(t, fields, { updated_by: by, updated_at: now })
  const touchStep = (x: GovTaskStep, fields: Partial<GovTaskStep>) => {
    Object.assign(x, fields, { updated_at: now })
    touched.add(x.step_id)
  }
  // Only the lease owner writes its step (Card 9); an acked step is finished. A lease past lease_expires_at
  // (blank counts as expired) no longer lets its owner write: it claims the step again.
  const expired = (x: GovTaskStep) => blank(x.lease_expires_at) || new Date(s(x.lease_expires_at)).getTime() < nowMs
  const leased = (x: GovTaskStep | null) => !x ? `no step ${a.step_id}`
    : x.lease_owner !== leaseOwner ? `lease is not held by ${caller}`
      : x.cancelled === true ? 'step cancelled; the board cancelled it when the card moved or was reassigned'
        : !blank(x.acked_at) ? 'step already acked'
        : expired(x) ? 'lease expired; claim the step again'
          : !same(x.updated_at, a.updated_at) ? 'stale' : ''

  const assigneeFor = (who: string, r: ColumnRole): string => roleAssignee(who, r, board.registry)
  // Start gives an unassigned card to the default runner when it is an active agent; a card with an assignee keeps it.
  const startWho = (t: GovTask): string => {
    const id = defaultRunner()
    return blank(t.assignee) && id !== '' && board.registry.some(r => r.agent_id === id && r.lifecycle_status === 'active') ? id : t.assignee
  }
  const nextStepNo = (id: string) => stepsOf(id).reduce((x, y) => Math.max(x, y.step_no || 0), 0) + 1
  // The board cancels a step when the card moves, is reassigned or is restarted; the old owner's next write is refused.
  const cancelStep = (t: GovTask, x: GovTaskStep, why: string) => {
    touchStep(x, { cancelled: true })
    addNote(t, x.step_id, caller, 'status', `Step ${x.step_id} (${x.role || 'step'}, ${x.assignee || 'unassigned'}, ${x.step_state}) cancelled: ${why}.`)
  }
  // A failed build step is retried once on its own (hands-off board, phase B). The retry carries the failure in its goal.
  const retryOnce = (t: GovTask) => {
    if (t.stage !== 'build') return
    const last = latest(stepsOf(t.task_id).filter(x => s(x.role) === 'builder'))
    if (!last || last.cancelled === true) return
    const failed = last.step_state === 'failed' || (last.step_state === 'served' && !blank(last.acked_at) && last.verdict !== 'PASS')
    if (!failed || last.goal.startsWith(RETRY_PREFIX)) return
    if (attemptsFor(stepsOf(t.task_id), 'builder') >= loopBudget(splitList(t.tags))) return
    const reason = s(last.stop_reason) || s(last.verdict) || 'no reason given'
    const no = nextStepNo(t.task_id)
    newStep(t, no, 'builder', last.assignee, `${RETRY_PREFIX} ${last.goal} (last attempt: ${reason})`.slice(0, 600), last.output_ref, s(last.target_action))
    touchTask(t, { current_step: no, steps_total: Math.max(t.steps_total || 0, no) })
    addNote(t, last.step_id, orchestratorId(), 'status', `Retrying once: ${last.step_id} ended ${last.step_state} (${reason}).`)
  }

  // Cards this op created or promoted besides the one it named (split children, children released by a Done parent).
  const alsoTasks: GovTask[] = []
  const alsoSteps: GovTaskStep[] = []
  const alsoNotes: GovTaskNote[] = []

  // A card waits in Backlog while its parent is not Done. A parent not on the board does not hold it.
  const waitingOn = (c: GovTask): string => {
    const pid = parentOf(c)
    const p = pid ? taskOf(pid) : null
    return p && p.work_state !== 'done' && p.stage !== 'done' ? `${c.task_id} waits in Backlog for its parent ${pid} to be done` : ''
  }
  // The parent just reached Done: each waiting child starts, exactly as Start would (rule 12), so it gets a builder step.
  const promoteChildren = (parent: GovTask) => {
    for (const c of board.tasks.filter(x => parentOf(x) === parent.task_id && blank(x.archived_at) && x.work_state === 'backlog' && (s(x.stage) || 'backlog') === 'backlog')) {
      const r = planBoard(board, 'start_task', { task_id: c.task_id, updated_at: c.updated_at }, orchestratorId(), nowMs)
      if (typeof r === 'string') {
        const n = addNote(c, '', orchestratorId(), 'status', `Parent ${parent.task_id} is done but ${c.task_id} could not start: ${r}.`.slice(0, NOTE_CAP))
        alsoNotes.push(n)
        inserted.splice(inserted.indexOf(n), 1)
        continue
      }
      alsoTasks.push(...(r.tasks ?? []))
      alsoSteps.push(...(r.steps ?? []))
      alsoNotes.push(...(r.notes ?? []))
      const own = addNote(c, '', orchestratorId(), 'status', `Parent ${parent.task_id} is done, so ${c.task_id} was promoted from Backlog to Build.`)
      alsoNotes.push(own)
      inserted.splice(inserted.indexOf(own), 1)
    }
  }

  const answer = (): WriteRows => {
    const t = taskOf(taskId)
    if (rollup && t) retryOnce(t)
    if (t && t.work_state === 'done' && (op === 'move_task' || op === 'done_no_steps')) promoteChildren(t)
    if (rollup && t) {
      const m = stagedMove(t, stepsOf(t.task_id), board)
      if (m) Object.assign(t, m, { updated_by: `${orchestratorId()} (board rollup)`, updated_at: now })
    }
    // Board Response returns the step named in step_id too, changed or not (the answered step on reply).
    if (a.step_id) touched.add(a.step_id)
    return {
      tasks: [...(t ? [clone(t)] : []), ...alsoTasks.map(clone)],
      steps: [...board.steps.filter(x => touched.has(x.step_id)).map(clone), ...alsoSteps],
      notes: [...inserted.map(clone), ...alsoNotes]
    }
  }

  // create_task's field checks, shared with update_task.
  const fieldRefusal = (f: Record<string, string>): string => {
    if (!blank(f.task_type) && !['operational', 'build'].includes(f.task_type!)) return `task_type ${f.task_type} is not operational or build (an upgrade goes through the orchestrator)`
    if (s(f.tags).split(',').map(x => x.trim()).filter(Boolean).some(x => !/^[a-z0-9_-]+$/.test(x))) return 'tags must be lowercase slugs'
    if (!blank(f.board_id) && !/^[a-z0-9_-]+$/.test(f.board_id!)) return 'board_id must be a lowercase slug'
    if (s(f.title).length > 200) return 'title is over 200 characters'
    if (!blank(f.due_at) && Number.isNaN(Date.parse(f.due_at!))) return `due_at ${f.due_at} is not a date`
    const parents = s(f.tags).split(',').map(x => x.trim()).filter(x => x.startsWith(PARENT_PREFIX))
    if (parents.length > 1) return 'a card names one parent'
    if (parents.length) {
      const pid = parents[0]!.slice(PARENT_PREFIX.length).toUpperCase()
      if (!/^TSK-\d+$/.test(pid)) return `${parents[0]} is not a parent tag like parent-tsk-<number>`
      if (pid === s(f.task_id)) return 'a card cannot be its own parent'
      if (!taskOf(pid)) return `parent ${pid} is not on the board`
    }
    return ''
  }
  const tagList = (v: unknown) => s(v).split(',').map(x => x.trim()).filter(Boolean).join(',')
  // An agent's card goes to the orchestrator at once, as a chat step with the hand-off note as its input.
  const handoff = (task: GovTask, ctx: HandOffContext) => {
    const lines = [`Hand-off from ${caller}.`, ...CONTEXT_KEYS.filter(k => !blank(ctx[k])).map(k => `${k}: ${ctx[k]}`)]
    const note = addNote(task, '', caller, 'comment', lines.join('\n').slice(0, NOTE_CAP))
    const step = newStep(task, nextStepNo(task.task_id), CHAT_ROLE, orchestratorId(), `Triage hand-off from ${caller} on ${task.task_id}: ${task.title}`, note.note_id, 'read')
    note.step_id = step.step_id
  }

  if (op === 'create_task') {
    const type = a.task_type || 'build'
    const approval = a.approval_state || 'not_required'
    if (!['not_required', 'pending'].includes(approval)) return `approval_state ${approval} is not not_required or pending`
    const bad = fieldRefusal(a)
    if (bad) return bad
    const tags = tagList(a.tags).split(',').filter(Boolean)
    const isAgent = caller !== boardOwner()
    if (!isAgent && !blank(a.context)) return 'context is for agent callers'
    const ctx = readContext(a.context)
    if (typeof ctx === 'string') return ctx
    if (ctx.classification && !tags.some(x => x.startsWith('class-'))) tags.push(`class-${ctx.classification}`)
    const task: GovTask = {
      ...blankTask(nextId('TSK-', board.tasks.map(t => t.task_id)), a.title!, caller, now, by),
      original_request: a.original_request || a.title!, acceptance_requirements: s(a.acceptance_requirements), task_type: type as GovTask['task_type'],
      approval_state: approval as GovTask['approval_state'], priority: a.priority || 'normal', project_id: s(a.project_id), board_id: s(a.board_id),
      due_at: blank(a.due_at) ? null : s(a.due_at), tags: tags.join(',')
    }
    board.tasks.unshift(task)
    taskId = task.task_id
    if (isAgent) handoff(task, ctx)
    return answer()
  }

  if (op === 'handoff_step') {
    // Path B: the card already exists (made in n8n by the agent's create_task); only the hand-off note and chat step are written here.
    const t = taskOf(a.task_id!)
    if (!t) return `no task ${a.task_id}`
    if (caller === boardOwner()) return 'handoff_step is for the agent that filed the card'
    const ctx = readContext(a.context)
    if (typeof ctx === 'string') return ctx
    if (stepsOf(t.task_id).some(x => x.role === CHAT_ROLE && x.assignee === orchestratorId() && isOpen(x))) return `${t.task_id} already has the orchestrator's hand-off step`
    handoff(t, ctx)
    return answer()
  }

  if (op === 'apply_rollup') {
    // The drain's write: only ROLLUP_FIELDS, only the ones sent, no updated_at guard.
    const t = taskOf(a.task_id!)
    if (!t) return `no task ${a.task_id}`
    const fields: Partial<GovTask> = {}
    for (const k of ROLLUP_FIELDS) {
      if (!(k in a)) continue
      const v = s(a[k]).trim()
      if (k === 'current_step' || k === 'steps_total' || k === 'retry_cap') {
        if (v !== '' && !/^\d+$/.test(v)) return `${k} must be a whole number`
        Object.assign(fields, { [k]: v === '' ? null : Number(v) })
      } else if (k === 'archived_at') {
        if (v !== '' && Number.isNaN(Date.parse(v))) return `archived_at ${v} is not a date`
        fields.archived_at = v === '' ? null : new Date(v).toISOString()
      } else if (k === 'stage' && !STAGES.includes(v as Stage)) return `stage ${v} is not one of ${STAGES.join(', ')}`
      else Object.assign(fields, { [k]: v })
    }
    if (!Object.keys(fields).length) return `${t.task_id} has no changes`
    const who = s(fields.updated_by) || `${orchestratorId()} (board rollup)`
    delete fields.updated_by
    Object.assign(t, fields, { updated_by: who, updated_at: now })
    return answer()
  }

  if (['assign', 'move_task', 'start_task', 'send_back', 'publish_task', 'approve_task', 'done_no_steps', 'update_task', 'archive_task', 'pin_task', 'unpin_task', 'reopen_task', 'split_task'].includes(op)) {
    const t = taskOf(a.task_id!)
    if (!t) return `no task ${a.task_id}`
    if (!same(t.updated_at, a.updated_at)) return 'stale'
    if (!blank(t.archived_at)) return `${t.task_id} is archived`

    if (op === 'split_task') {
      if (t.work_state === 'done') return `${t.task_id} is done`
      if (caller !== boardOwner()) {
        const held = stepsOf(t.task_id).find(x => isOpen(x) && s(x.role) === 'architect' && x.assignee === caller && x.lease_owner === leaseOwner)
        if (!held) return `${caller} does not hold an open architect step on ${t.task_id}`
      }
      let kids: unknown
      try { kids = JSON.parse(s(a.children)) } catch { return 'children must be a JSON list' }
      if (!Array.isArray(kids) || kids.length < 1 || kids.length > 10) return 'children must list 1 to 10 cards'
      const specs: { title: string, acceptance_requirements: string }[] = []
      for (const k of kids) {
        const title = k && typeof k === 'object' ? s((k as Record<string, unknown>).title).trim() : ''
        if (!title) return 'each child needs a title'
        if (title.length > 200) return 'title is over 200 characters'
        specs.push({ title, acceptance_requirements: s((k as Record<string, unknown>).acceptance_requirements).trim() })
      }
      // A child inherits the parent's class tags, project, board and priority, and names the parent in a tag.
      const inherit = splitList(t.tags).filter(x => x.startsWith('class-'))
      const made = specs.map((k) => {
        const child: GovTask = {
          ...blankTask(nextId('TSK-', board.tasks.map(x => x.task_id)), k.title, caller, now, by),
          acceptance_requirements: k.acceptance_requirements, priority: t.priority, project_id: s(t.project_id), board_id: s(t.board_id),
          tags: [...inherit, PARENT_PREFIX + t.task_id.toLowerCase()].join(',')
        }
        board.tasks.unshift(child)
        return child
      })
      alsoTasks.push(...made)
      addNote(t, '', caller, 'status', `Split into ${made.map(c => c.task_id).join(', ')}. Each waits in Backlog until ${t.task_id} is done.`)
      touchTask(t, {})
      return answer()
    }

    if (op === 'update_task') {
      // original_request is never edited after creation (schema/tables.json), so it isn't in the op table.
      if (t.work_state === 'done') return `${t.task_id} is done`
      const bad = fieldRefusal(a)
      if (bad) return bad
      if ('title' in a && s(a.title).trim() === '') return 'title is blank'
      const fields: Partial<GovTask> = {}
      for (const k of TASK_FIELDS) {
        if (!(k in a)) continue
        const v = k === 'tags' ? tagList(a[k]) : s(a[k]).trim()
        const next = k === 'due_at' ? (blank(v) ? null : v) : v
        if (s(t[k]) !== s(next)) Object.assign(fields, { [k]: next })
      }
      if (!Object.keys(fields).length) return `${t.task_id} has no changes`
      touchTask(t, fields)
      return answer()
    }
    if (op === 'reopen_task') {
      // The same checks and reasons as plan_board.js. It writes the card only;
      // The orchestrator's pickup opens the retry under the higher cap. No board_events table here (the gateway writes that row).
      if (board.board_async !== true) return 'board.async is off, so the orchestrator is not retrying cards; use Start to restart the card by hand'
      if (t.work_state !== 'needs_input') return `${t.task_id} is ${t.work_state || 'blank'}, not needs_input; only an escalated card is reopened`
      if (!['build', 'review'].includes(s(t.stage))) return `${t.task_id} is in ${s(t.stage) || 'no stage'}; reopen is for a Build or Review card`
      if (t.approval_state === 'approved') return `${t.task_id} is already approved to ship`
      const live = stepsOf(t.task_id).filter(x => x.cancelled !== true)
      const planR = latest(live.filter(x => s(x.role) === 'architect'))
      if (!planR || planR.step_state !== 'verified') return `${t.task_id} has no approved plan`
      const B = latest(live.filter(x => s(x.role) === 'builder'))
      const A = B ? latest(live.filter(x => s(x.role) === 'auditor' && (x.step_no || 0) > (B.step_no || 0))) : null
      const cur = A ?? B
      const failedRetry = !!cur && (cur.step_state === 'failed' || (s(cur.role) === 'auditor' && cur.step_state === 'served' && cur.verdict === 'FAIL'))
      if (!failedRetry) return `${t.task_id} was not escalated at the retry cap${cur ? ` (${cur.step_id} is ${cur.step_state}${cur.verdict ? ' ' + cur.verdict : ''})` : ''}; answer its question instead`
      if (!/^\d+$/.test(s(a.retry_cap).trim())) return `retry_cap ${s(a.retry_cap)} is not a whole number`
      const capNew = Number(s(a.retry_cap).trim())
      const count = Number(t.retry_count) || 0
      const capOld = t.retry_cap == null ? 2 : Number(t.retry_cap)
      if (capNew <= count) return `retry_cap ${capNew} is not above retry_count ${count}; the orchestrator would escalate again`
      if (capNew > 10) return `retry_cap ${capNew} is over 10`
      touchTask(t, { stage: 'build', work_state: 'awaiting_start', retry_cap: capNew, escalation: 'none' })
      addNote(t, cur!.step_id, caller, 'status', `Reopened by ${boardOwnerName()}: retry_cap ${capOld} -> ${capNew} (${count} retries used). Back to Build; the orchestrator retries ${cur!.step_id} on its next pickup.`)
      return answer()
    }
    if (op === 'archive_task') {
      // Cleanup (Done's cleanup role): the card leaves the board, its rows stay in the tables.
      if (t.work_state !== 'done') return `${t.task_id} is not done; only Done cards are archived`
      if (!blank(t.pinned_at)) return `${t.task_id} is pinned`
      touchTask(t, { archived_at: now })
      addNote(t, '', caller, 'status', `Archived from Done. Summary: ${t.title} · ${s(t.internal_verification)} · ${s(t.macro_verification)}`)
      return answer()
    }
    if (op === 'pin_task' || op === 'unpin_task') {
      const pin = op === 'pin_task'
      if (pin === !blank(t.pinned_at)) return `${t.task_id} is already ${pin ? 'pinned' : 'not pinned'}`
      touchTask(t, { pinned_at: pin ? now : null })
      addNote(t, '', caller, 'status', pin ? 'Pinned. Cleanup skips this card and it stays first in its column.' : 'Unpinned.')
      return answer()
    }

    if (op === 'assign') {
      if (t.work_state === 'done') return `${t.task_id} is done`
      // A blank assignee unassigns the card; assignment never starts work (rule 8), so nothing else changes.
      const who = s(a.assignee)
      const active = board.registry.some(r => r.agent_id === who && r.lifecycle_status === 'active')
      if (who !== '' && !/^person:[a-z0-9_-]+$/.test(who) && !(/^agt-[a-z0-9-]+$/.test(who) && active)) return `assignee ${who} is not an active agent or person:<name>`
      if (who === t.assignee) return who === '' ? `${t.task_id} is already unassigned` : `${t.task_id} is already assigned to ${who}`
      touchTask(t, { assignee: who })
      const before = new Set(stepsOf(t.task_id).map(x => x.step_id))
      // Reassigning a running card hands its open steps to the new agent: cancel the old step, add one for the same role.
      const column = ['architecture', 'build'].includes(s(t.stage)) ? board.columns.find(c => c.view === 'stages' && c.match === `stage=${s(t.stage)}`) : undefined
      for (const r of columnRoles(column)) {
        const open = stepsOf(t.task_id).find(x => s(x.role) === r.role && isOpen(x))
        if (!open) continue
        const next = assigneeFor(who, r)
        if (next === open.assignee) continue
        cancelStep(t, open, `card reassigned to ${who || 'nobody'}`)
        const no = nextStepNo(t.task_id)
        newStep(t, no, r.role, next, open.goal, open.input_ref, s(open.target_action))
        touchTask(t, { current_step: no, steps_total: Math.max(t.steps_total || 0, no), work_state: 'awaiting_start' })
        rollup = true
      }
      // Any other pending step (waiting, not yet running) still held by a different agent goes too, so the new
      // agent isn't blocked behind it. Running steps, chat steps and steps already on the new agent are kept.
      const newType = s(board.registry.find(r => r.agent_id === who)?.agent_type)
      for (const x of stepsOf(t.task_id)) {
        if (!before.has(x.step_id) || !isOpen(x) || s(x.role) === CHAT_ROLE || !['awaiting_pull', 'awaiting_start'].includes(x.step_state)) continue
        if (x.assignee === who || (isPool(x.assignee) && newType !== '' && poolType(x.assignee) === newType)) continue
        cancelStep(t, x, `card reassigned to ${who || 'nobody'}`)
        rollup = true
      }
      return answer()
    }
    if (op === 'approve_task') {
      if (t.approval_state !== 'pending') return `approval_state is ${t.approval_state || 'blank'}, not pending`
      touchTask(t, { approval_state: 'approved' })
      return answer()
    }
    if (op === 'done_no_steps') {
      if (t.work_state === 'done' || t.stage === 'done') return `${t.task_id} is already done`
      // An answered message (an acked chat step) doesn't hold the card, and neither does a
      // finished step (amendment): see holdsCardOut.
      const mine = stepsOf(t.task_id)
      const live = mine.filter(holdsCardOut)
      if (live.length) return `${t.task_id} has ${live.length} step(s) that are not cancelled; move it to Done instead`
      touchTask(t, { stage: 'done', work_state: 'done', internal_verification: `pass manual:${boardOwner()}`, macro_verification: `pass ${boardOwner()}`, approval_state: approvedIfPending(t) })
      // Finished steps stay in the record. One status note says the pass is the owner's word, not a verification.
      const kept = mine.filter(x => x.cancelled !== true && x.role !== CHAT_ROLE && !blank(x.acked_at))
      if (kept.length) addNote(t, '', caller, 'status', `Closed on ${boardOwnerName()}'s word (manual pass), not by a verification. Finished steps kept: ${kept.map(x => `${x.step_id} ${s(x.role)} ${s(x.step_state)}`).join(', ')}.`.slice(0, NOTE_CAP))
      return answer()
    }

    // move_task (sections 4 and 7), plus start_task and send_back. A move no longer waits on an open step of the
    // column it leaves: the board cancels it (hands-off board, phase A). The unapproved-plan gate below still holds.
    const from = s(t.stage)
    const here = from || (t.work_state === 'backlog' ? 'backlog' : '')
    if (here === 'backlog' && (op === 'start_task' || op === 'move_task')) {
      const wait = waitingOn(t)
      if (wait) return wait
    }
    if (op === 'send_back' && here !== 'review') return `${t.task_id} is not in Review; only a Review card can be sent back`
    if (op === 'publish_task' && here !== 'review') return `${t.task_id} is not in Review; only a Review card can be published`
    if (op === 'publish_task' && !/^pass/.test(s(t.internal_verification))) return `${t.task_id} has no passed verification; publish after the build passes`
    if (op === 'start_task' && here !== 'backlog' && here !== 'build') return `${t.task_id} is in ${here || 'no stage'}; Start is for Backlog and Build cards`
    if (op === 'start_task' && here === 'build') {
      // Restart: a fresh builder step when the last one failed, was cancelled or ended asking something.
      const last = latest(stepsOf(t.task_id).filter(x => s(x.role) === 'builder'))
      if (last && isOpen(last) && ['awaiting_pull', 'awaiting_start', 'dispatched'].includes(last.step_state)) return `${t.task_id} is already running (${last.step_id} is ${last.step_state})`
      const role = columnRoles(board.columns.find(c => c.view === 'stages' && c.match === 'stage=build')).find(r => r.role === 'builder')
      if (!role) return 'board_columns has no builder role for build'
      if (last && isOpen(last)) cancelStep(t, last, 'card restarted')
      const no = nextStepNo(t.task_id)
      const who = startWho(t)
      newStep(t, no, 'builder', assigneeFor(who, role), last?.goal ?? `builder: ${t.title}`, last?.output_ref ?? '', s(role.action))
      touchTask(t, { assignee: who, work_state: 'awaiting_start', current_step: no, steps_total: Math.max(t.steps_total || 0, no) })
      rollup = true
      return answer()
    }
    const to = (op === 'start_task' || op === 'send_back' || op === 'publish_task' ? 'build' : a.stage) as Stage
    if (!STAGES.includes(to)) return `stage ${to} is not one of ${STAGES.join(', ')}`
    if (to === from) return `${t.task_id} is already in ${to}`
    if (from === 'done' || t.work_state === 'done') return `${t.task_id} is done; Done is terminal`
    const leaving = columnRoles(board.columns.find(c => c.view === 'stages' && c.match === `stage=${from}`))
    const toCancel = stepsOf(t.task_id).filter(x => isOpen(x) && leaving.some(r => r.role === s(x.role)))
    // A card leaves Architecture only with an approved plan: its current architect step, if acked
    // served with PASS, must be verified first. A served step that isn't PASS doesn't hold it (the rollup blocks it).
    if (from === 'architecture') {
      const plan = latest(stepsOf(t.task_id).filter(x => s(x.role) === 'architect' && x.cancelled !== true))
      if (plan && !blank(plan.acked_at) && plan.step_state === 'served' && plan.verdict === 'PASS') {
        return `${t.task_id} has an unapproved plan ${plan.step_id}; approve it before moving the card`
      }
    }
    const m: Partial<GovTask> = { stage: to }
    if (to === 'done') {
      if (!/^pass/.test(s(t.internal_verification))) return `Done needs internal_verification pass (schema rule 8); it is ${s(t.internal_verification) || 'blank'}`
      Object.assign(m, { work_state: 'done', macro_verification: `pass ${boardOwner()}`, approval_state: approvedIfPending(t) })
    } else if (to === 'backlog') m.work_state = 'backlog'
    else if (to === 'review') m.work_state = 'verifying'
    else {
      const column = board.columns.find(c => c.view === 'stages' && c.match === `stage=${to}`)
      if (!column) return `board_columns has no stages row for ${to}`
      const req = columnRoles(column).filter(r => r.required === true)
      const mine = stepsOf(t.task_id)
      let no = mine.reduce((x, y) => Math.max(x, y.step_no || 0), 0)
      for (const r of req) {
        if (mine.some(x => s(x.role) === r.role && isOpen(x))) return `${t.task_id} already has an active ${r.role} step`
      }
      const prior = latest(mine.filter(x => ['served', 'verified'].includes(x.step_state) && x.cancelled !== true))
      // Send back: The owner's line goes in the thread and into the new step's goal, so the agent reads it first.
      const sent = op === 'send_back' ? addNote(t, '', caller, 'comment', a.body!) : null
      const publish = op === 'publish_task'
      if (publish) addNote(t, '', caller, 'status', 'Publish approved: push the branch and open a draft pull request. Merging stays with the owner.')
      // With board.async on, a move_task into Build of a card tagged async, on
      // its approved plan, gives the builder step to pool:runner; the card keeps its assignee. Every other move is unchanged.
      const plan1 = latest(mine.filter(x => s(x.role) === 'architect' && x.cancelled !== true))
      const asyncCard = board.board_async === true && op === 'move_task' && to === 'build' && plan1?.step_state === 'verified' && tagList(t.tags).split(',').includes('async')
      if (asyncCard) addNote(t, '', orchestratorId(), 'status', 'Build goes to the runner pool (board.async is on and the card is tagged async). The orchestrator dispatches it on its next pickup.')
      for (const r of req) {
        no += 1
        const goal = sent ? `${r.role}: ${t.title}. Sent back: ${a.body}` : publish ? `${r.role}: ${t.title}. Publish: push the branch and open a draft pull request (do not merge)` : `${r.role}: ${t.title}`
        newStep(t, no, r.role, asyncCard && r.role === 'builder' ? 'pool:runner' : assigneeFor(op === 'start_task' ? startWho(t) : t.assignee, r), goal.slice(0, 600), sent ? sent.note_id : prior ? prior.output_ref : '', publish && r.role === 'builder' ? 'publish' : s(r.action))
      }
      m.work_state = req.length ? 'awaiting_start' : t.work_state
      if (op === 'start_task' && startWho(t) !== t.assignee) m.assignee = startWho(t)
      if (from === 'review' && to === 'build') m.internal_verification = 'none'
      if (req.length) {
        m.current_step = no
        m.steps_total = Math.max(t.steps_total || 0, no)
      }
      rollup = true
    }
    for (const x of toCancel) cancelStep(t, x, `card moved to ${to}`)
    touchTask(t, m)
    return answer()
  }

  if (op === 'cancel_step') {
    // Finished work stays as the record, and a step under a live lease is left to its agent. An acked
    // needs_input or failed step can be cancelled; the rollup then counts it as failed.
    const st = stepOf(a.step_id!)
    const t = st ? taskOf(st.task_id) : null
    if (!st || !t) return `no step ${a.step_id}`
    taskId = t.task_id
    if (!blank(t.archived_at)) return `${t.task_id} is archived`
    if (st.cancelled === true) return `${st.step_id} is already cancelled`
    if (st.step_state === 'served' || st.step_state === 'verified') return `${st.step_id} is ${st.step_state}; finished steps stay as the record`
    if (st.step_state === 'dispatched' && blank(st.acked_at) && !blank(st.lease_expires_at) && Date.parse(s(st.lease_expires_at)) >= nowMs) {
      return `${st.step_id} is held by ${st.lease_owner || 'an agent'} until ${st.lease_expires_at}; wait for the lease to end`
    }
    if (!same(st.updated_at, a.updated_at)) return 'stale'
    touchStep(st, { cancelled: true })
    addNote(t, st.step_id, caller, 'status', `Step ${st.step_id} (${st.role || 'step'}, ${st.assignee || 'unassigned'}, ${st.step_state}) cancelled by ${boardOwnerName()}.`)
    rollup = t.work_state !== 'done'
    return answer()
  }

  if (op === 'approve_plan') {
    const st = stepOf(a.step_id!)
    const t = st ? taskOf(st.task_id) : null
    if (!st || !t) return `no step ${a.step_id}`
    taskId = t.task_id
    if (t.stage !== 'architecture') return `${t.task_id} is not in Architecture`
    if (st.role !== 'architect') return `${st.step_id} is not an architect step`
    if (st.step_state !== 'served' || st.verdict !== 'PASS' || blank(st.acked_at) || st.cancelled === true) return `${st.step_id} is not acked served with verdict PASS`
    if (!same(st.updated_at, a.updated_at)) return 'stale'
    touchStep(st, { step_state: 'verified' })
    rollup = true
    return answer()
  }

  if (op === 'claim_step') {
    const st = stepOf(a.step_id!)
    if (st) taskId = st.task_id
    const why = claimRefusal(st, a, caller, board, nowMs)
    if (why) return why
    if (!same(st!.updated_at, a.updated_at)) return 'stale'
    touchStep(st!, {
      step_state: 'dispatched', assignee: caller, lease_owner: leaseOwner, lease_expires_at: new Date(nowMs + LEASE_MS).toISOString(),
      dispatched_at: now, last_claimed_at: now, claim_count: st!.claim_count + 1
    })
    rollup = true
    return answer()
  }

  if (['heartbeat', 'update_step', 'complete_step'].includes(op)) {
    const st = stepOf(a.step_id!)
    if (st) taskId = st.task_id
    const why = leased(st)
    if (why) return why
    const step = st!
    if (op === 'heartbeat') {
      const act = a.activity!
      if (act.length > 140) return 'activity is over 140 characters'
      const last = blank(step.heartbeat_at) ? 0 : new Date(s(step.heartbeat_at)).getTime()
      if (act === s(step.activity) && nowMs - last < QUIET_HEARTBEAT_MS) return 'activity unchanged and the last heartbeat is under 5 minutes old'
      touchStep(step, { activity: act, heartbeat_at: now, lease_expires_at: new Date(nowMs + LEASE_MS).toISOString() })
      return answer()
    }
    if (op === 'update_step') {
      // Not an ack: the step stays open and leased. A question the owner can reply to comes from complete_step.
      if (!['needs_input', 'failed'].includes(a.step_state!)) return `update_step sets step_state needs_input or failed, not ${a.step_state}`
      touchStep(step, { step_state: a.step_state as GovTaskStep['step_state'], stop_reason: a.stop_reason! })
      rollup = true
      return answer()
    }
    // complete_step: the pull ack's columns, then the ack note (lib_notes ackNote) and the rollup.
    if (!['served', 'needs_input', 'failed'].includes(a.step_state!)) return `step_state ${a.step_state} is not served, needs_input or failed`
    const chat = step.role === CHAT_ROLE
    if (chat && s(a.output_summary).length > NOTE_CAP) return `output_summary is ${s(a.output_summary).length} characters; a chat answer's cap is 2,000`
    const summary = s(a.output_summary).slice(0, chat ? NOTE_CAP : SUMMARY_CAP)
    const state = a.step_state as GovTaskStep['step_state']
    // ackNote: a note when the ack writes output_summary, or sets needs_input with a stop_reason.
    // A question is stop_reason, then the summary, whichever aren't blank; both blank, no note.
    const asks = state === 'needs_input' && s(a.stop_reason).trim() !== ''
    const kind: NoteKind | '' = summary.trim() === '' && !asks ? ''
      : state === 'needs_input' ? 'question'
        : step.role === 'architect' ? 'proposal'
          : step.role === CHAT_ROLE ? 'comment' // an agent's answer to a message reads as a reply in the thread
            : 'summary'
    const body = state === 'needs_input' ? [s(a.stop_reason), summary].filter(x => x.trim() !== '').join('\n') : summary
    if (kind) {
      const r = noteRefusal(body)
      if (r) return r
    }
    touchStep(step, {
      acked_at: now, ended_at: now, target_ticket_ref: s(a.target_ticket_ref), step_state: state, stop_reason: s(a.stop_reason),
      verdict: s(a.verdict), budget_used: s(a.budget_used), output_ref: s(a.output_ref), output_summary: summary
    })
    const t = taskOf(step.task_id)
    if (kind && t) addNote(t, step.step_id, step.assignee, kind, body)
    rollup = true
    return answer()
  }

  if (op === 'add_note') {
    const t = taskOf(a.task_id!)
    if (!t) return `no task ${a.task_id}`
    const kind = (a.kind || 'comment') as NoteKind
    const kinds: NoteKind[] = NOTE_KINDS.filter(k => k !== 'system')
    if (!kinds.includes(kind)) return `kind ${kind} is not one of ${kinds.join(', ')}`
    const st = blank(a.step_id) ? null : stepOf(a.step_id!)
    if (!blank(a.step_id) && (!st || st.task_id !== t.task_id)) return `step ${a.step_id} is not on ${t.task_id}`
    if (caller !== boardOwner()) {
      if (!st) return 'an agent note names the step it holds'
      if (st.lease_owner !== leaseOwner) return `lease is not held by ${caller}`
      if (expired(st)) return 'lease expired; claim the step again'
    }
    addNote(t, s(a.step_id), caller, kind, a.body!)
    return answer()
  }

  if (op === 'message_agent') {
    // The owner's note, then a chat step for the agent on the card (or the orchestrator), so the message reaches it through the
    // same pull path as any other step. One open chat step per agent per card: a second message joins it.
    const t = taskOf(a.task_id!)
    if (!t) return `no task ${a.task_id}`
    if (!blank(t.archived_at)) return `${t.task_id} is archived`
    // The target is chosen here. A tag in `to` counts only if that agent takes messages; otherwise
    // the usual order applies. Assignment is never touched.
    const to = chatTarget(t, board.steps, board.registry, caller, s(a.to))
    if (!board.registry.some(r => r.agent_id === to && r.lifecycle_status === 'active')) return `${to} is not an active agent`
    const waiting = stepsOf(t.task_id).find(x => x.role === CHAT_ROLE && x.assignee === to && isOpen(x))
    const note = addNote(t, waiting?.step_id ?? '', caller, 'comment', a.body!)
    if (waiting) {
      // The message changes what the agent is answering, so the step's updated_at moves with it. An agent that read the
      // step before the message and acks with that updated_at is now refused "stale" and re-reads the card; without the
      // bump the ack went through and closed the step over a message nobody had answered.
      touchStep(waiting, {})
      return answer()
    }
    const no = stepsOf(t.task_id).reduce((x, y) => Math.max(x, y.step_no || 0), 0) + 1
    const asker = caller === boardOwner() ? boardOwnerName() : caller
    const step = newStep(t, no, CHAT_ROLE, to, `Answer ${asker} on ${t.task_id}: ${t.title}`, note.note_id, 'read')
    note.step_id = step.step_id
    return answer()
  }

  if (op === 'nudge') {
    // Only an open chat step held by an agent that can be woken (the orchestrator today). The primary write moves
    // it awaiting_pull -> awaiting_start, so a second nudge is refused without reading notes. Live, the gateway then runs
    // The orchestrator's board_reply for the step; here the store's simulator plays its answer.
    const st = stepOf(a.step_id!)
    const t = st ? taskOf(st.task_id) : null
    if (!st || !t) return `no step ${a.step_id}`
    taskId = t.task_id
    if (st.role !== CHAT_ROLE) return `${st.step_id} is not a chat step`
    if (st.cancelled === true || !blank(st.acked_at)) return `${st.step_id} is finished; there is nothing to nudge`
    if (!canWake(st.assignee, board.registry)) return `${st.assignee} can't be woken; it answers on its next pull`
    if (st.step_state !== 'awaiting_pull') return `${st.step_id} is already being answered`
    if (!same(st.updated_at, a.updated_at)) return 'stale'
    touchStep(st, { step_state: 'awaiting_start' })
    const name = board.registry.find(r => r.agent_id === st.assignee)?.name ?? st.assignee
    addNote(t, st.step_id, caller, 'status', `Asked ${name} to respond now`)
    return answer()
  }

  if (op === 'reply') {
    // Decision C: The owner's note, then a new step for the same agent and role with input_ref = the note.
    // The answered step stays acked as needs_input.
    const st = stepOf(a.step_id!)
    const t = st ? taskOf(st.task_id) : null
    if (!st || !t) return `no step ${a.step_id}`
    taskId = t.task_id
    if (t.work_state === 'done') return `${t.task_id} is done`
    if (st.step_state !== 'needs_input' || blank(st.acked_at)) return `${st.step_id} is not acked as needs_input`
    const sameRole = stepsOf(t.task_id).filter(x => s(x.role) === s(st.role) && x.cancelled !== true)
    if (st.cancelled === true || latest(sameRole)?.step_id !== st.step_id) return `${st.step_id} is not the card's active ${s(st.role) || 'step'} step`
    if (!same(st.updated_at, a.updated_at)) return 'stale'
    const no = stepsOf(t.task_id).reduce((x, y) => Math.max(x, y.step_no || 0), 0) + 1
    const note = addNote(t, st.step_id, caller, 'comment', a.body!)
    touchTask(t, { current_step: no, steps_total: Math.max(t.steps_total || 0, no) })
    newStep(t, no, s(st.role), st.assignee, st.goal, note.note_id, st.target_action)
    rollup = true
    return answer()
  }

  return `board op ${op} has no plan`
}

/** lib_claim's claimDecision, as a refusal reason ('' when the claim may go ahead). */
function claimRefusal(r: GovTaskStep | null, a: Record<string, string>, caller: string, board: Board, nowMs: number): string {
  const pool = !!r && isPool(r.assignee)
  const type = pool ? poolType(r!.assignee) : ''
  const agent = pool ? board.registry.find(x => x.agent_id === caller) : undefined
  // Fixtures have no gov_access rows, so the board:role:<role> check that #121 also makes is left out here.
  const assigneeOk = pool ? !!agent && s(agent.agent_type) === type && !blank(r!.role) : !!r && r.assignee === caller
  const base = !!r && !blank(a.claim_key) && r.claim_key === a.claim_key && assigneeOk && r.cancelled !== true && blank(r.acked_at)
  if (base && claimableNow(r!, nowMs)) return ''
  if (!r) return `no step ${a.step_id}`
  if (pool && !agent) return `assignee ${caller} is not in gov_registry`
  if (pool && s(agent!.agent_type) !== type) return `agent_type of ${caller} is "${s(agent!.agent_type)}", not ${type} (${r.assignee})`
  if (pool && blank(r.role)) return `pool step ${r.step_id} has no role`
  if (!pool && r.assignee !== caller) return `assignee ${caller} does not match the step`
  if (blank(a.claim_key) || r.claim_key !== a.claim_key) return 'claim_key does not match'
  if (r.cancelled === true) return 'step is cancelled'
  if (!blank(r.acked_at)) return 'step already acked'
  if (r.step_state === 'dispatched') return `lease held by ${r.lease_owner} until ${r.lease_expires_at}`
  return `step_state ${r.step_state} is not claimable`
}
