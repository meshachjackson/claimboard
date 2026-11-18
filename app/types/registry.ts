// Registry types, labels, and colors (spec section "Visual system").
// Field names and enum values match ../registry/schema/tables.json exactly.
// This is the only file where Registry labels and colors live, like app/types/board.ts for the board.
import type { PillStyle } from '~/types/board'

// ---------- Enums from schema/tables.json ----------

export const GRADES = ['verified', 'declared', 'proposed', 'unknown'] as const
export type Grade = typeof GRADES[number]

export const LIFECYCLES = ['proposed', 'in_development', 'active', 'paused', 'retired', 'template'] as const
export type Lifecycle = typeof LIFECYCLES[number]

export const DOMAINS = ['personal', 'catalyst', 'infrastructure', 'cross_domain'] as const
export const HOSTS = ['laptop', 'hosted', 'catalyst_cloud'] as const
export const INFERENCES = ['none', 'local', 'cloud'] as const
export const REACHABILITIES = ['addressable', 'outbound_only', 'unreachable_when_asleep'] as const
export const AGENT_TYPES = ['coordinator', 'registrar', 'advisor', 'builder', 'analyst', 'bookkeeper', 'locator', 'template', 'gateway'] as const
export const RUNTIMES = ['n8n_cloud', 'n8n_local', 'chatgpt', 'local_tool', 'local_harness', 'other'] as const
export const ACTIONS = ['read', 'draft', 'write', 'reply', 'send', 'approve', 'delete', 'spend'] as const
export const APPROVAL_RULES = ['none', 'owner_approves', 'president_approves', 'vp_approves'] as const
export const ENFORCEMENT_POINTS = ['tool_list', 'caller_policy', 'mcp_allow_list', 'credential_scope', 'integration_config', 'workflow_structure', 'prompt_only', 'unknown'] as const
export const REVIEW_STATUSES = ['open', 'awaiting_approval', 'approved', 'rejected', 'closed'] as const
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const

export type Severity = typeof SEVERITIES[number]
export type ReviewStatus = typeof REVIEW_STATUSES[number]

// ---------- Rows (every value is a string, like n8n data tables) ----------

/** One gov_registry row: the 44 columns, all strings (blank = not filed yet). */
export interface RegistryRow {
  [field: string]: string
  agent_id: string
  name: string
  lifecycle_status: Lifecycle
  deploy_state: Grade
  description: string
  owner: string
  domain: string
  agent_type: string
  type_version: string
  responsibilities: string
  expected_outputs: string
  exclusions: string
  intended_users: string
  request_types: string
  host: string
  inference: string
  reachability: string
  runtime: string
  environment: string
  deploy_ref: string
  deploy_verified_at: string
  deploy_evidence: string
  impl_version: string
  expected_version: string
  triggers: string
  caller: string
  input_contract: string
  output_contract: string
  interfaces: string
  status_interface: string
  loop_contract_ref: string
  loop_contract_version: string
  depends_on: string
  log_location: string
  memory_location: string
  retention_owner: string
  escalation_owner: string
  incident_contact: string
  correction_path: string
  last_reviewed_at: string
  last_reviewed_by: string
  notes: string
  schema_version: string
  fact_grades: string
}

export interface AccessRow {
  access_id: string
  agent_id: string
  resource: string
  resource_domain: string
  action: string
  scope: string
  environment: string
  sensitivity: string
  approval_rule: string
  enforcement_point: string
  cross_domain: boolean
  grade: Grade
  verified_at: string
  evidence: string
  created_at?: string
  synthetic?: boolean
}

export interface ReviewRow {
  review_id: string
  event_type: string
  agent_id: string
  access_id: string
  ticket_ref: string
  findings: string
  severity: Severity | ''
  remedy: string
  approval_owner: string
  status: ReviewStatus
  decided_by: string
  decided_at: string
  evidence_ref: string
  note: string
  created_at: string
  synthetic?: boolean
}

export interface HistoryRow {
  history_id: string
  table_name: string
  row_key: string
  field: string
  old_value: string
  new_value: string
  changed_by: string
  changed_at: string
  review_id: string
  synthetic?: boolean
}

export interface AssetRow {
  asset_id: string
  asset_type: string
  environment: string
  ref_id: string
  name: string
  agent_id: string
  role: string
  status: string
  destiny: string
}

export interface PolicyRow {
  policy_id: string
  agent_id: string
  task_type: string
  start: string
  requires_approval: boolean
  note: string
}

export interface LiveVersion {
  version_id: string
  published_at: string
  by: string
  active: boolean
  date_only?: boolean
}

/** Live n8n Agent config from the daily drift-loader snapshot. */
export interface LiveConfig {
  model: string
  active_version: string
  tools: string[]
  skills: string[]
  sub_agents: string[]
  channels: string[]
  triggers: string[]
  versions: LiveVersion[]
}

export interface ContainerChecks {
  container: string
  captured_at: string
  checks: { name: string, pass: boolean }[]
  unregistered_flag: boolean
}

export interface Deployed {
  captured_at: string
  sources: { id: string, label: string, ok: boolean, note: string }[]
  agents: Record<string, LiveConfig>
  containers: Record<string, ContainerChecks>
  unregistered: { name: string, environment: string, kind: string, review_id: string, synthetic?: boolean }[]
}

// ---------- Labels ----------

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  proposed: 'Proposed',
  in_development: 'In development',
  active: 'Active',
  paused: 'Paused',
  retired: 'Retired',
  template: 'Reference only'
}

/** Fleet columns. Templates sit in their own shelf, never a column. */
export const FLEET_COLUMNS: { id: Exclude<Lifecycle, 'template'>, name: string, hint: string }[] = [
  { id: 'proposed', name: 'Proposed', hint: 'Ideas · nothing deployed' },
  { id: 'in_development', name: 'In development', hint: 'Being built' },
  { id: 'active', name: 'Active', hint: 'In service' },
  { id: 'paused', name: 'Paused', hint: 'Stopped on purpose' },
  { id: 'retired', name: 'Retired', hint: 'Out of service' }
]

export const DOMAIN_LABELS: Record<string, string> = {
  personal: 'Personal',
  catalyst: 'Catalyst',
  infrastructure: 'Infrastructure',
  cross_domain: 'Cross-domain'
}

export const HOST_LABELS: Record<string, string> = {
  laptop: 'Laptop',
  hosted: 'Hosted',
  catalyst_cloud: 'Catalyst cloud'
}

export const REACH_LABELS: Record<string, string> = {
  addressable: 'Called directly',
  outbound_only: 'Pulls its work',
  unreachable_when_asleep: 'Only while the laptop is awake'
}

/** The derived dispatch line in the plan wizard (spec screen 5, step 4). */
export const DISPATCH_LINES: Record<string, string> = {
  addressable: 'The orchestrator will call it directly.',
  outbound_only: 'The orchestrator will queue work for it to pull.',
  unreachable_when_asleep: 'The orchestrator will queue work; it pulls only while the laptop is awake.'
}

export const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info'
}

export const EVENT_LABELS: Record<string, string> = {
  create: 'Create',
  change: 'Change',
  drift: 'Drift',
  drift_check: 'Drift check',
  approval: 'Approval',
  decision: 'Decision',
  correction: 'Correction',
  audit: 'Audit',
  verification: 'Verification',
  escalation: 'Escalation',
  backup_test: 'Backup test'
}

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  open: 'Open',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  closed: 'Closed'
}

/** The forms' own labels for registry fields (form.gov-register-agent). Fields not listed show their name. */
export const FIELD_LABELS: Record<string, string> = {
  agent_id: 'Agent ID',
  name: 'Name',
  description: "What it's for",
  owner: 'Owner',
  domain: 'Domain',
  agent_type: 'Agent type',
  type_version: 'Version of that kind',
  lifecycle_status: 'Lifecycle',
  responsibilities: 'What it does',
  expected_outputs: 'What it produces',
  exclusions: 'What it must never do',
  intended_users: 'Who uses it',
  request_types: 'Request types',
  host: 'Host',
  inference: 'Model use',
  reachability: 'Can other things call it?',
  runtime: 'Runtime',
  environment: 'Where to find it',
  deploy_ref: 'Deploy reference',
  deploy_state: 'Deploy state',
  deploy_verified_at: 'Deploy verified on',
  deploy_evidence: 'Deploy evidence',
  impl_version: 'Implementation version',
  expected_version: 'Expected version',
  triggers: 'Triggers',
  caller: 'Who calls it',
  input_contract: 'Input contract',
  output_contract: 'Output contract',
  interfaces: 'Interfaces',
  status_interface: 'Status interface',
  loop_contract_ref: 'Loop contract',
  loop_contract_version: 'Loop contract version',
  depends_on: 'Depends on',
  log_location: 'Log location',
  memory_location: 'Memory location',
  retention_owner: 'Retention owner',
  escalation_owner: 'Escalation owner',
  incident_contact: 'Incident contact',
  correction_path: 'Correction path',
  last_reviewed_at: 'Last reviewed',
  last_reviewed_by: 'Reviewed by',
  notes: 'Notes',
  schema_version: 'Schema version',
  fact_grades: 'Fact grades'
}

/** Agent page sections (spec "Data the interface shows"). */
export const SECTIONS: { id: string, title: string, fields: string[] }[] = [
  { id: 'identity', title: 'Identity', fields: ['agent_id', 'name', 'description', 'owner', 'domain', 'agent_type', 'type_version', 'lifecycle_status'] },
  { id: 'purpose', title: 'Purpose', fields: ['responsibilities', 'expected_outputs', 'exclusions', 'intended_users', 'request_types'] },
  { id: 'placement', title: 'Placement', fields: ['host', 'inference', 'reachability', 'runtime', 'environment'] },
  { id: 'deployment', title: 'Deployment', fields: ['deploy_ref', 'deploy_state', 'deploy_verified_at', 'deploy_evidence', 'impl_version', 'expected_version'] },
  { id: 'interfaces', title: 'Interfaces', fields: ['triggers', 'caller', 'input_contract', 'output_contract', 'interfaces', 'status_interface'] },
  { id: 'container', title: 'Loop Container', fields: ['loop_contract_ref', 'loop_contract_version'] },
  { id: 'operations', title: 'Operations', fields: ['depends_on', 'log_location', 'memory_location', 'retention_owner', 'escalation_owner', 'incident_contact', 'correction_path'] },
  { id: 'review', title: 'Review', fields: ['last_reviewed_at', 'last_reviewed_by', 'notes', 'schema_version'] }
]

/** Fields whose values are IDs, versions or enum names: shown in Plex Mono. */
export const MONO_FIELDS = new Set(['agent_id', 'domain', 'agent_type', 'type_version', 'lifecycle_status', 'request_types', 'host', 'inference',
  'reachability', 'runtime', 'deploy_ref', 'deploy_state', 'impl_version', 'expected_version', 'triggers', 'status_interface',
  'loop_contract_version', 'log_location', 'schema_version'])

/** Behavior lives in n8n, not the registry: changing it opens an upgrade card (design rule 5). */
export const BEHAVIOR_FIELDS = ['instructions', 'tools', 'model', 'skills'] as const

// ---------- Colors ----------

export interface BadgeStyle {
  label: string
  bg: string
  fg: string
  border: string // full CSS border value
  mark: string // text mark before the label, so grades never rely on color alone
}

export const GRADE_STYLES: Record<Grade, BadgeStyle> = {
  verified: { label: 'Verified', bg: 'var(--ab-green-bg)', fg: 'var(--ab-green-fg)', border: '1px solid var(--ab-green-bg)', mark: '✓' },
  declared: { label: 'Declared', bg: 'var(--ab-neutral-bg)', fg: 'var(--color-text2)', border: '1px solid var(--ab-neutral-bg)', mark: '' },
  proposed: { label: 'Proposed', bg: 'var(--color-surface)', fg: 'var(--color-text2)', border: '1px dashed var(--color-dash)', mark: '' },
  unknown: { label: 'Unknown', bg: 'var(--color-surface)', fg: 'var(--color-text3)', border: '1px dotted var(--color-dash)', mark: '?' }
}

export const LIFECYCLE_PILLS: Record<Lifecycle, PillStyle> = {
  proposed: { label: 'Proposed', bg: 'var(--color-surface)', fg: 'var(--color-text2)', dot: 'var(--color-dash)', border: '1px dashed var(--color-dash)' },
  in_development: { label: 'In development', bg: 'var(--ab-blue-bg)', fg: 'var(--color-approve)', dot: 'var(--color-accent)', border: '1px solid var(--ab-blue-bg)' },
  active: { label: 'Active', bg: 'var(--ab-green-bg)', fg: 'var(--ab-green-fg)', dot: 'var(--ab-green-dot)', border: '1px solid var(--ab-green-bg)' },
  paused: { label: 'Paused', bg: 'var(--ab-neutral-bg)', fg: 'var(--color-text2)', dot: 'var(--ab-neutral-dot)', border: '1px solid var(--ab-neutral-bg)' },
  retired: { label: 'Retired', bg: 'var(--ab-neutral-bg)', fg: 'var(--color-text3)', dot: 'var(--color-dash)', border: '1px solid var(--ab-neutral-bg)' },
  template: { label: 'Reference only', bg: 'var(--color-chip)', fg: 'var(--color-text3)', dot: 'var(--color-dash)', border: '1px solid var(--color-chip)' }
}

export type FlagKind = 'gap' | 'drift' | 'awaiting' | 'requested' | 'upgrade' | 'access' | 'source' | 'unknown' | 'review'

/** Card flags, in the order the spec asks for: Gap, Drift, Awaiting you, then the rest. */
export const FLAG_STYLES: Record<FlagKind, Omit<BadgeStyle, 'label' | 'mark'>> = {
  gap: { bg: 'var(--color-surface)', fg: 'var(--ab-red-text)', border: '1px solid var(--ab-red-line)' },
  drift: { bg: 'var(--color-surface)', fg: 'var(--ab-red-text)', border: '1px solid var(--ab-red-line)' },
  awaiting: { bg: 'var(--ab-orange-bg)', fg: 'var(--ab-orange-fg)', border: '1px solid var(--ab-orange-bg)' },
  requested: { bg: 'var(--ab-orange-bg)', fg: 'var(--ab-orange-fg)', border: '1px solid var(--ab-orange-bg)' },
  upgrade: { bg: 'var(--ab-blue-bg)', fg: 'var(--color-approve)', border: '1px solid var(--ab-blue-bg)' },
  access: { bg: 'var(--color-surface)', fg: 'var(--color-text2)', border: '1px dashed var(--color-dash)' },
  source: { bg: 'var(--ab-neutral-bg)', fg: 'var(--color-text2)', border: '1px solid var(--ab-neutral-bg)' },
  unknown: { bg: 'var(--color-surface)', fg: 'var(--color-text3)', border: '1px dotted var(--color-dash)' },
  review: { bg: 'var(--color-surface)', fg: 'var(--color-text3)', border: '1px dotted var(--color-dash)' }
}
export const FLAG_ORDER: FlagKind[] = ['gap', 'drift', 'awaiting', 'requested', 'upgrade', 'access', 'source', 'unknown', 'review']

/** Card border and ring when a review on the agent waits for the owner (the board's "Needs you"). */
// Waits on the owner, so it wears the Needs you lamp, the same amber outline and ring as a board card (CARD_LOOKS.needs_input).
export const AWAITING_CARD = { border: 'var(--ab-amber)', shadow: '0 0 0 3px rgba(255,184,28,0.28)' }
export const FLAGGED_CARD_BORDER = 'var(--ab-red-line)'
export const CARD_BORDER = 'var(--color-line)'
export const CARD_SHADOW = '0 1px 0 var(--color-line), 0 6px 12px -8px rgba(15,26,42,0.35)' // the board ticket's lift (.ab-ticket)

export const SEVERITY_STYLES: Record<string, Omit<BadgeStyle, 'mark'>> = {
  critical: { label: 'Critical', bg: 'var(--ab-red)', fg: '#FFFFFF', border: '1px solid var(--ab-red)' },
  high: { label: 'High', bg: 'var(--color-surface)', fg: 'var(--ab-red-text)', border: '1px solid var(--ab-red-line)' },
  medium: { label: 'Medium', bg: 'var(--color-surface)', fg: 'var(--color-text2)', border: '1px solid var(--color-input)' },
  low: { label: 'Low', bg: 'var(--ab-neutral-bg)', fg: 'var(--color-text2)', border: '1px solid var(--ab-neutral-bg)' },
  info: { label: 'Info', bg: 'var(--color-chip)', fg: 'var(--color-text3)', border: '1px solid var(--color-chip)' }
}

/** Fleet "Show" filter column, in order. The first two also sit in the bar as pills. */
export const REGISTRY_SHOW = [
  { id: 'attention', label: 'Agent problems', dot: 'var(--ab-red)', square: true, tone: 'red' },
  { id: 'drift', label: 'Drift', dot: 'var(--ab-red)', square: false, tone: 'red' },
  { id: 'awaiting', label: 'Has a request', dot: 'var(--ab-orange-dot)', square: false, tone: 'orange' },
  { id: 'unregistered', label: 'Unregistered', dot: 'var(--color-dash)', square: false, tone: 'orange' }
] as const
export type RegistryShowId = typeof REGISTRY_SHOW[number]['id']

/** What /api/registry returns (fixtures in R0, gw.gov-registry-read in R1). */
export interface RegistryData {
  generated_at: string
  registry: RegistryRow[]
  access: AccessRow[]
  reviews: ReviewRow[]
  history: HistoryRow[]
  assets: AssetRow[]
  policy: PolicyRow[]
  deployed: Deployed
}

/**
 * Where /api/registry's rows came from. Fixtures allow local requests; the gateway is read only until R2.
 * `file` is a read-only copy of the live tables that scripts/registry-pull.mjs wrote (for when the gateway can't run).
 */
export type RegistrySource = 'fixtures' | 'gateway' | 'file'

// ---------- Agent requests (the reference install's approval path; docs/design/open-source.md) ----------

/** What a person fills in to ask for an agent: name, webhook and basic permissions. */
export interface AgentRequestInput {
  agent_id: string
  name: string
  webhook_url: string
  /** Class slugs the agent may read and take, e.g. ['general']. */
  classes: string[]
}

export interface AgentRequest extends AgentRequestInput {
  request_id: string
  requested_by: string
  status: 'pending' | 'approved' | 'rejected'
  note: string
  created_at: string
  decided_at: string | null
}
