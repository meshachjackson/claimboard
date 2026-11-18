<script setup lang="ts">
// Ticket detail. Desktop drawer and phone sheet share this; only sizes change. Direction B order: the title and its
// pill, the next move (TicketNextMove), Move and Assign, the details, steps, done when, the request, then the thread.
// The reply box (TicketComposer) stays pinned at the bottom.
import type { GovTaskStep, Stage } from '~/types/board'
import {
  AGENT_NOTE_LABEL, APPROVAL_LABELS, BUDGET_USED_LABEL, boardOwner, CHAT_ROLE, chatStepsLabel, PRIORITY_LABELS, STAGES, STAGE_LABELS, STEP_STATE_DOTS, STEP_STATE_LABELS, TASK_TYPE_LABELS,
  UNAPPROVED_PLAN_HINT, WORK_STATE_HELP, WORK_STATE_PILLS
} from '~/types/board'
import { assignHint, deliveryText } from '~/utils/explain'
import { epicOf, milestoneOf, planLabel, plainTags } from '~/utils/planning'
import { formatDate, formatDateTime, splitRequirements } from '~/utils/format'

const props = defineProps<{ taskId: string, phone?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const board = useBoardStore()
const editor = useTicketEditor()

const route = useRoute()
const router = useRouter()

// J and K step to the next and previous ticket in the list it came from; R, M and A jump to reply, move and assign.
// Esc is the slideover's own. None of them fire while typing.
const order = useTicketOrder(() => props.taskId)
function stepTo(d: 1 | -1) {
  const id = order.step(d)
  if (id) router.replace({ query: { ...route.query, task: id } })
}
const focusField = (...ids: string[]) => () => document.getElementById(ids.find(i => document.getElementById(i)) ?? '')?.focus()
// R goes to the answer box when a question is open, else to the pinned composer.
defineShortcuts({ j: () => stepTo(1), k: () => stepTo(-1), r: focusField('ab-answer', 'ab-reply'), m: focusField('ab-move'), a: focusField('ab-assign') })

// Keyboard: remember what had focus when the panel opened (the card), give it back on close. A Needs-you card puts
// focus in its answer box. The wait lets the dialog finish moving focus to its own first button.
const opener = import.meta.client ? document.activeElement as HTMLElement | null : null
function focusAnswer() {
  if (card.value?.workState !== 'needs_input') return
  setTimeout(() => document.getElementById('ab-answer')?.focus(), 50)
}
onMounted(focusAnswer)
watch(() => props.taskId, focusAnswer)
onBeforeUnmount(() => { if (opener?.isConnected) opener.focus() })

const card = computed(() => board.cards.find(c => c.task.task_id === props.taskId))
const task = computed(() => card.value?.task)
const notes = computed(() => board.notesFor(props.taskId))
const requirements = computed(() => splitRequirements(task.value?.acceptance_requirements ?? ''))
// Every step that wasn't cancelled, including earlier columns' steps the card no longer shows.
const taskSteps = computed(() => board.stepsFor(props.taskId).filter(s => !s.cancelled))
// Quiet mode: chat steps (each message to an agent and its answer, already in the thread) wait behind a toggle.
// The Steps heading still counts them. The toggle closes again when the panel moves to another card.
const showChat = ref(false)
watch(() => props.taskId, () => { showChat.value = false })
const chatCount = computed(() => taskSteps.value.filter(s => s.role === CHAT_ROLE).length)
const shownSteps = computed(() => (showChat.value ? taskSteps.value : taskSteps.value.filter(s => s.role !== CHAT_ROLE)))

// Active registry agents a task can go to (the gateway refuses any other), plus the owner. Gateways take no work.
const assignees = computed(() => [
  boardOwner(),
  ...board.registry
    .filter(a => a.lifecycle_status === 'active' && a.agent_type !== 'gateway')
    .map(a => a.agent_id)
])

// The gateway refuses to move a card out of Architecture with a plan waiting; point at the Approve plan button.
const moveNeedsApproval = computed(() => {
  const r = board.lastRefusal
  return !!r && r.op === 'move_task' && r.taskId === props.taskId && r.reason.includes('has an unapproved plan')
})

// What changing the assignee does on this card right now, and how the chosen agent receives work.
const assignNote = computed(() => card.value ? assignHint(card.value, board.nameOf) : '')
const assigneeNote = computed(() => deliveryText(board.registry.find(a => a.agent_id === task.value?.assignee)))
const canPin = computed(() => !!card.value && !card.value.archived && board.canUse(card.value.pinned ? 'unpin_task' : 'pin_task'))

// cancel_step: a step that isn't finished and isn't held under a live lease.
function canCancel(st: GovTaskStep): boolean {
  if (!board.canUse('cancel_step') || card.value?.archived || st.cancelled) return false
  if (st.step_state === 'served' || st.step_state === 'verified') return false
  const held = st.step_state === 'dispatched' && !st.acked_at && !!st.lease_expires_at && Date.parse(st.lease_expires_at) >= Date.now()
  return !held
}

async function cancelStep(st: GovTaskStep) {
  const staged = task.value?.stage === 'architecture' || task.value?.stage === 'build'
  const effect = staged ? ' The card turns Blocked until you move it or close it.' : ''
  if (!confirm(`Cancel ${st.step_id} (${st.role || 'step'}, ${board.nameOf(st.assignee)})? The step stays in the record, marked cancelled.${effect}`)) return
  await board.cancelStep(st.step_id)
}

// A new note (his message, the agent's answer) scrolls the thread into view.
const body = ref<HTMLElement | null>(null)
watch(() => notes.value.length, (n, before) => {
  if (n > (before ?? 0)) nextTick(() => body.value?.scrollTo({ top: body.value.scrollHeight, behavior: 'smooth' }))
})

// After a write, set the select back to the row's value: a refused write leaves the row unchanged,
// and Vue doesn't re-render a select whose bound value didn't change.
async function onMove(e: Event) {
  const select = e.target as HTMLSelectElement
  await board.moveTask(props.taskId, select.value as Stage)
  if (card.value) select.value = card.value.stage
}
async function onAssign(e: Event) {
  const select = e.target as HTMLSelectElement
  await board.assign(props.taskId, select.value)
  if (task.value) select.value = task.value.assignee
}

// The details list: one row per field, label left and value right.
const details = computed(() => {
  const t = task.value
  const c = card.value
  if (!t || !c) return []
  return [
    { label: 'Project', value: t.project_id || 'None' },
    { label: 'Epic · milestone', value: [epicOf(c.tags), milestoneOf(c.tags)].filter(Boolean).map(planLabel).join(' · ') || 'Unplanned' },
    { label: 'Tags', value: plainTags(c.tags).length ? plainTags(c.tags).map(x => `#${x}`).join('  ') : 'None' },
    { label: 'Type', value: `${TASK_TYPE_LABELS[t.task_type]} · ${PRIORITY_LABELS[t.priority] ?? t.priority} priority` },
    { label: 'Due', value: t.due_at ? formatDate(t.due_at) : 'None' },
    { label: 'Approval', value: APPROVAL_LABELS[t.approval_state] },
    { label: 'Created', value: `${formatDateTime(t.created_at)} · ${board.nameOf(t.created_by)}` }
  ]
})

// Details start collapsed: the thread and the question get the room. Closes again when the panel moves to another card.
const detailsOpen = ref(false)
watch(() => props.taskId, () => { detailsOpen.value = false })

const labelCls = 'flex flex-col gap-1.5 text-[13px] font-semibold text-text2'
const selectCls = computed(() => [
  'h-11 rounded border border-input bg-surface px-2.5 font-normal text-ink',
  props.phone ? 'text-[15px]' : 'text-sm'
])
const heading = 'm-0 border-b-2 border-rule pb-1.5 font-display text-[20px] leading-none font-bold'
const headBtn = 'inline-flex h-10 max-md:h-11 max-md:min-w-11 justify-center cursor-pointer items-center gap-1.5 rounded px-2.5 text-sm font-semibold text-ink hover:bg-(--ab-row-hover)'
</script>

<template>
  <div v-if="card && task" class="flex h-dvh max-h-full min-h-0 flex-col bg-surface">
    <!-- Header: the ID and stage, the place in the list, and the card's own buttons -->
    <div class="flex items-center gap-1.5 border-b-2 border-rule bg-ground" :class="phone ? 'py-1.5 pr-1.5 pl-1' : 'py-2 pr-2.5 pl-5'">
      <button
        v-if="phone"
        type="button"
        aria-label="Back"
        class="inline-flex size-11 cursor-pointer items-center justify-center text-ink"
        @click="emit('close')"
      >
        <UIcon name="i-lucide-chevron-left" class="size-6" />
      </button>
      <span class="font-mono text-[13px] font-medium text-text2">{{ task.task_id }}</span>
      <span class="rounded-sm bg-(--ab-neutral-bg) px-1.5 py-px text-[13px] font-semibold text-text2">{{ STAGE_LABELS[card.stage] }}</span>
      <span v-if="!phone && order.index.value >= 0" class="ml-1 inline-flex items-center gap-0.5 text-[13px] text-text3">
        <span class="mr-1">{{ order.index.value + 1 }} of {{ order.ids.value.length }}</span>
        <button type="button" aria-label="Previous card (K)" title="Previous card ( K )" class="inline-flex size-8 cursor-pointer items-center justify-center rounded hover:bg-(--ab-row-hover)" @click="stepTo(-1)">
          <UIcon name="i-lucide-chevron-up" class="size-4" />
        </button>
        <button type="button" aria-label="Next card (J)" title="Next card ( J )" class="inline-flex size-8 cursor-pointer items-center justify-center rounded hover:bg-(--ab-row-hover)" @click="stepTo(1)">
          <UIcon name="i-lucide-chevron-down" class="size-4" />
        </button>
      </span>
      <span class="flex-1" />
      <button
        v-if="canPin"
        type="button"
        :class="headBtn"
        :aria-pressed="card.pinned"
        :title="card.pinned ? 'Let cleanup archive this card again' : 'Keep this card first in its column and out of cleanup'"
        @click="board.setPinned(task.task_id, !card.pinned)"
      >
        <UIcon :name="card.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin'" class="size-4" />
        <span :class="phone && 'sr-only'">{{ card.pinned ? 'Unpin' : 'Pin' }}</span>
      </button>
      <button
        v-if="!board.readOnly && !card.archived && task.work_state !== 'done'"
        type="button"
        :class="headBtn"
        @click="editor.edit(task.task_id)"
      >
        <UIcon name="i-lucide-pencil" class="size-4" />
        <span :class="phone && 'sr-only'">Edit</span>
      </button>
      <button
        v-if="!phone"
        type="button"
        aria-label="Close"
        title="Close ( Esc )"
        class="inline-flex size-10 cursor-pointer items-center justify-center rounded text-text2 hover:bg-(--ab-row-hover) hover:text-ink"
        @click="emit('close')"
      >
        <UIcon name="i-lucide-x" class="size-5" />
      </button>
    </div>

    <!-- Body -->
    <div ref="body" class="flex flex-1 flex-col overflow-y-auto" :class="phone ? 'gap-6 p-4' : 'gap-7 p-5'">
      <div class="flex flex-col gap-2.5">
        <h2 class="m-0 font-display leading-[1.08] font-bold" :class="phone ? 'text-[26px]' : 'text-[30px]'">{{ task.title }}</h2>
        <div class="flex flex-wrap items-center gap-2">
          <StatusPill v-if="card.pill" :pill="card.pill" :title="WORK_STATE_HELP[card.workState]" large />
          <span class="text-sm text-text2">{{ card.activity || (card.workState === 'backlog' ? 'Not started · move it to Architecture or Build to bring in an agent' : '') }}</span>
        </div>
      </div>

      <TicketNextMove :card="card" :phone="phone" @close="emit('close')" />

      <!-- Move and assign: the two changes made most often -->
      <div v-if="!board.readOnly" class="grid gap-3.5" :class="phone ? 'grid-cols-1' : 'grid-cols-2'">
        <label :class="labelCls">
          Stage
          <select id="ab-move" :class="selectCls" :value="card.stage" @change="onMove">
            <option v-for="s in STAGES" :key="s" :value="s">{{ STAGE_LABELS[s] }}</option>
          </select>
          <span v-if="moveNeedsApproval" role="status" class="font-normal" :style="{ color: WORK_STATE_PILLS.needs_input.fg }">{{ UNAPPROVED_PLAN_HINT }}</span>
        </label>
        <label :class="labelCls">
          Assignee
          <select id="ab-assign" :class="selectCls" :value="task.assignee" :disabled="task.work_state === 'done'" @change="onAssign">
            <option value="">Unassigned · open to claim</option>
            <option v-for="a in assignees" :key="a" :value="a" :disabled="board.agentOff(a)">{{ board.pickerName(a) }}</option>
          </select>
          <span v-if="card.classWarning" role="status" class="font-semibold text-(--ab-red-text)">{{ card.classWarning }}</span>
        </label>
        <p v-if="assignNote || assigneeNote" class="m-0 -mt-1.5 text-[13px] leading-normal text-text3" :class="!phone && 'col-span-2'">
          {{ assignNote }}<template v-if="assignNote && assigneeNote">{{ ' ' }}</template>{{ assigneeNote }}
        </p>
      </div>

      <section aria-labelledby="tk-details" class="flex flex-col">
        <h3 id="tk-details" :class="heading">
          <button type="button" class="flex min-h-6 max-md:min-h-11 w-full cursor-pointer items-center justify-between bg-transparent p-0 font-[inherit] text-[inherit] leading-[inherit] font-bold" :aria-expanded="detailsOpen" aria-controls="tk-details-list" @click="detailsOpen = !detailsOpen">
            Details
            <UIcon :name="detailsOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-5 text-text3" />
          </button>
        </h3>
        <dl v-show="detailsOpen" id="tk-details-list" class="m-0 grid grid-cols-[96px_minmax(0,1fr)] text-sm">
          <template v-if="board.readOnly">
            <dt class="border-b border-line py-2 text-text3">Stage</dt>
            <dd class="m-0 border-b border-line py-2">{{ STAGE_LABELS[card.stage] }}</dd>
            <dt class="border-b border-line py-2 text-text3">Assignee</dt>
            <dd class="m-0 border-b border-line py-2">{{ board.nameOf(task.assignee) }}</dd>
          </template>
          <template v-for="d in details" :key="d.label">
            <dt class="border-b border-line py-2 text-text3">{{ d.label }}</dt>
            <dd class="m-0 border-b border-line py-2 break-words">{{ d.value }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="taskSteps.length" aria-labelledby="tk-steps" class="flex flex-col">
        <h3 id="tk-steps" :class="heading">Steps <span class="text-text3">{{ taskSteps.length }}</span></h3>
        <ol class="m-0 list-none p-0">
          <li v-for="s in shownSteps" :key="s.step_id" class="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-line py-2.5 text-sm">
            <span class="size-2.5 flex-none rounded-full" :style="{ background: STEP_STATE_DOTS[s.step_state] }" />
            <span class="font-semibold">{{ s.role || `Step ${s.step_no}` }}</span>
            <span class="text-text2">{{ board.nameOf(s.assignee) }}</span>
            <span class="ml-auto text-[13px] font-semibold text-text2">{{ STEP_STATE_LABELS[s.step_state] }}</span>
            <button
              v-if="canCancel(s)"
              type="button"
              :aria-label="`Cancel ${s.step_id}`"
              class="h-8 cursor-pointer rounded px-2 text-[13px] font-semibold max-md:h-11 max-md:min-w-11 text-(--ab-red-text) hover:bg-(--ab-red-bg) disabled:cursor-default disabled:opacity-50"
              @click="cancelStep(s)"
            >
              Cancel
            </button>
            <span class="w-full pl-[18px] font-mono text-xs text-text3">{{ s.step_id }}<template v-if="s.lease_owner"> · lease {{ s.lease_owner }} · claims {{ s.claim_count }}</template><template v-if="s.heartbeat_at"> · heartbeat {{ formatDateTime(s.heartbeat_at) }}</template></span>
            <span v-if="s.output_summary" class="w-full pl-[18px] text-[13px] text-text2 break-words whitespace-pre-line">{{ AGENT_NOTE_LABEL }}: {{ s.output_summary }}</span>
            <span v-if="s.budget_used" class="w-full pl-[18px] text-[13px] text-text2">{{ BUDGET_USED_LABEL }}: {{ s.budget_used }}</span>
          </li>
        </ol>
        <button
          v-if="chatCount"
          type="button"
          class="cursor-pointer self-start py-2 text-xs font-semibold text-approve hover:underline"
          :aria-expanded="showChat"
          @click="showChat = !showChat"
        >
          {{ chatStepsLabel(chatCount, showChat) }}
        </button>
      </section>

      <section aria-labelledby="tk-done" class="flex flex-col gap-2">
        <h3 id="tk-done" :class="heading">Done when</h3>
        <ul v-if="requirements.length" class="m-0 flex list-none flex-col gap-1.5 p-0 text-sm leading-normal">
          <li v-for="r in requirements" :key="r" class="flex gap-2">
            <UIcon :name="card.workState === 'done' ? 'i-lucide-square-check' : 'i-lucide-square'" class="mt-0.5 size-4 flex-none text-text3" />
            <span>{{ r }}</span>
          </li>
        </ul>
        <p v-else class="m-0 text-sm text-text3">None yet. Edit the card to say what done means.</p>
      </section>

      <section aria-labelledby="tk-request" class="flex flex-col gap-2">
        <h3 id="tk-request" :class="heading">Original request</h3>
        <p class="m-0 border-l-4 border-line pl-3 text-sm leading-[1.55] whitespace-pre-line text-text2">{{ task.original_request }}</p>
      </section>

      <section aria-labelledby="tk-thread" class="flex flex-col gap-3.5">
        <h3 id="tk-thread" :class="heading">Thread <span class="text-text3">{{ notes.length }}</span></h3>
        <NoteThread :notes="notes" :phone="phone" />
      </section>
    </div>

    <TicketComposer v-if="!board.readOnly && !card.archived" :task-id="taskId" :phone="phone" />
  </div>
</template>
