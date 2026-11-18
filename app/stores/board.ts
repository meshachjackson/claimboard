// Board store. Rows come from GET /api/board (fixtures or gw.gov-board-read).
// Every action is one gw.gov-board-write op (see "Writes" below). Fixtures mode keeps its edits
// in localStorage; gateway mode sends them through the board server.
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type {
  BoardColumn, BoardData, BoardOp, BoardSource, Caller, ColumnRole, GovTask, GovTaskNote, GovTaskStep, PillStyle,
  RegistryAgent, Stage, ViewId, WorkState, WriteResult
} from '~/types/board'
import {
  ARCHIVE_AFTER_DAYS, CARD_DEFAULT, CARD_EXTRAS, CHAT_ROLE, boardOwner, defaultRunner, nonRegistryName, OPEN_PILL, OP_LABELS, PROPOSED_OPS,
  REFUSAL_LABELS, STEP_STATE_LABELS, WORK_STATE_PILLS, avatarFor, plainData
} from '~/types/board'
import { activeSteps, columnRoles, deriveStage, isPool, noReplyHours, poolType, primaryStep, stepHeldBy, withPresetViews } from '~/utils/rollup'
import type { MergePlan } from '~/utils/dupes'
import { boardThreadTag, isBoardThread, isInboxCard, newestBoardThread, threadTitle, withSurface } from '~/utils/orchestratorThread'
import { LEASE_PREFIX, applyOp, canWake, cardAgent, chatTarget, holdsCardOut, mergeRows, taggedAgent } from '~/utils/boardOps'
import { createWriteQueue } from '~/utils/writeQueue'
import { formatDate, splitList } from '~/utils/format'
import { classMismatch, pickerLabel } from '~/utils/agentLane'
import { pickRunner } from '~/utils/runnerRule'
import { applySwitch, overlayPending } from '~/utils/availability'
import type { SwitchMode } from '~/utils/availability'
import type { Explain } from '~/utils/explain'
import { explainCard } from '~/utils/explain'
import { noTaker } from '~/utils/whoseMove'
import { FEED_POLL_MS, mergeFeed, type FeedReply } from '~/utils/eventFeed'

// Bundled column presets, used for any view the read gateway returns no board_columns rows for.
import presetColumns from '~~/mock/board_columns.json'

// v2: Phase 2 rows (gateway lease owners, no system lines). Phase 0 edits are left behind.
const STORAGE_KEY = 'agent-board:fixtures:v2'
// By default no timer: every gateway read is an n8n execution. The board
// refreshes on load, on the Refresh button, and when the tab regains focus after STALE_MS.
// Two opt-ins for working locally: Settings > Live updates sets an interval (LIVE_FLOOR_MS applies to the n8n gateway),
// and the push stream (/api/board/events) re-reads the moment a write lands.
const STALE_MS = 5 * 60_000
const LIVE_FLOOR_MS = 60_000

const clone = <T>(rows: T): T => JSON.parse(JSON.stringify(rows)) as T

/** A card as the UI shows it: the row plus everything derived from its steps and notes. */
export interface CardView {
  task: GovTask
  stage: Stage
  workState: WorkState
  steps: GovTaskStep[] // active (not cancelled), in step order
  primary: GovTaskStep | null
  assignee: string // who the avatar shows; '' or pool:* means unassigned
  heldBy: string // Build only: the agent holding the open step when it is not the card's assignee, else ''
  pill: PillStyle | null
  activity: string
  tags: string[]
  noteCount: number
  approvalPending: boolean
  chat: GovTaskStep | null // an open message to an agent, waiting for its answer
  archived: boolean
  pinned: boolean // protected from cleanup and sorted first in its column
  stale: boolean // a Done card older than ARCHIVE_AFTER_DAYS, ready for cleanup; never a pinned card
  classWarning: string // why the assignee will not run this card (class rule), else ''
  stranded: string // why no agent can take the card's open step (utils/whoseMove noTaker), else ''
  explain: Explain | null // what is going on and what the owner can do, in plain words
  border: string
  shadow: string
}

/** The fields the card editor sends. Blank fields are left out of create_task. */
export interface TicketFields {
  title: string
  project_id: string
  board_id?: string // blank means the main board
  task_type: string
  priority: string
  tags: string
  due_at: string
  acceptance_requirements: string
  original_request: string // create only: never edited after creation
  approval_state: string // create only
  assignee: string // create sends it as a second op, assign
}

const DAY_MS = 86_400_000

const AGENT_STAGES: Stage[] = ['architecture', 'build']

export const useBoardStore = defineStore('board', () => {
  const columns = ref<BoardColumn[]>(presetColumns as BoardColumn[])
  const registry = ref<RegistryAgent[]>([])

  const tasks = ref<GovTask[]>([])
  const steps = ref<GovTaskStep[]>([])
  const notes = ref<GovTaskNote[]>([])

  // ---------- Loading and refreshing ----------

  const source = ref<BoardSource | null>(null)
  const loaded = ref(false)
  const updatedAt = ref<string | null>(null) // when the last good rows arrived
  const loadError = ref('') // set when the last load failed; the last good rows stay on screen
  const writable = ref(false) // false in gateway mode until NUXT_BOARD_WRITE_URL is set
  const readOnly = computed(() => !writable.value)
  // True when the server keeps fixtures-mode rows in NUXT_BOARD_FILE. The page then sends edits to the server
  // and shows the server's rows, instead of keeping its own copy in browser storage.
  const saved = ref(false)
  // True when the rows live in this browser only: fixtures mode without a board file.
  const localOnly = computed(() => source.value === 'fixtures' && !saved.value)
  // Proposed ops the gateway supports (all of them in fixtures mode). The UI offers only these.
  const liveOps = ref<string[]>([])
  const canUse = (op: typeof PROPOSED_OPS[number]) => !readOnly.value && liveOps.value.includes(op)

  // Fixtures mode keeps the server's rows so "Reset fixtures" can drop local edits.
  let fixtureRows: Pick<BoardData, 'tasks' | 'steps' | 'notes'> | null = null

  function apply(rows: Pick<BoardData, 'tasks' | 'steps' | 'notes'>) {
    tasks.value = clone(rows.tasks)
    steps.value = clone(rows.steps)
    notes.value = clone(rows.notes)
  }

  /** Fixture rows plus any local edits saved in localStorage. */
  function applyFixtures() {
    if (!fixtureRows || !localOnly.value) return
    const rows = { ...fixtureRows }
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) Object.assign(rows, JSON.parse(saved))
    } catch {
      // Unreadable storage: fall back to fixtures.
    }
    apply(rows)
  }

  // Event feed: true when steps live in Postgres. The page then polls /api/board/feed every FEED_POLL_MS
  // and merges the events into the confirmed rows, so a step change shows in seconds; the snapshot is only the starting point.
  const feed = ref(false)
  let feedCursor: number | null = null
  let feedTimer: ReturnType<typeof setInterval> | undefined
  let feedBusy = false

  async function pollFeed() {
    if (!feed.value || feedBusy || document.visibilityState !== 'visible') return
    feedBusy = true
    try {
      const reply = await $fetch<FeedReply>('/api/board/feed', { query: feedCursor === null ? {} : { since: String(feedCursor) } })
      if (reply.steps.length || reply.notes.length) {
        queue.mergeConfirmed(rows => ({ ...rows, ...mergeFeed(rows.steps, rows.notes, reply) }))
        updatedAt.value = new Date().toISOString()
      }
      feedCursor = reply.cursor
    } catch {
      // A failed poll is retried on the next tick; the rows on screen stay.
    } finally {
      feedBusy = false
    }
  }
  function setFeedTimer(on: boolean) {
    clearInterval(feedTimer)
    feedTimer = on ? setInterval(() => { void pollFeed() }, FEED_POLL_MS) : undefined
  }

  const refreshing = ref(false)
  let lastAttempt = 0

  // `fresh` (the Refresh button) asks the server to skip its 5-minute cache. Load, focus and stale retries use the cache.
  async function refresh(fresh = false) {
    if (refreshing.value) return
    refreshing.value = true
    lastAttempt = Date.now()
    try {
      const data = await $fetch<BoardData & { source: BoardSource, writable: boolean, liveOps: string[], saved: boolean, feed?: boolean }>('/api/board', { query: fresh ? { fresh: '1' } : {} })
      source.value = data.source
      saved.value = data.saved === true
      writable.value = data.writable
      liveOps.value = data.liveOps ?? []
      feed.value = data.feed === true
      // A switch clicked a moment ago may not be in this read yet; keep it on screen until the server answers.
      registry.value = overlayPending(data.registry, pendingSwitches)
      columns.value = withPresetViews(data.columns, presetColumns as BoardColumn[])
      if (data.source === 'fixtures' && !saved.value) {
        // Fixtures don't change on the server, so only the first load replaces rows.
        if (!fixtureRows) {
          fixtureRows = data
          applyFixtures()
        }
      } else {
        // Clicks the server has not answered yet stay on screen on top of these rows.
        queue.setConfirmed(data)
        // The snapshot may be minutes old; the next poll replays the recent window on top of it.
        feedCursor = null
      }
      updatedAt.value = new Date().toISOString()
      loadError.value = ''
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      // A lost session sends the owner back to sign in.
      if (status === 401 || status === 403) {
        await navigateTo('/login')
        return
      }
      const reason = (err as { data?: { data?: { error?: string } } }).data?.data?.error
      loadError.value = reason ?? (status ? `HTTP ${status}` : 'No response')
    } finally {
      loaded.value = true
      refreshing.value = false
    }
  }

  // Tab shown again or window focused: refresh only if the last try is older than STALE_MS.
  function onFocus() {
    if (document.visibilityState === 'visible' && Date.now() - lastAttempt > STALE_MS) autoRefresh()
  }
  // A timed or pushed read waits while clicks are unanswered: the rows it brings may not include them yet.
  function autoRefresh() {
    if (!queue.pending().length) refresh()
  }
  let watching = false
  let timer: ReturnType<typeof setInterval> | undefined
  let stream: EventSource | undefined
  let stopWatch: (() => void) | undefined
  let stopFeed: (() => void) | undefined

  // Interval refresh: skipped while the tab is hidden or a read is running. A gateway read is cached on the server for 5
  // minutes, so the floor only keeps a hosted board from asking for fresh runs.
  function setTimer(seconds: number) {
    clearInterval(timer)
    timer = undefined
    if (!seconds) return
    const ms = source.value === 'gateway' ? Math.max(seconds * 1000, LIVE_FLOOR_MS) : seconds * 1000
    timer = setInterval(() => { if (document.visibilityState === 'visible') autoRefresh() }, ms)
  }

  // Push: the server says "changed" after a write; the page re-reads. Only while the interval setting is on, and only on
  // hosts that have the stream (not Vercel). Any stream error closes it and the interval carries on alone.
  function setStream(on: boolean) {
    stream?.close()
    stream = undefined
    if (!on || typeof EventSource === 'undefined') return
    stream = new EventSource('/api/board/events')
    stream.addEventListener('changed', () => { if (document.visibilityState === 'visible') autoRefresh() })
    stream.onerror = () => { stream?.close(); stream = undefined }
  }

  function startRefreshing() {
    if (watching) return
    watching = true
    refresh()
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    const settings = useSettings()
    // Re-applies when the setting changes, and once the first read has said which source this is.
    stopFeed = watch(feed, on => setFeedTimer(on), { immediate: true })
    stopWatch = watch([() => settings.liveSeconds.value, source], ([seconds]) => {
      setTimer(seconds)
      setStream(seconds > 0)
    }, { immediate: true })
  }
  function stopRefreshing() {
    watching = false
    document.removeEventListener('visibilitychange', onFocus)
    window.removeEventListener('focus', onFocus)
    stopWatch?.()
    stopFeed?.()
    setFeedTimer(false)
    setTimer(0)
    setStream(false)
  }

  /** Switch clicks the server has not answered yet. A read that lands meanwhile must not undo them. */
  const pendingSwitches = new Map<string, SwitchMode>()

  /**
   * Turns an agent on, off or auto (Settings > Agents). The control moves at once; the server keeps the switch.
   * On failure the control goes back to the old mode and the reason comes back in words ('' means saved).
   */
  async function setSwitch(agentId: string, mode: SwitchMode): Promise<string> {
    const before = registry.value
    pendingSwitches.set(agentId, mode)
    registry.value = applySwitch(before, agentId, mode)
    try {
      await $fetch('/api/agent-switches', { method: 'POST', body: { agent_id: agentId, mode } })
      await refresh(true) // skipped if a poll is running; the optimistic row already shows the new mode
      // Keep covering the row a few seconds: a poll that began before the save may still land with the old mode.
      setTimeout(() => { if (pendingSwitches.get(agentId) === mode) pendingSwitches.delete(agentId) }, 5000)
      return ''
    } catch (err) {
      pendingSwitches.delete(agentId)
      // Put back only this agent's mode, so a newer read for other agents is kept.
      const old = before.find(a => a.agent_id === agentId)?.switch ?? 'on'
      registry.value = applySwitch(registry.value, agentId, old)
      const e = err as { statusMessage?: string, data?: { statusMessage?: string }, message?: string }
      return e.data?.statusMessage ?? e.statusMessage ?? (e.message ? `Could not reach the board: ${e.message}` : 'Could not save the switch')
    }
  }

  function reset() {
    if (!localOnly.value) return
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    applyFixtures()
  }

  // Only fixtures mode without a board file saves local edits.
  watch([tasks, steps, notes], () => {
    if (!localOnly.value) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: tasks.value, steps: steps.value, notes: notes.value }))
    } catch {
      // Private mode or full storage: edits last until reload.
    }
  }, { deep: true })

  // ---------- Lookups ----------

  function agent(id: string): RegistryAgent | undefined {
    return registry.value.find(a => a.agent_id === id)
  }

  /** Why this agent will not run a card with these tags, or ''. Shown before the card is dragged to Build. */
  function classWarningFor(tags: string[], agentId: string): string {
    return classMismatch(tags, agent(agentId))
  }

  /** The picker text for an assignee: the name, plus the lane and classes for an API or harness agent. */
  function pickerName(id: string): string {
    return pickerLabel(nameOf(id), agent(id))
  }

  /** True when the owner switched this agent off (Settings > Agents). The assignee pickers disable it. */
  function agentOff(id: string): boolean {
    return agent(id)?.switch === 'off'
  }

  function nameOf(id: string): string {
    if (!id) return 'Unassigned'
    if (isPool(id)) return `Any ${poolType(id)}`
    return nonRegistryName(id) ?? agent(id)?.name ?? id
  }

  function avatarOf(id: string) {
    return avatarFor(id, nameOf(id))
  }

  function stepsFor(taskId: string): GovTaskStep[] {
    return steps.value.filter(s => s.task_id === taskId).sort((a, b) => a.step_no - b.step_no)
  }

  function notesFor(taskId: string): GovTaskNote[] {
    return notes.value.filter(n => n.task_id === taskId).sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  function stageOf(task: GovTask): Stage {
    return deriveStage(task, stepsFor(task.task_id), registry.value)
  }

  function columnsFor(view: ViewId): BoardColumn[] {
    return columns.value.filter(c => c.view === view).sort((a, b) => a.position - b.position)
  }

  function rolesFor(stage: Stage): ColumnRole[] {
    return columnRoles(columns.value.find(c => c.view === 'stages' && c.match === `stage=${stage}`))
  }

  // ---------- Card view ----------

  function activityFor(task: GovTask, primary: GovTaskStep | null): string {
    if (primary) {
      return plainData(primary.activity ?? '') || primary.output_summary || primary.stop_reason || STEP_STATE_LABELS[primary.step_state]
    }
    if (task.work_state === 'done') return `Done ${formatDate(task.updated_at)}`
    return ''
  }

  function cardFor(task: GovTask): CardView {
    const stage = stageOf(task)
    // Steps from earlier columns (a served architect step on a Build card) drop off the card.
    const roles = AGENT_STAGES.includes(stage) ? rolesFor(stage).map(r => r.role) : []
    // Done cards show only "Done <date>"; their steps stay in the drawer.
    // Chat steps never drive the card; they show as `chat` instead.
    const all = stage === 'done'
      ? []
      : activeSteps(stepsFor(task.task_id)).filter(s => s.role !== CHAT_ROLE && (!s.role || roles.length === 0 || roles.includes(s.role)))
    const primary = primaryStep(all)
    // An open message nobody has answered past its threshold puts the card under Needs you.
    const chat = openChat(task.task_id)
    const silentHours = task.work_state === 'done' || task.archived_at ? 0 : noReplyHours(chat, !!chat && wakeable(chat.assignee))
    const workState = silentHours && task.work_state !== 'needs_input' ? 'needs_input' : task.work_state
    const open = primary && primary.step_state === 'awaiting_pull' && isPool(primary.assignee) && workState === 'awaiting_start'
    const extras = CARD_EXTRAS[workState] ?? CARD_DEFAULT
    const classWarning = workState === 'done' ? '' : classWarningFor(splitList(task.tags), task.assignee)
    const explain = task.archived_at || stage === 'done' ? null : explainCard({
      task, stage, workState, primary, allSteps: stepsFor(task.task_id), classWarning,
      needsApproval: canApprove(task),
      noReply: silentHours ? { agent: chat!.assignee, hours: silentHours } : null
    }, { registry: registry.value, nameOf })
    return {
      task,
      stage,
      workState,
      steps: all,
      primary,
      assignee: primary?.assignee || task.assignee,
      heldBy: stepHeldBy(task, stage, primary),
      pill: workState === 'backlog' ? null : open ? OPEN_PILL : WORK_STATE_PILLS[workState],
      activity: silentHours ? `No reply for ${silentHours} h from ${nameOf(chat!.assignee)}` : activityFor(task, primary),
      tags: splitList(task.tags),
      noteCount: notes.value.filter(n => n.task_id === task.task_id && n.kind !== 'system').length,
      // Finished work doesn't need the badge, even when the live row still says pending.
      approvalPending: task.approval_state === 'pending' && workState !== 'done',
      chat,
      archived: !!task.archived_at,
      pinned: !!task.pinned_at,
      stale: workState === 'done' && !task.archived_at && !task.pinned_at && Date.now() - Date.parse(task.updated_at) > ARCHIVE_AFTER_DAYS * DAY_MS,
      classWarning,
      stranded: noTaker({ workState, stage, archived: !!task.archived_at, primary, classWarning }, registry.value),
      explain,
      border: extras.border,
      shadow: extras.shadow
    }
  }

  /** The card's open chat step (message_agent), newest first. */
  function openChat(taskId: string): GovTaskStep | null {
    return stepsFor(taskId).filter(s => s.role === CHAT_ROLE && !s.cancelled && !s.acked_at).pop() ?? null
  }

  /** The card's open message, else its latest one: the step the drawer's receipt timeline follows. */
  function latestChat(taskId: string): GovTaskStep | null {
    return openChat(taskId) ?? stepsFor(taskId).filter(s => s.role === CHAT_ROLE && !s.cancelled).pop() ?? null
  }

  /** Who a message on this card goes to: the tagged agent if it takes messages, else the orchestrator (the front door, decided 11/2/2026). */
  function messageTarget(taskId: string, body = ''): string {
    return chatTarget(findTask(taskId), steps.value, registry.value, '', taggedAgent(body, registry.value))
  }

  /** The agent on the card, whether or not it takes messages ('' when none). The drawer names it when the orchestrator answers instead. */
  function agentOn(taskId: string): string {
    return cardAgent(findTask(taskId), steps.value)
  }

  /** Whether "Respond now" can wake this agent (hosted agents only, the orchestrator today). */
  function wakeable(agentId: string): boolean {
    return canWake(agentId, registry.value)
  }

  // Two kinds of the orchestrator card (orchestratorThread.ts) stay off the board: the Telegram inbox card and the board thread cards. The panel
  // and the orchestrator screen show the thread cards; `tasks` as the rest of the app reads it leaves both out. The store works on the full list.
  const visibleTasks = computed(() => tasks.value.filter(t => !isInboxCard(t.tags) && !isBoardThread(t.tags)))
  const cards = computed<CardView[]>(() => visibleTasks.value.map(cardFor))

  const counts = computed(() => ({
    working: tasks.value.filter(t => t.work_state === 'in_progress').length,
    needs: cards.value.filter(c => c.workState === 'needs_input').length,
    blocked: tasks.value.filter(t => t.work_state === 'blocked').length
  }))

  // ---------- Writes ----------
  // Every action is one gw.gov-board-write op. In gateway mode it
  // goes through POST /api/board/:op; in fixtures mode the same contract runs in the browser
  // (utils/boardOps). Either way the answer's rows are merged, and a refusal is shown, not hidden.

  const toast = useToast()
  const writeCount = ref(0) // bumped after every write, refused or not, so drag lists re-sync

  // Instant clicks. In gateway and board-file modes a click changes the screen at once and goes to the server through
  // this queue (utils/writeQueue.ts). `tasks`, `steps` and `notes` are what the page shows: the server's rows plus the
  // clicks it has not answered yet. Fixtures mode keeps its own rows and never uses the queue.
  const savingTasks = ref<string[]>([]) // cards with a click the server has not answered
  const savingNotes = ref<string[]>([]) // notes the page made up for those clicks (shown as "sending")
  const writing = computed(() => savingTasks.value.length > 0)
  const isSaving = (taskId: string) => savingTasks.value.includes(taskId)
  const isSendingNote = (noteId: string) => savingNotes.value.includes(noteId)

  // The last refusal, so the drawer can point at the fix (an unapproved plan points at "Approve plan").
  const lastRefusal = ref<{ op: BoardOp, reason: string, taskId: string } | null>(null)

  function showRefusal(op: BoardOp, reason: string, taskId: string) {
    lastRefusal.value = { op, reason, taskId }
    toast.add({ title: `${OP_LABELS[op]} refused`, description: REFUSAL_LABELS[reason] ?? reason, color: 'error' })
  }

  /** One request to the board server. A failed request is a refusal with a short reason, never a throw. */
  async function send(op: string, args: Record<string, unknown>): Promise<WriteResult> {
    try {
      return await $fetch<WriteResult>(`/api/board/${op}`, { method: 'POST', body: args })
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 401 || status === 403) {
        await navigateTo('/login')
        return { ok: false, op, reason: 'signed out' }
      }
      // A 502 from the gateway carries a short reason and no rows: nothing was changed.
      const reason = (err as { data?: { data?: { error?: string } } }).data?.data?.error
      return { ok: false, op, reason: reason ?? (status ? `HTTP ${status}` : 'no response') }
    }
  }

  const queue = createWriteQueue({
    send,
    context: () => ({ columns: columns.value, registry: registry.value }),
    onChange() {
      const shown = queue.rows()
      tasks.value = shown.tasks
      steps.value = shown.steps
      notes.value = shown.notes
      savingTasks.value = [...queue.busyLanes()]
      savingNotes.value = [...queue.guessedNotes()]
    },
    async onFailure(failed, result, dropped) {
      writeCount.value += 1
      showRefusal(failed.op as BoardOp, result.reason, String(failed.args.task_id ?? ''))
      if (dropped.length) {
        toast.add({ title: `${dropped.length} later change${dropped.length === 1 ? '' : 's'} on this card undone`, description: 'They were made on top of the one that failed.', color: 'error' })
      }
      // A stale card means the rows on screen are old. The server dropped its cache, so re-read.
      if (result.reason === 'stale' && (source.value === 'gateway' || saved.value)) await refresh()
    }
  })

  async function run(op: BoardOp, args: Record<string, unknown>, caller: Caller = { person: boardOwner() }): Promise<WriteResult> {
    if (readOnly.value) return { ok: false, op, reason: 'read only' }
    lastRefusal.value = null
    if (!localOnly.value) {
      // The screen has already changed when this returns a promise; it settles with the server's answer.
      const result = await queue.enqueue(op, args, caller)
      writeCount.value += 1
      return result
    }
    // Fixtures mode: a copy stands in for the live tables, so the answer's rows are merged the same way.
    const result = applyOp(clone({ tasks: tasks.value, steps: steps.value, notes: notes.value, columns: columns.value, registry: registry.value }), op, args, caller)
    if (result.ok) mergeRows({ tasks: tasks.value, steps: steps.value, notes: notes.value }, result.rows)
    writeCount.value += 1
    if (!result.ok) showRefusal(op, result.reason, String(args.task_id ?? ''))
    return result
  }

  function findTask(taskId: string): GovTask {
    const task = tasks.value.find(t => t.task_id === taskId)
    if (!task) throw new Error(`Unknown card ${taskId}`)
    return task
  }

  // Steps that hold a card out of "Done (no agent steps)": see holdsCardOut (open or stalled steps only).
  const holdingSteps = (taskId: string) => stepsFor(taskId).filter(holdsCardOut)

  /** The architect step waiting for "Approve plan": acked served with PASS, not yet verified. */
  function planToApprove(task: GovTask): GovTaskStep | undefined {
    if (task.stage !== 'architecture') return undefined
    return activeSteps(stepsFor(task.task_id)).find(s => s.role === 'architect' && s.step_state === 'served' && s.verdict === 'PASS' && !!s.acked_at)
  }

  /** An agent's question that a reply answers: acked needs_input, still the active step for its role. */
  function questionFor(taskId: string): GovTaskStep | undefined {
    return activeSteps(stepsFor(taskId)).find(s => s.step_state === 'needs_input' && !!s.acked_at)
  }

  /** "Approve" shows for a pending approval gate or a plan waiting in Architecture. */
  function canApprove(task: GovTask): boolean {
    return task.approval_state === 'pending' || !!planToApprove(task)
  }

  /**
   * create_task (rule 1), then assign when the editor named someone. Returns the new task_id, or '' when refused.
   * Blank fields are left out of the args, so the gateway's defaults apply (build, normal, not_required).
   */
  async function createTask(fields: Partial<TicketFields> & { title: string }): Promise<string> {
    const { assignee, ...rest } = fields
    const args = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v !== ''))
    const result = await run('create_task', args)
    const created = result.ok ? result.rows.tasks?.[0] : undefined
    if (!created) return ''
    if (assignee) await run('assign', { task_id: created.task_id, assignee, updated_at: created.updated_at })
    return created.task_id
  }

  /**
   * "Create and start": create_task, assign, then start_task (or move_task to build when the host has not turned
   * start_task on). Plan first moves the card to Architecture instead. A blank assignee gets an agent by rule
   * (utils/runnerRule.ts); if no agent fits, the card stays unassigned and its step goes to the pool.
   * Returns the new task_id, or '' when create was refused.
   */
  async function runTicket(fields: Partial<TicketFields> & { title: string }, planFirst = false): Promise<string> {
    const role = columnRoles(columns.value.find(c => c.view === 'stages' && c.match === 'stage=build')).find(r => r.role === 'builder')
    const assignee = fields.assignee || (role
      ? pickRunner({ tasks: tasks.value, registry: registry.value, role, project: String(fields.project_id ?? '').trim(), tags: splitList(fields.tags), fallback: defaultRunner(), stageOf })
      : '')
    const id = await createTask({ ...fields, assignee })
    if (!id) return ''
    if (planFirst) await moveTask(id, 'architecture')
    else if (canUse('start_task')) await startTask(id)
    else await moveTask(id, 'build')
    return id
  }

  /** update_task with only the fields that changed; assignee goes through assign. True when everything saved. */
  async function updateTask(taskId: string, fields: Partial<TicketFields>): Promise<boolean> {
    const { assignee, original_request: _req, approval_state: _appr, ...rest } = fields
    let task = findTask(taskId)
    // The form sends due_at as a day (YYYY-MM-DD), so compare the stored date by its day.
    const stored = (k: string) => k === 'due_at' ? (task.due_at ?? '').slice(0, 10) : String(task[k as keyof GovTask] ?? '')
    const changed = Object.fromEntries(Object.entries(rest)
      .map(([k, v]): [string, string] => [k, String(v ?? '').trim()])
      .map(([k, v]): [string, string] => [k, k === 'tags' ? v.split(',').map(x => x.trim()).filter(Boolean).join(',') : v])
      .filter(([k, v]) => stored(k) !== v))
    if (Object.keys(changed).length) {
      const result = await run('update_task', { task_id: taskId, ...changed, updated_at: task.updated_at })
      if (!result.ok) return false
      task = findTask(taskId)
    }
    if (assignee !== undefined && assignee !== task.assignee) {
      const result = await run('assign', { task_id: taskId, assignee, updated_at: task.updated_at })
      if (!result.ok) return false
    }
    return true
  }

  /**
   * move_task (rules 2, 4, 5, 11). A card with no open steps and no passing internal_verification can't carry one, so
   * Done goes through done_no_steps instead (widened for): the owner's word closes it. A card
   * that already passed its verification keeps the normal move.
   */
  async function moveTask(taskId: string, to: Stage) {
    const task = findTask(taskId)
    if (stageOf(task) === to) return
    if (to === 'done' && holdingSteps(taskId).length === 0 && !/^pass/.test(task.internal_verification ?? '')) {
      await run('done_no_steps', { task_id: taskId, updated_at: task.updated_at })
      return
    }
    await run('move_task', { task_id: taskId, stage: to, updated_at: task.updated_at })
  }

  /** start_task: Start a Backlog card, or Restart a Build card whose step failed or was cancelled. */
  async function startTask(taskId: string) {
    await run('start_task', { task_id: taskId, updated_at: findTask(taskId).updated_at })
  }

  /** send_back: a Review card goes back to Build with the owner's line in the thread and in the new step's goal. */
  async function sendBack(taskId: string, body: string): Promise<boolean> {
    return (await run('send_back', { task_id: taskId, body, updated_at: findTask(taskId).updated_at })).ok
  }

  /** publish_task: a passed Review card gets one publish step, the only kind the runner lets push a branch and open a draft PR. */
  async function publishTask(taskId: string): Promise<boolean> {
    return (await run('publish_task', { task_id: taskId, updated_at: findTask(taskId).updated_at })).ok
  }

  /** reopen_task: raise retry_cap on a card the orchestrator escalated at the cap; it retries it on its next pickup. */
  async function reopenTask(taskId: string, retryCap: number): Promise<boolean> {
    return (await run('reopen_task', { task_id: taskId, retry_cap: String(retryCap), updated_at: findTask(taskId).updated_at })).ok
  }

  /** assign: the task's assignee. The next step a move creates goes to them if they're eligible. */
  async function assign(taskId: string, assignee: string) {
    const task = findTask(taskId)
    // A blank assignee unassigns the card.
    if (task.assignee === assignee) return
    await run('assign', { task_id: taskId, assignee, updated_at: task.updated_at })
  }

  /**
   * approve_task for a pending approval gate, otherwise approve_plan and then move_task to build (rules 3a, 3b).
   * The move creates the builder step. A refused approval sends no move. A refused move leaves the plan approved,
   * and run() shows the refusal reason.
   */
  async function approve(taskId: string) {
    const task = findTask(taskId)
    if (task.approval_state === 'pending') {
      await run('approve_task', { task_id: taskId, updated_at: task.updated_at })
      return
    }
    const plan = planToApprove(task)
    if (!plan) return
    const approved = await run('approve_plan', { step_id: plan.step_id, updated_at: plan.updated_at })
    if (approved.ok) await moveTask(taskId, 'build')
  }

  /**
   * A comment from the drawer. It answers an agent's question with reply (a new step for it, rule 8); otherwise it
   * messages the agent on the card, or the orchestrator when there's none (message_agent). Before the gateway has
   * message_agent, it's a plain note.
   */
  async function reply(taskId: string, body: string): Promise<boolean> {
    const asked = questionFor(taskId)
    // An @tag sends the message to that agent instead (the answer threads under the same chat step). Only sent when present.
    const to = taggedAgent(body, registry.value)
    const result = asked
      ? await run('reply', { step_id: asked.step_id, body, updated_at: asked.updated_at })
      : canUse('message_agent')
        ? await run('message_agent', { task_id: taskId, body, ...(to && { to }) })
        : await run('add_note', { task_id: taskId, kind: 'comment', body })
    return result.ok
  }

  /** A plain note in the thread (add_note): no step is created and no agent is woken, even with a question open. */
  async function comment(taskId: string, body: string): Promise<boolean> {
    return (await run('add_note', { task_id: taskId, kind: 'comment', body })).ok
  }

  // ---------- Board threads with the orchestrator ----------
  // Each thread is one card tagged `orchestrator-board`. Telegram, Slack and voice write to the `orchestrator-inbox` card, which is never shown here.

  /** True after "New thread" until the next message opens the new card, so the panel shows an empty thread in between. */
  const freshThread = ref(false)

  /** The thread the panel is on, or null before the first message and right after "New thread". */
  const orchestratorCard = computed<GovTask | null>(() => (freshThread.value ? null : newestBoardThread(tasks.value)))

  /** The current thread's notes, oldest first. */
  const orchestratorThread = computed<GovTaskNote[]>(() => (orchestratorCard.value ? notesFor(orchestratorCard.value.task_id) : []))

  /** Every board thread card, archived too. The orchestrator screen lists them with their notes (notesFor). */
  const orchestratorThreadCards = computed<GovTask[]>(() => tasks.value.filter(t => isBoardThread(t.tags)))

  /** True while the orchestrator has an open chat step on the current thread: it has the message and has not answered yet. */
  const orchestratorWorking = computed(() => !!orchestratorCard.value && !!openChat(orchestratorCard.value.task_id))

  /** Starts a new thread (the button, or /new and /clear). The card opens with the next message; the old thread stays in history. */
  function newOrchestratorThread() {
    freshThread.value = true
  }

  /**
   * Sends one message to the orchestrator in the current thread. Opens a new thread card first when there is none, writes the
   * message as a note with its surface prefix (message_agent). The gateway wakes her; fixtures play her answer.
   * Returns false when something was refused (board.lastRefusal says why).
   */
  async function askOrchestrator(text: string): Promise<boolean> {
    let card = orchestratorCard.value
    if (!card) {
      const id = await createTask({
        title: threadTitle(new Date()),
        original_request: 'A conversation between the board manager (the orchestrator) and a person using the board.',
        task_type: 'operational',
        tags: boardThreadTag()
      })
      if (!id) return false
      card = findTask(id)
      freshThread.value = false
    }
    const sent = await run('message_agent', { task_id: card.task_id, body: withSurface('board', text) })
    if (!sent.ok) return false
    // Live, the message wakes the orchestrator by itself: its step was dispatched within seconds in both tests (11/2/2026), so a nudge
    // is redundant and was refused as stale. Only the fixtures stand-in has no one to wake and plays her answer here.
    if (localOnly.value) await respondNow(card.task_id)
    return true
  }

  /**
   * The step "Respond now" nudges: the card's open message, waiting to be picked up, held by an agent
   * that can be woken. Work steps and laptop agents can't be nudged.
   */
  function nudgeTarget(taskId: string): GovTaskStep | null {
    const chat = openChat(taskId)
    return chat && chat.step_state === 'awaiting_pull' && wakeable(chat.assignee) ? chat : null
  }

  /** nudge: wake the agent to answer now instead of on its next pickup. */
  async function respondNow(taskId: string) {
    const step = nudgeTarget(taskId)
    if (!step) return
    const result = await run('nudge', { step_id: step.step_id, updated_at: step.updated_at })
    // Fixtures have no agents to wake, so the simulator plays the agent's answer (claim, then answer).
    // Claim, heartbeat, answer: three moves, so every receipt shows. Stops early on a refusal.
    if (result.ok && localOnly.value) {
      for (let i = 0; i < 3 && openChat(taskId)?.step_id === step.step_id; i++) await simulate(taskId)
    }
  }

  /** cancel_step: stops one step. The row stays, marked cancelled. */
  async function cancelStep(stepId: string): Promise<boolean> {
    const st = steps.value.find(x => x.step_id === stepId)
    if (!st) return false
    return (await run('cancel_step', { step_id: stepId, updated_at: st.updated_at })).ok
  }

  /** archive_task: takes a Done card off the board. Its rows stay in the tables. */
  async function archive(taskId: string): Promise<boolean> {
    const task = findTask(taskId)
    return (await run('archive_task', { task_id: taskId, updated_at: task.updated_at })).ok
  }

  /**
   * Delete for any card, not only a Done one. The gateway has no hard delete and archive_task takes Done, unpinned cards
   * only, so this clears the way with the gateway's own ops: cancel open steps, move to Done, unpin, then archive.
   * A refusal at any point stops it and the card stays where it got to. Rows stay in the tables.
   */
  async function remove(taskId: string): Promise<boolean> {
    for (const st of steps.value.filter(x => x.task_id === taskId && x.cancelled !== true && !x.acked_at)) {
      if (!await cancelStep(st.step_id)) return false
    }
    if (stageOf(findTask(taskId)) !== 'done') await moveTask(taskId, 'done')
    if (stageOf(findTask(taskId)) !== 'done') return false
    if (findTask(taskId).pinned_at && !await setPinned(taskId, false)) return false
    return archive(taskId)
  }

  /**
   * Runs a merge plan (utils/dupes.ts planMerge). Per duplicate: a note on it, cancel its open steps, close it (Done), archive it.
   * Cancelling and closing go through the gateway's own rules, so a refusal (a live lease, a pinned card) stops the merge there.
   * The keeper's note is written last, and only names the duplicates that really went. Nothing is deleted: rows stay in the tables.
   */
  async function mergeDupes(plan: MergePlan): Promise<boolean> {
    const done: string[] = []
    let ok = true
    for (const { task, cancel } of plan.remove) {
      const id = task.task_id
      ok = await comment(id, `Merged into ${plan.keeper}. Closed as a duplicate.`)
      for (const step of cancel) ok = ok && await cancelStep(step.step_id)
      if (ok && stageOf(findTask(id)) !== 'done') await moveTask(id, 'done')
      ok = ok && stageOf(findTask(id)) === 'done' && await archive(id)
      if (!ok) break
      done.push(id)
    }
    if (done.length) await comment(plan.keeper, `Merged duplicates: ${done.join(', ')}.`)
    return ok
  }

  /** pin_task / unpin_task: a pinned card is skipped by cleanup and sorts first in its column. */
  async function setPinned(taskId: string, pinned: boolean): Promise<boolean> {
    const task = findTask(taskId)
    return (await run(pinned ? 'pin_task' : 'unpin_task', { task_id: taskId, updated_at: task.updated_at })).ok
  }

  /** Archives the given Done cards, one op each. Stops at the first refusal. Returns how many went. */
  // ---------- Dev-only: simulate an agent (fixtures mode) ----------
  // Runs the agent ops through the same contract as the agent's own call would, as that agent.

  /** The step the simulator acts on: the card's primary step that an agent can still move. */
  function simTarget(task: GovTask): GovTaskStep | null {
    // An open message comes first: it's what the agent would answer next.
    const chat = openChat(task.task_id)
    if (chat) return chat
    if (!AGENT_STAGES.includes(stageOf(task))) return null
    // Only the column's roles: a move leaves other roles' steps as they are.
    const step = primaryStep(cardFor(task).steps)
    return step && ['awaiting_pull', 'awaiting_start', 'dispatched'].includes(step.step_state) ? step : null
  }

  /** Who claims a step: its named agent, or the first active agent of the pool's type. */
  function claimer(step: GovTaskStep): string {
    if (!isPool(step.assignee)) return step.assignee
    return registry.value.find(a => a.agent_type === poolType(step.assignee) && a.lifecycle_status === 'active')?.agent_id ?? ''
  }

  // A builder asks one question per card before it finishes; once the card has a question, it just finishes.
  const asks = (step: GovTaskStep) =>
    step.role !== 'architect' && !notes.value.some(n => n.task_id === step.task_id && n.kind === 'question')

  function simulateLabel(taskId: string): string | null {
    if (!localOnly.value) return null
    const step = simTarget(findTask(taskId))
    if (!step) return null
    if (step.step_state !== 'dispatched') return isPool(step.assignee) ? 'Simulate: an agent claims it' : 'Simulate: agent claims it'
    if (step.role === CHAT_ROLE) return step.activity ? 'Simulate: agent answers the message' : 'Simulate: agent starts reading'
    if (step.role === 'architect') return 'Simulate: agent posts a plan'
    return asks(step) ? 'Simulate: agent asks a question' : 'Simulate: agent completes the step'
  }

  /** One agent move: claim, then a question or the finished step. A question is an ack (complete_step needs_input). */
  async function simulate(taskId: string) {
    if (!localOnly.value) return
    const step = simTarget(findTask(taskId))
    if (!step) return
    const by = step.step_state === 'dispatched' ? step.lease_owner.slice(LEASE_PREFIX.length) : claimer(step)
    const caller = { agent_id: by }
    const base = { step_id: step.step_id, updated_at: step.updated_at }

    if (step.step_state !== 'dispatched') {
      await run('claim_step', { ...base, claim_key: step.claim_key }, caller)
    } else if (step.role === CHAT_ROLE && !step.activity) {
      // A board_reply agent heartbeats at least once before it answers (section 4a).
      await run('heartbeat', { ...base, activity: 'reading the card' }, caller)
    } else if (step.role === CHAT_ROLE) {
      const asked = notes.value.filter(n => n.step_id === step.step_id && n.author_id === boardOwner() && n.kind === 'comment').pop()
      const quote = (asked?.body ?? '').slice(0, 80)
      await run('complete_step', { ...base, step_state: 'served', verdict: 'PASS', output_summary: `${nameOf(by)} here. On "${quote}": noted, and I'll fold it into the next step on this card.` }, caller)
    } else if (step.role === 'architect') {
      await run('complete_step', { ...base, step_state: 'served', verdict: 'PASS', output_ref: `plan ${step.step_id}`, output_summary: 'Proposed plan is ready. Approve it, or reply with changes.' }, caller)
    } else if (asks(step)) {
      await run('complete_step', { ...base, step_state: 'needs_input', stop_reason: 'Quick check before I finish:', output_summary: 'should this stay a draft, or do you want it published?' }, caller)
    } else {
      await run('complete_step', { ...base, step_state: 'served', verdict: 'PASS', output_ref: `ledger ${step.step_id}`, output_summary: `${step.step_id} served, verdict PASS.` }, caller)
    }
  }

  return {
    feed,
    columns, registry, tasks: visibleTasks, steps, notes, cards, counts, orchestratorCard, orchestratorThread, orchestratorThreadCards, orchestratorWorking, askOrchestrator, newOrchestratorThread,
    source, saved, localOnly, writable, liveOps, canUse, loaded, updatedAt, loadError, readOnly, refreshing, writing, isSaving, isSendingNote, writeCount, lastRefusal, refresh, startRefreshing, stopRefreshing, setSwitch,
    agent, agentOff, classWarningFor, pickerName, nameOf, avatarOf, stepsFor, notesFor, stageOf, columnsFor, canApprove, questionFor, latestChat, messageTarget, agentOn, wakeable, nudgeTarget,
    createTask, runTicket, updateTask, moveTask, startTask, sendBack, publishTask, reopenTask, assign, approve, reply, comment, respondNow, archive, remove, mergeDupes, setPinned, cancelStep, simulate, simulateLabel, reset
  }
})
