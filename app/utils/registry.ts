// Registry rules as plain functions: grades, signals, card flags, lifecycle gates, change paths and rehearsals.
// The rules come from the spec's "Design rules" and "Signals the UI computes" sections.
import type { AccessRow, ContainerChecks, FlagKind, Grade, LiveConfig, Lifecycle, RegistryRow, ReviewRow, Severity } from '~/types/registry'
import { boardOwnerName } from '~/types/board'
import { FIELD_LABELS, FLAG_ORDER, GRADES, LIFECYCLE_LABELS } from '~/types/registry'

// ---------- Dates ----------

const dayFmt = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

/** Parses "2026-10-17" as a local date (not UTC midnight, which shows the day before in Central time). */
function parse(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value)
}

/** 10/17/2026. Blank stays blank. */
export function day(value: string | null | undefined): string {
  return value ? dayFmt.format(parse(value)) : ''
}

/** 10/25/2026, 9:05 AM, or just the date for date-only values. */
export function dayTime(value: string | null | undefined): string {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return day(value)
  const d = parse(value)
  return `${dayFmt.format(d)}, ${timeFmt.format(d)}`
}

export function daysSince(value: string, now = new Date()): number {
  return Math.floor((now.getTime() - parse(value).getTime()) / 86_400_000)
}

/** Decision 5: a review is stale after 90 days; blank means never reviewed. */
export const STALE_DAYS = 90

// ---------- Grades ----------

export function parseGrades(row: RegistryRow): Record<string, string> {
  try {
    const parsed = JSON.parse(row.fact_grades || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  }
  catch {
    return {}
  }
}

/**
 * The grade for one field. `deploy_state` grades the deployment fields; `fact_grades` names the rest
 * (values like "verified (config)" count as their first word). A blank field is always unknown.
 */
export function gradeOf(row: RegistryRow, field: string): Grade {
  if (!row[field]) return 'unknown'
  if (field === 'deploy_state') return row.deploy_state || 'unknown'
  if (['deploy_ref', 'deploy_verified_at', 'deploy_evidence'].includes(field)) return row.deploy_state || 'unknown'
  const grades = parseGrades(row)
  const raw = String(grades[field] ?? grades.all ?? '').split(/[\s(]/)[0] as Grade
  return GRADES.includes(raw) ? raw : 'declared'
}

// ---------- Signals ----------

export interface AgentSignals {
  gapItems: string[] // what rule 2 is missing on an active agent
  drift: { live: string, expected: string } | null
  notCurrent: number // access rows not verified
  verified: number
  unknownFacts: string[]
  neverReviewed: boolean
  stale: boolean
  awaiting: ReviewRow[] // reviews on this agent waiting for the owner
  upgradeCards: number
  noLiveRead: boolean
}

export interface SignalInputs {
  access: AccessRow[]
  live: LiveConfig | undefined
  reviews: ReviewRow[]
  upgradeCards: number
  unreadableHosts: string[]
}

export function signalsFor(row: RegistryRow, input: SignalInputs, now = new Date()): AgentSignals {
  const verified = input.access.filter(a => a.grade === 'verified').length
  const gapItems: string[] = []
  if (row.lifecycle_status === 'active') {
    if (row.deploy_state !== 'verified') gapItems.push(`deploy ${row.deploy_state || 'unknown'}`)
    if (input.access.length === 0) gapItems.push('no access rows')
    if (!row.log_location) gapItems.push('no log location')
  }
  // Drift: the live active version differs from expected_version, or expected_version is blank on a deployed agent.
  let drift: AgentSignals['drift'] = null
  if (input.live && input.live.active_version !== row.expected_version) {
    drift = { live: input.live.active_version, expected: row.expected_version }
  }
  const grades = parseGrades(row)
  const unknownFacts = Object.entries(grades).filter(([, g]) => String(g).startsWith('unknown')).map(([f]) => f)
  return {
    gapItems,
    drift,
    notCurrent: input.access.length - verified,
    verified,
    unknownFacts,
    neverReviewed: !row.last_reviewed_at,
    stale: !!row.last_reviewed_at && daysSince(row.last_reviewed_at, now) > STALE_DAYS,
    awaiting: input.reviews.filter(r => r.status === 'awaiting_approval'),
    upgradeCards: input.upgradeCards,
    noLiveRead: input.unreadableHosts.includes(row.host)
  }
}

/** The "Agent problems" chip and header count: gap, drift, or access not current. */
export function needsAttention(s: AgentSignals): boolean {
  return s.gapItems.length > 0 || !!s.drift || s.notCurrent > 0
}

export interface Flag {
  kind: FlagKind
  label: string
}

/** Card flags in the spec's order: Gap, Drift, Awaiting you, then the rest. Cards show three and "+N". */
export function flagsFor(s: AgentSignals, requested: boolean): Flag[] {
  const flags: Flag[] = []
  if (s.gapItems.length) flags.push({ kind: 'gap', label: `Gap · ${s.gapItems[0]}` })
  if (s.drift) flags.push({ kind: 'drift', label: `Drift · live ${s.drift.live}` })
  if (requested) flags.push({ kind: 'requested', label: 'Change requested' })
  else if (s.awaiting.length) flags.push({ kind: 'awaiting', label: 'Awaiting you' })
  if (s.upgradeCards) flags.push({ kind: 'upgrade', label: 'Upgrade · Build' })
  if (s.notCurrent) flags.push({ kind: 'access', label: `${s.notCurrent} access not current` })
  if (s.noLiveRead) flags.push({ kind: 'source', label: 'No live read' })
  if (s.unknownFacts.length) flags.push({ kind: 'unknown', label: `${s.unknownFacts.length} unknown facts` })
  return flags.sort((a, b) => FLAG_ORDER.indexOf(a.kind) - FLAG_ORDER.indexOf(b.kind))
}

// ---------- Lifecycle gate (design rule 4) ----------

export interface GateItem {
  label: string
  pass: boolean
  detail: string
  fix: string // the action that clears it, blank when it passes
  fixTab?: 'overview' | 'access' | 'deploy'
}

export function gateItems(row: RegistryRow, to: Lifecycle, accessCount: number, note: string): GateItem[] {
  const owner: GateItem = { label: 'An owner', pass: !!row.owner, detail: row.owner || 'owner is blank', fix: 'Add an owner', fixTab: 'overview' }
  const reason: GateItem = { label: 'A reason', pass: !!note.trim(), detail: note.trim() ? 'Noted below' : 'Add a note below', fix: '' }
  if (to === 'active') {
    return [
      { label: 'Verified deployment', pass: row.deploy_state === 'verified', detail: `deploy_state is ${row.deploy_state || 'blank'}`, fix: 'Verify deployment', fixTab: 'deploy' },
      { label: 'At least one access row', pass: accessCount > 0, detail: `${accessCount} access rows filed`, fix: 'Request access', fixTab: 'access' },
      owner,
      { label: 'A log location', pass: !!row.log_location, detail: row.log_location ? `log_location is ${row.log_location}` : 'log_location is blank', fix: 'Add log location', fixTab: 'overview' }
    ]
  }
  if (to === 'retired') {
    return [
      { label: `Retired by ${boardOwnerName()}`, pass: true, detail: `You are signed in as ${boardOwnerName()}`, fix: '' },
      // R0 has no Ledger retention table to read, so this always fails until R1 wires it.
      { label: 'Ledger retention decision', pass: false, detail: `No retention decision recorded for ${row.agent_id}`, fix: 'Record retention decision' },
      reason
    ]
  }
  if (to === 'paused') return [owner, { ...reason, detail: note.trim() ? 'Noted below' : 'Add a note below: it becomes the Paused reason on the card' }]
  return [owner, { label: "What it's for", pass: !!row.description, detail: row.description ? 'Filed' : 'description is blank', fix: 'Add a description', fixTab: 'overview' }]
}

// ---------- Change requests ----------

export type RequestKind = 'lifecycle' | 'correct_registry' | 'change_access' | 'correct_access' | 'verify_access' | 'register' | 'upgrade'

/** Which existing write path each request goes through (spec "Actions and where they go"). */
export const REQUEST_PATHS: Record<RequestKind, string> = {
  lifecycle: 'form.gov-correct-registry',
  correct_registry: 'form.gov-correct-registry',
  change_access: 'form.gov-change-access',
  correct_access: 'form.gov-correct-access',
  verify_access: 'form.gov-verify-access',
  register: 'form.gov-register-agent',
  upgrade: 'Board card · task_type upgrade'
}

export interface FieldDiff {
  table: 'gov_registry' | 'gov_access'
  row_key: string
  field: string
  old: string
  new: string
}

export interface RequestDraft {
  kind: RequestKind
  agent_id: string
  title: string
  diffs: FieldDiff[]
  newAccess?: AccessRow[]
  newAgent?: RegistryRow
  buildCard?: boolean
  note: string
}

const MATERIAL_ACTIONS = ['send', 'write', 'spend', 'delete', 'approve']

/**
 * Why a change is material (spec screen 6): a new data source, wider scope, send/write/spend/delete/approve,
 * new triggers, cross-domain, new dependencies. Empty means not material.
 */
export function materialReasons(draft: RequestDraft): string[] {
  const reasons = new Set<string>()
  for (const a of draft.newAccess ?? []) {
    reasons.add('New data source')
    if (MATERIAL_ACTIONS.includes(a.action)) reasons.add(`Adds ${a.action}`)
    if (a.cross_domain) reasons.add('Cross-domain')
  }
  for (const d of draft.diffs) {
    if (d.field === 'action' && MATERIAL_ACTIONS.includes(d.new)) reasons.add(`Adds ${d.new}`)
    if (d.field === 'scope') reasons.add('Wider or different scope')
    if (d.field === 'triggers' && d.new.split(',').some(t => t.trim() && !d.old.includes(t.trim()))) reasons.add('New triggers')
    if (d.field === 'depends_on' && d.new.length > d.old.length) reasons.add('New dependencies')
    if (d.field === 'domain' || d.field === 'cross_domain') reasons.add('Cross-domain')
    if (d.field === 'lifecycle_status' && (d.new === 'active' || d.new === 'retired')) reasons.add(`Lifecycle to ${LIFECYCLE_LABELS[d.new as Lifecycle]}`)
  }
  return [...reasons]
}

export function severityFor(draft: RequestDraft): Severity {
  const reasons = materialReasons(draft)
  if (reasons.some(r => r.startsWith('Adds'))) return 'high'
  if (reasons.length) return 'medium'
  return draft.kind === 'register' ? 'info' : 'low'
}

/** The forms' existing check for text that looks like a key or token (design rule 7). */
export function looksLikeSecret(value: string): boolean {
  return /\b(sk-[A-Za-z0-9-_]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/.test(value)
    || /\b[A-Za-z0-9+/_-]{40,}\b/.test(value)
}

export const AGENT_ID_PATTERN = /^agt-[a-z0-9-]+$/

export interface Rehearsal {
  rows: string[] // what the form would write, in plain words
  errors: string[] // validation errors; any error keeps Record off
}

/** The dry run: what the form would write, without writing (design rule 3). */
export function rehearse(draft: RequestDraft, knownIds: string[]): Rehearsal {
  const rows: string[] = []
  const errors: string[] = []
  const path = REQUEST_PATHS[draft.kind]
  const label = (f: string) => FIELD_LABELS[f] ?? f

  if (draft.kind === 'upgrade') {
    rows.push(`gov_tasks: one card "${draft.title}", task_type upgrade, upgrade_target ${draft.agent_id}, stage backlog`)
    rows.push('pol-0004: waits for your approval, then a manual start. Nothing is published to n8n.')
  }
  else {
    const status = draft.kind === 'verify_access' ? 'approved (you supplied the evidence)' : 'awaiting_approval'
    rows.push(`gov_review: one ${draft.kind === 'register' ? 'create' : draft.kind === 'verify_access' ? 'verification' : 'change'} row for ${draft.agent_id}, status ${status}, severity ${severityFor(draft)}`)
  }
  if (draft.newAgent) {
    const a = draft.newAgent
    if (!AGENT_ID_PATTERN.test(a.agent_id)) errors.push(`Agent ID "${a.agent_id}" must match ^agt-[a-z0-9-]+$`)
    if (knownIds.includes(a.agent_id)) errors.push(`Agent ID ${a.agent_id} is already in the registry (IDs are never reused)`)
    if (!a.name) errors.push('Name is required')
    if (!a.owner) errors.push('Owner is required')
    rows.push(`gov_registry: one row ${a.agent_id}, lifecycle ${a.lifecycle_status}, deploy_state declared`)
    rows.push(`gov_history: ${Object.values(a).filter(Boolean).length} field rows (row created)`)
    if (draft.buildCard) rows.push(`gov_tasks: one Build card "Build ${a.name || a.agent_id}" in Backlog (pol-0003: waits for your start)`)
  }
  for (const d of draft.diffs) {
    if (d.old === d.new) continue
    rows.push(`gov_history: ${d.table === 'gov_access' ? d.row_key : ''}${d.table === 'gov_access' ? ' ' : ''}${label(d.field)} "${d.old || 'blank'}" → "${d.new || 'blank'}" (requested)`)
    if (looksLikeSecret(d.new)) errors.push(`${label(d.field)} looks like a key or token. Refer to credentials by name only.`)
  }
  for (const a of draft.newAccess ?? []) {
    rows.push(`gov_access: ${a.resource || '[resource]'} · ${a.action}, grade proposed`)
    if (!a.resource) errors.push('Each access row needs a resource')
    if (['send', 'spend', 'delete', 'approve'].includes(a.action) && a.approval_rule === 'none') errors.push(`${a.action} on ${a.resource || 'a resource'} needs an approval rule`)
    if (looksLikeSecret(a.resource) || looksLikeSecret(a.scope)) errors.push('An access row looks like it holds a key or token. Refer to credentials by name only.')
  }
  if (!draft.diffs.length && !draft.newAccess?.length && !draft.newAgent && draft.kind !== 'upgrade') errors.push('Nothing changed yet')
  if (draft.note && looksLikeSecret(draft.note)) errors.push('The note looks like a key or token.')
  rows.push(`Write path: ${path}`)
  return { rows, errors }
}

// ---------- Small helpers ----------

export function containerSummary(c: ContainerChecks | undefined): string {
  if (!c) return ''
  return `${c.checks.filter(x => x.pass).length}/${c.checks.length} pass`
}

export function splitCsv(value: string | null | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}
