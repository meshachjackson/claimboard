// Registry store. Rows come from GET /api/registry (fixtures, or gw.gov-registry-read in R1).
// The Registry never writes gov_registry or gov_access (design rule 2). In R0 a recorded request becomes a
// local review row awaiting approval, plus history rows, kept in localStorage. Approving one in Approvals
// stands in for form.gov-approve-change. R2 sends the same requests through gw.gov-registry-write.
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type {
  AccessRow, AssetRow, Deployed, HistoryRow, Lifecycle, PolicyRow, RegistryData, RegistryRow, RegistrySource, ReviewRow
} from '~/types/registry'
import { FLEET_COLUMNS } from '~/types/registry'
import { avatarFor, boardOwnerName } from '~/types/board'
import type { AgentSignals, Flag, RequestDraft } from '~/utils/registry'
import { flagsFor, materialReasons, needsAttention, REQUEST_PATHS, severityFor, signalsFor } from '~/utils/registry'

const STORAGE_KEY = 'agent-board:registry-r0:v1'
// Same rule as the board: no timer. Refresh on load, on the button, and on focus after 5 minutes.
const STALE_MS = 5 * 60_000

/** A board card the Registry asked for: an upgrade of a live agent, or a build of a planned one. */
export interface LocalCard {
  task_id: string
  task_type: 'upgrade' | 'build'
  upgrade_target: string
  title: string
  stage: 'backlog'
  created_at: string
}

/** Everything R0 records locally. Base fixture rows are never edited; this sits on top. */
interface Overlay {
  reviews: ReviewRow[]
  history: HistoryRow[]
  access: AccessRow[]
  agents: RegistryRow[]
  cards: LocalCard[]
  decisions: Record<string, { status: 'approved' | 'rejected', note: string, decided_at: string }>
  applied: Record<string, Record<string, string>> // approved registry field changes, by agent_id
  accessApplied: Record<string, Record<string, string>> // approved access corrections and verifications, by access_id
}

const emptyOverlay = (): Overlay => ({ reviews: [], history: [], access: [], agents: [], cards: [], decisions: {}, applied: {}, accessApplied: {} })

export interface AgentView {
  row: RegistryRow
  signals: AgentSignals
  flags: Flag[]
  attention: boolean
  requested: ReviewRow[] // local requests awaiting approval
  avatar: { mono: string, color: string }
}

export const useRegistryStore = defineStore('registry', () => {
  const base = ref<RegistryData | null>(null)
  const source = ref<RegistrySource | null>(null)
  const registration = ref(false) // true on a reference install: agents are requested at /registry/join
  // Live rows are read only until R2 adds gw.gov-registry-write: no local requests on top of real data.
  const readOnly = computed(() => source.value !== 'fixtures')
  const overlay = ref<Overlay>(emptyOverlay())
  const loaded = ref(false)
  const loadError = ref('')
  const updatedAt = ref<string | null>(null)
  const refreshing = ref(false)
  let lastAttempt = 0

  // ---------- Loading ----------

  function restore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      overlay.value = saved ? { ...emptyOverlay(), ...JSON.parse(saved) } : emptyOverlay()
    }
    catch {
      overlay.value = emptyOverlay()
    }
  }

  // `fresh` (the Refresh button) asks the server to skip its 5-minute cache. Load and focus use the cache.
  async function refresh(fresh = false) {
    if (refreshing.value) return
    refreshing.value = true
    lastAttempt = Date.now()
    try {
      const data = await $fetch<RegistryData & { source: RegistrySource, registration?: boolean }>('/api/registry', { query: fresh ? { fresh: '1' } : {} })
      source.value = data.source
      registration.value = data.registration === true
      base.value = data
      if (!loaded.value && data.source === 'fixtures') restore()
      // A pulled copy is as old as its pull, not this fetch, so "updated" shows when registry-pull ran.
      updatedAt.value = data.source === 'file' ? data.generated_at : new Date().toISOString()
      loadError.value = ''
    }
    catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 401 || status === 403) {
        await navigateTo('/login')
        return
      }
      const reason = (err as { data?: { data?: { error?: string } } }).data?.data?.error
      loadError.value = reason ?? (status ? `HTTP ${status}` : 'No response')
    }
    finally {
      loaded.value = true
      refreshing.value = false
    }
  }

  function onFocus() {
    if (document.visibilityState === 'visible' && Date.now() - lastAttempt > STALE_MS) refresh()
  }
  let watching = false
  function startRefreshing() {
    if (watching) return
    watching = true
    if (!loaded.value) refresh()
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
  }
  function stopRefreshing() {
    watching = false
    document.removeEventListener('visibilitychange', onFocus)
    window.removeEventListener('focus', onFocus)
  }

  function reset() {
    try {
      localStorage.removeItem(STORAGE_KEY)
    }
    catch {
      // ignore
    }
    overlay.value = emptyOverlay()
  }

  watch(overlay, () => {
    if (source.value !== 'fixtures') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overlay.value))
    }
    catch {
      // Private mode or full storage: requests last until reload.
    }
  }, { deep: true })

  // ---------- Merged rows ----------

  const deployed = computed<Deployed | null>(() => base.value?.deployed ?? null)
  const assets = computed<AssetRow[]>(() => base.value?.assets ?? [])
  const policy = computed<PolicyRow[]>(() => base.value?.policy ?? [])
  const cards = computed(() => overlay.value.cards)

  function decided(r: ReviewRow): ReviewRow {
    const d = overlay.value.decisions[r.review_id]
    return d ? { ...r, status: d.status, decided_by: boardOwnerName(), decided_at: d.decided_at, note: d.note || r.note } : r
  }

  const reviews = computed<ReviewRow[]>(() => [...(base.value?.reviews ?? []), ...overlay.value.reviews].map(decided)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')))

  const history = computed<HistoryRow[]>(() => [...(base.value?.history ?? []), ...overlay.value.history]
    .sort((a, b) => (b.changed_at || '').localeCompare(a.changed_at || '')))

  const registry = computed<RegistryRow[]>(() => [...(base.value?.registry ?? []), ...overlay.value.agents]
    .map(r => ({ ...r, ...overlay.value.applied[r.agent_id] }) as RegistryRow))

  const access = computed<AccessRow[]>(() => [...(base.value?.access ?? []), ...overlay.value.access]
    .map(a => ({ ...a, ...overlay.value.accessApplied[a.access_id] }) as AccessRow))

  const unreadableHosts = computed(() => (deployed.value?.sources ?? []).filter(s => !s.ok).map(s => s.id))

  function agent(id: string): RegistryRow | undefined {
    return registry.value.find(r => r.agent_id === id)
  }
  function nameOf(id: string): string {
    return agent(id)?.name || id
  }
  function avatarOf(id: string) {
    return avatarFor(id, nameOf(id))
  }
  function accessFor(id: string): AccessRow[] {
    return access.value.filter(a => a.agent_id === id)
  }
  function reviewsFor(id: string): ReviewRow[] {
    return reviews.value.filter(r => r.agent_id === id)
  }
  function historyFor(id: string): HistoryRow[] {
    const accessIds = new Set(accessFor(id).map(a => a.access_id))
    return history.value.filter(h => h.row_key === id || accessIds.has(h.row_key))
  }

  const isLocal = (reviewId: string) => overlay.value.reviews.some(r => r.review_id === reviewId)

  /** Local requests awaiting approval on one agent. */
  function requestsFor(id: string): ReviewRow[] {
    return reviewsFor(id).filter(r => r.status === 'awaiting_approval' && isLocal(r.review_id))
  }

  /** A requested value for a registry field (shown as old struck through, new "requested"). */
  function requestedValue(agentId: string, field: string): HistoryRow | undefined {
    const pending = new Set(reviews.value.filter(r => r.status === 'awaiting_approval').map(r => r.review_id))
    return overlay.value.history.find(h => h.table_name === 'gov_registry' && h.row_key === agentId && h.field === field && pending.has(h.review_id))
  }

  /** An access row with a correction waiting for approval. */
  function accessPending(accessId: string): ReviewRow | undefined {
    return reviews.value.find(r => r.access_id === accessId && r.status === 'awaiting_approval' && isLocal(r.review_id))
  }

  const views = computed<AgentView[]>(() => registry.value.map((row) => {
    const signals = signalsFor(row, {
      access: accessFor(row.agent_id),
      live: deployed.value?.agents[row.agent_id],
      reviews: reviewsFor(row.agent_id),
      upgradeCards: cards.value.filter(c => c.upgrade_target === row.agent_id && c.task_type === 'upgrade').length,
      unreadableHosts: unreadableHosts.value
    })
    // A registration reads "Awaiting you"; any other local request reads "Change requested".
    const requested = requestsFor(row.agent_id).filter(r => r.event_type !== 'create')
    return {
      row,
      signals,
      flags: flagsFor(signals, requested.length > 0),
      attention: needsAttention(signals),
      requested,
      avatar: avatarOf(row.agent_id)
    }
  }))

  function view(id: string): AgentView | undefined {
    return views.value.find(v => v.row.agent_id === id)
  }

  const awaitingApproval = computed(() => reviews.value.filter(r => r.status === 'awaiting_approval'))

  const counts = computed(() => ({
    active: registry.value.filter(r => r.lifecycle_status === 'active').length,
    attention: views.value.filter(v => v.attention).length,
    awaiting: awaitingApproval.value.length,
    drift: views.value.filter(v => v.signals.drift).length,
    unregistered: deployed.value?.unregistered.length ?? 0
  }))

  const columns = FLEET_COLUMNS

  // ---------- Recording (the second, deliberate click after a rehearsal) ----------

  function nextId(prefix: string, start: number, ids: string[]): string {
    const used = ids.map(id => Number(id.slice(prefix.length))).filter(Number.isFinite)
    return `${prefix}${Math.max(start, ...used) + 1}`
  }

  /**
   * Records a rehearsed request: one review row (awaiting approval, or approved for a verification the owner
   * supplied), history rows marked as requested, and any proposed access rows or board card.
   * Local IDs use the 9100nn range so they never collide with live or fixture IDs.
   */
  function record(draft: RequestDraft): string {
    if (readOnly.value) return ''
    const now = new Date().toISOString()
    const reviewId = nextId('rev-', 910000, overlay.value.reviews.map(r => r.review_id))
    const verify = draft.kind === 'verify_access'

    if (draft.kind === 'upgrade') {
      const taskId = nextId('TSK-', 910000, overlay.value.cards.map(c => c.task_id))
      overlay.value.cards.push({ task_id: taskId, task_type: 'upgrade', upgrade_target: draft.agent_id, title: draft.title, stage: 'backlog', created_at: now })
      return taskId
    }

    overlay.value.reviews.push({
      review_id: reviewId,
      event_type: draft.kind === 'register' ? 'create' : verify ? 'verification' : 'change',
      agent_id: draft.agent_id,
      access_id: draft.diffs.find(d => d.table === 'gov_access')?.row_key ?? '',
      ticket_ref: '',
      findings: draft.title,
      severity: severityFor(draft),
      remedy: [REQUEST_PATHS[draft.kind], ...materialReasons(draft)].join(' · '),
      approval_owner: boardOwnerName(),
      status: verify ? 'approved' : 'awaiting_approval',
      decided_by: verify ? boardOwnerName() : '',
      decided_at: verify ? now : '',
      evidence_ref: '',
      note: draft.note,
      created_at: now
    })

    let n = overlay.value.history.length
    const his = () => `his-${910000 + ++n}`
    for (const d of draft.diffs) {
      if (d.old === d.new) continue
      overlay.value.history.push({ history_id: his(), table_name: d.table, row_key: d.row_key, field: d.field, old_value: d.old, new_value: d.new, changed_by: boardOwnerName(), changed_at: now, review_id: reviewId })
    }
    if (verify) {
      // The owner supplied the evidence, so the grade turns verified with today's date (spec "Actions").
      for (const d of draft.diffs) {
        overlay.value.accessApplied[d.row_key] = { ...overlay.value.accessApplied[d.row_key], [d.field]: d.new }
      }
    }
    for (const a of draft.newAccess ?? []) {
      const accessId = nextId('acc-', 910000, [...overlay.value.access.map(x => x.access_id)])
      overlay.value.access.push({ ...a, access_id: accessId, agent_id: draft.agent_id, grade: 'proposed', verified_at: '', created_at: now })
      overlay.value.history.push({ history_id: his(), table_name: 'gov_access', row_key: accessId, field: '*', old_value: '', new_value: 'row created (proposed)', changed_by: boardOwnerName(), changed_at: now, review_id: reviewId })
    }
    if (draft.newAgent) {
      overlay.value.agents.push({ ...draft.newAgent, deploy_state: 'declared' })
      overlay.value.history.push({ history_id: his(), table_name: 'gov_registry', row_key: draft.agent_id, field: '*', old_value: '', new_value: 'row created (declared)', changed_by: boardOwnerName(), changed_at: now, review_id: reviewId })
      if (draft.buildCard) {
        const taskId = nextId('TSK-', 910000, overlay.value.cards.map(c => c.task_id))
        overlay.value.cards.push({ task_id: taskId, task_type: 'build', upgrade_target: draft.agent_id, title: `Build ${draft.newAgent.name || draft.agent_id}`, stage: 'backlog', created_at: now })
      }
    }
    return reviewId
  }

  // ---------- Deciding (stands in for form.gov-approve-change) ----------

  /**
   * Approving applies registry field changes (a lifecycle move, a correction) and access corrections.
   * New access rows stay proposed: a change counts only after deployment and a verification read.
   * Rejecting leaves every value as it was.
   */
  function decide(reviewId: string, status: 'approved' | 'rejected', note: string) {
    if (readOnly.value) return
    overlay.value.decisions[reviewId] = { status, note, decided_at: new Date().toISOString() }
    if (status !== 'approved') return
    for (const h of overlay.value.history.filter(x => x.review_id === reviewId && x.field !== '*')) {
      const target = h.table_name === 'gov_registry' ? overlay.value.applied : overlay.value.accessApplied
      target[h.row_key] = { ...target[h.row_key], [h.field]: h.new_value }
    }
  }

  function lifecycleOf(id: string): Lifecycle | undefined {
    return agent(id)?.lifecycle_status
  }

  return {
    loaded, loadError, updatedAt, refreshing, source, registration, readOnly, refresh, startRefreshing, stopRefreshing, reset,
    registry, access, reviews, history, assets, policy, deployed, cards, views, counts, columns, awaitingApproval,
    agent, view, nameOf, avatarOf, accessFor, reviewsFor, historyFor, requestsFor, requestedValue, accessPending, lifecycleOf,
    isLocal, record, decide
  }
})
