<script setup lang="ts">
// The full ticket form, for a new ticket (create_task, then assign) or an existing one (update_task, assign).
// original_request and the approval gate are set once at creation (schema/tables.json), so editing shows them read only.
// Layout (direction B): what the work is (title, done when), then who and when (assignee, priority, due), then the
// filing fields folded under "More details", open by default when editing. Cmd or Ctrl+Enter saves from any field: on a
// new ticket it is "Create and start" (create, assign, start); on an existing one it saves the changes.
import type { TicketFields } from '~/stores/board'
import { boardOwner, PRIORITIES, PRIORITY_LABELS, REGISTER_API_AGENT_HINT, REGISTER_API_AGENT_LABEL, TASK_TYPE_LABELS } from '~/types/board'
import { splitRequirements } from '~/utils/format'
import type { PlanKind } from '~/utils/planning'
import { epicOf, kindOfTag, milestoneOf, planLabel, plainTags, setPlanTag } from '~/utils/planning'

const props = defineProps<{ phone?: boolean }>()
const emit = defineEmits<{ created: [taskId: string] }>()
const board = useBoardStore()
const { open, taskId, project } = useTicketEditor()
const access = useAccess()
onMounted(() => access.load())

const editing = computed(() => board.tasks.find(t => t.task_id === taskId.value))
// Editing needs update_task on the gateway; the assignee alone still saves through assign.
const fieldsLocked = computed(() => !!editing.value && !board.canUse('update_task'))

const blankForm = (): TicketFields => ({
  title: '', project_id: '', board_id: '', task_type: 'build', priority: 'normal', tags: '', due_at: '',
  acceptance_requirements: '', original_request: '', approval_state: 'not_required', assignee: ''
})
const form = reactive<TicketFields>(blankForm())

// acceptance_requirements is stored with " | " between lines; the form shows one per line and joins them on save.
const requirementsText = ref('')
const joinRequirements = () => requirementsText.value.split('\n').map(l => l.trim()).filter(Boolean).join(' | ')
// <input type="date"> wants YYYY-MM-DD; the row keeps whatever date the gateway stored.
const dueDay = computed({
  get: () => form.due_at ? form.due_at.slice(0, 10) : '',
  set: (v: string) => { form.due_at = v }
})

// Bumped on every open so "More details" starts folded again (or open, when editing) instead of keeping a hand toggle.
const openRun = ref(0)
watch(open, (isOpen) => {
  if (!isOpen) return
  openRun.value++
  Object.assign(form, blankForm())
  const t = editing.value
  if (t) {
    Object.assign(form, {
      title: t.title, project_id: t.project_id, board_id: t.board_id ?? '', task_type: t.task_type, priority: t.priority || 'normal',
      tags: t.tags ?? '', due_at: t.due_at ?? '', acceptance_requirements: t.acceptance_requirements,
      original_request: t.original_request, approval_state: t.approval_state, assignee: t.assignee
    })
  }
  else form.project_id = project.value // a project lane's "New card" starts in that project
  requirementsText.value = splitRequirements(form.acceptance_requirements).join('\n')
})

const projects = computed(() => [...new Set(board.tasks.map(t => t.project_id).filter(Boolean))].sort())
// Tag suggestions: the most used tags not on the ticket yet, a dozen at most, so the row stays one glance long.
const knownTags = computed(() => {
  const uses = new Map<string, number>()
  for (const t of plainTags(board.cards.flatMap(c => c.tags))) uses.set(t, (uses.get(t) ?? 0) + 1)
  const picked = tagList()
  return [...uses].filter(([t]) => !picked.includes(t)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([t]) => t)
})
// One line under "More details" so the folded fields still say what they hold.
const detailsLine = computed(() => [
  form.project_id || 'No project', TASK_TYPE_LABELS[form.task_type as keyof typeof TASK_TYPE_LABELS] ?? form.task_type, epicField.value ? `Epic ${epicField.value}` : '',
  milestoneField.value ? `${milestoneKind.value === 'release' ? 'Release' : 'Milestone'} ${milestoneField.value}` : '',
  tagList().length ? `${tagList().length} tag${tagList().length === 1 ? '' : 's'}` : ''
].filter(Boolean).join(' · '))

// Epic and milestone/release are kept in the tags (utils/planning.ts); these fields read and write that slot.
const tagList = () => form.tags.split(',').map(t => t.trim()).filter(Boolean)
const slotField = (kind: 'epic' | 'milestone') => computed({
  get: () => planLabel(kind === 'epic' ? epicOf(tagList()) : milestoneOf(tagList())),
  // The milestone slot keeps the kind picked beside it (milestone or release).
  set: (v: string) => { form.tags = setPlanTag(tagList(), kind === 'epic' ? 'epic' : milestoneKind.value, v).join(', ') }
})
const epicField = slotField('epic')
const milestoneField = slotField('milestone')
// Kind of the milestone slot: a release when its tag starts rel-, else a milestone. Typing a name keeps the kind.
const pickedKind = ref<'milestone' | 'release'>('milestone')
const milestoneKind = computed({
  get: () => milestoneOf(tagList()) ? (kindOfTag(milestoneOf(tagList())) as 'milestone' | 'release') : pickedKind.value,
  set: (k: 'milestone' | 'release') => { pickedKind.value = k; form.tags = setPlanTag(tagList(), k, milestoneField.value).join(', ') }
})
const plan = usePlanning()
const knownPlan = (kinds: PlanKind[]) => [...new Set([...plan.items.value, ...board.cards.flatMap(c => c.tags).map(t => ({ tag: t, kind: kindOfTag(t) }))]
  .filter(p => p.kind && kinds.includes(p.kind)).map(p => planLabel(p.tag)))].sort()
const knownEpics = computed(() => knownPlan(['epic']))
const knownMilestones = computed(() => knownPlan(['milestone', 'release']))
const assignees = computed(() => [
  boardOwner(),
  ...board.registry.filter(a => a.lifecycle_status === 'active' && a.agent_type !== 'gateway').map(a => a.agent_id)
])
// The class rule for the agent picked, against the tags typed so far.
const classWarning = computed(() => board.classWarningFor(form.tags.split(',').map(t => t.trim()).filter(Boolean), form.assignee))
// Tags are lowercase slugs (create_task refuses anything else); fix the easy cases as he types.
function normalizeTags() {
  form.tags = form.tags.split(',').map(t => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean).join(', ')
}
function addTag(tag: string) {
  const list = form.tags.split(',').map(t => t.trim()).filter(Boolean)
  if (!list.includes(tag)) form.tags = [...list, tag].join(', ')
}

const saving = ref(false)
// "Plan first" sends a Create and start card to Architecture instead of Build.
const planFirst = ref(false)
watch(open, (isOpen) => { if (isOpen) planFirst.value = false })
// A card that needs approval first can't be started, so Create and start waits for the approval and only Create is offered.
const canRun = computed(() => !editing.value && form.approval_state !== 'pending')
async function submit() {
  if (!form.title.trim() || saving.value) return
  normalizeTags()
  form.acceptance_requirements = joinRequirements()
  saving.value = true
  try {
    if (editing.value) {
      const patch: Partial<TicketFields> = fieldsLocked.value ? { assignee: form.assignee } : { ...form, due_at: dueDay.value }
      if (await board.updateTask(editing.value.task_id, patch)) open.value = false
    } else {
      const id = await board.createTask({ ...form, due_at: dueDay.value })
      if (id) {
        open.value = false
        emit('created', id)
      }
    }
  } finally {
    saving.value = false
  }
}

// Create and start: create, assign by rule when blank, then start. One click, one write sequence.
async function run() {
  if (!form.title.trim() || saving.value) return
  normalizeTags()
  form.acceptance_requirements = joinRequirements()
  saving.value = true
  try {
    const id = await board.runTicket({ ...form, due_at: dueDay.value }, planFirst.value)
    if (id) {
      open.value = false
      emit('created', id)
    }
  }
  finally {
    saving.value = false
  }
}
// Cmd or Ctrl+Enter: Create and start on a new ticket that can run, else the plain save.
const shortcut = () => canRun.value ? run() : submit()

const labelCls = 'flex flex-col gap-1.5 text-[13px] font-semibold text-text2'
const fieldCls = computed(() => [
  'rounded border border-input bg-surface px-2.5 font-normal text-ink disabled:bg-chip disabled:text-text3',
  props.phone ? 'text-[15px]' : 'text-sm'
])
</script>

<template>
  <UModal
    v-model:open="open"
    :title="editing ? `Edit card ${editing.task_id}` : 'New card'"
    :description="editing ? 'Changes save to the card' : 'Goes to the top of Backlog'"
    :fullscreen="phone"
    :ui="{
      content: phone ? 'bg-surface' : 'sm:max-w-2xl rounded-md bg-surface ring-0 shadow-[0_24px_48px_-12px_rgba(15,26,42,0.45)]',
      header: 'border-b-2 border-rule',
      title: 'font-display text-[26px] leading-none font-bold text-ink',
      description: 'text-sm text-text3',
      footer: 'border-t border-line'
    }"
  >
    <template #body>
      <form id="ticket-form" class="flex flex-col gap-5" @submit.prevent="submit" @keydown.meta.enter.prevent="shortcut" @keydown.ctrl.enter.prevent="shortcut">
        <p v-if="fieldsLocked" class="m-0 rounded border border-dashed border-dash bg-filterbar px-3 py-2 text-[13px] text-text2">
          Only the assignee can change until the write gateway supports editing (update_task).
        </p>

        <!-- What the work is -->
        <label :class="labelCls">
          Title
          <input
            v-model="form.title"
            required
            maxlength="200"
            autofocus
            :disabled="fieldsLocked"
            placeholder="What needs doing?"
            class="h-12 text-[19px] font-semibold"
            :class="fieldCls"
          >
        </label>

        <label :class="labelCls">
          <span>Done when <span class="font-normal text-text3">· one check per line</span></span>
          <textarea v-model="requirementsText" rows="3" :disabled="fieldsLocked" placeholder="What done means, in lines someone can check" class="resize-y py-2.5 leading-[1.45]" :class="fieldCls" />
        </label>

        <!-- Who and when -->
        <div class="grid gap-3.5" :class="phone ? 'grid-cols-1' : 'grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]'">
          <label :class="labelCls">
            Assignee
            <select v-model="form.assignee" class="h-11" :class="fieldCls">
              <option value="">Unassigned · open to claim</option>
              <option v-for="a in assignees" :key="a" :value="a" :disabled="board.agentOff(a)">{{ board.pickerName(a) }}</option>
            </select>
          </label>
          <label :class="labelCls">
            Priority
            <select v-model="form.priority" :disabled="fieldsLocked" class="h-11" :class="fieldCls">
              <option v-for="p in PRIORITIES" :key="p" :value="p">{{ PRIORITY_LABELS[p] }}</option>
              <option v-if="form.priority && !(PRIORITIES as readonly string[]).includes(form.priority)" :value="form.priority">{{ form.priority }}</option>
            </select>
          </label>
          <label :class="labelCls">
            Due date
            <input v-model="dueDay" type="date" :disabled="fieldsLocked" class="h-11" :class="fieldCls">
          </label>
        </div>
        <div class="-mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span v-if="classWarning" role="status" class="font-semibold text-(--ab-red-text)">{{ classWarning }}</span>
          <!-- Opens the registry form with the API agent fields filled. There is no key field: the key is an n8n credential. -->
          <NuxtLink :to="{ path: '/registry/new', query: { lane: 'api' } }" :title="REGISTER_API_AGENT_HINT" class="text-accent underline-offset-2 hover:underline">{{ REGISTER_API_AGENT_LABEL }}</NuxtLink>
        </div>

        <!-- Filing: folded for a new ticket so the first screen stays short; open when editing. -->
        <details :key="openRun" class="group border-y border-line" :open="!!editing">
          <summary class="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden">
            <UIcon name="i-lucide-chevron-right" class="size-4 flex-none text-text3 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            <span class="text-sm font-semibold text-ink">More details</span>
            <span class="min-w-0 truncate text-[13px] text-text3">{{ detailsLine }}</span>
          </summary>
          <div class="flex flex-col gap-3.5 pt-1 pb-4">
            <div class="grid gap-3.5" :class="phone ? 'grid-cols-1' : 'grid-cols-2'">
              <label :class="labelCls">
                Project
                <input v-model="form.project_id" list="ticket-projects" :disabled="fieldsLocked" placeholder="None" class="h-11" :class="fieldCls">
                <datalist id="ticket-projects">
                  <option v-for="p in projects" :key="p" :value="p" />
                </datalist>
              </label>
              <label :class="labelCls">
                Type
                <!-- An upgrade goes through the orchestrator, so the board offers the other two. -->
                <select v-model="form.task_type" :disabled="fieldsLocked || form.task_type === 'upgrade'" class="h-11" :class="fieldCls">
                  <option value="build">{{ TASK_TYPE_LABELS.build }}</option>
                  <option value="operational">{{ TASK_TYPE_LABELS.operational }}</option>
                  <option v-if="form.task_type === 'upgrade'" value="upgrade">{{ TASK_TYPE_LABELS.upgrade }}</option>
                </select>
              </label>
              <label v-if="access.boards.value.length > 1" :class="labelCls">
                Board
                <select v-model="form.board_id" :disabled="fieldsLocked" class="h-11" :class="fieldCls">
                  <option v-for="b in access.boards.value" :key="b" :value="b === 'main' ? '' : b">{{ b }}</option>
                </select>
              </label>
              <label :class="labelCls">
                Epic
                <input v-model="epicField" list="ticket-epics" :disabled="fieldsLocked" placeholder="None" class="h-11" :class="fieldCls">
                <datalist id="ticket-epics">
                  <option v-for="e in knownEpics" :key="e" :value="e" />
                </datalist>
              </label>
              <label :class="labelCls">
                <span class="flex items-center gap-2">
                  <select v-model="milestoneKind" :disabled="fieldsLocked" aria-label="Milestone or release" class="rounded border-0 bg-transparent p-0 text-[13px] font-semibold">
                    <option value="milestone">Milestone</option>
                    <option value="release">Release</option>
                  </select>
                </span>
                <input v-model="milestoneField" list="ticket-milestones" :disabled="fieldsLocked" placeholder="None" class="h-11" :class="fieldCls">
                <datalist id="ticket-milestones">
                  <option v-for="m in knownMilestones" :key="m" :value="m" />
                </datalist>
              </label>
            </div>
            <label :class="labelCls">
              Tags
              <input
                v-model="form.tags"
                :disabled="fieldsLocked"
                placeholder="comma, separated, slugs"
                class="h-11"
                :class="fieldCls"
                @blur="normalizeTags"
              >
            </label>
            <div v-if="knownTags.length && !fieldsLocked" class="-mt-2 flex flex-wrap items-center gap-1 text-[13px]">
              <span class="mr-1 text-text3">Most used:</span>
              <button
                v-for="t in knownTags"
                :key="t"
                type="button"
                class="cursor-pointer rounded-sm bg-(--ab-neutral-bg) px-1.5 py-0.5 text-xs text-text2 hover:text-ink"
                @click="addTag(t)"
              >#{{ t }}</button>
            </div>
            <label v-if="!editing" :class="labelCls">
              <span>Original request <span class="font-normal text-text3">· saved as written, never edited later. Blank uses the title.</span></span>
              <textarea v-model="form.original_request" rows="3" placeholder="Paste the ask in its own words" class="resize-y py-2.5 leading-[1.45]" :class="fieldCls" />
            </label>
          </div>
        </details>

        <div v-if="editing" class="flex flex-col gap-1.5">
          <span class="text-[13px] font-semibold text-text2">Original request <span class="font-normal text-text3">· not editable</span></span>
          <p class="m-0 rounded bg-chip px-3 py-2.5 text-sm leading-[1.5] whitespace-pre-line text-text2">{{ form.original_request }}</p>
        </div>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap items-center gap-x-4 gap-y-2">
        <label v-if="!editing" class="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-text2">
          <input
            type="checkbox"
            class="size-4 accent-ink"
            :checked="form.approval_state === 'pending'"
            @change="form.approval_state = ($event.target as HTMLInputElement).checked ? 'pending' : 'not_required'"
          >
          Needs my approval before agents start
        </label>
        <label v-if="!editing" class="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-text2">
          <input v-model="planFirst" type="checkbox" class="size-4 accent-ink">
          Plan first
        </label>
        <span class="flex-1" />
        <kbd v-if="!phone" class="font-sans text-xs text-text3">⌘ Enter</kbd>
        <button type="button" class="h-11 cursor-pointer rounded px-4 text-sm font-semibold text-text2 hover:bg-(--ab-row-hover)" @click="open = false">Cancel</button>
        <button
          type="submit"
          form="ticket-form"
          :disabled="!form.title.trim() || saving"
          :class="editing ? 'bg-ink text-surface' : 'border border-input bg-surface text-ink'"
          class="h-11 cursor-pointer rounded px-[18px] text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {{ saving ? 'Saving…' : editing ? 'Save changes' : 'Create card' }}
        </button>
        <button
          v-if="!editing"
          type="button"
          :disabled="!canRun || !form.title.trim() || saving"
          :title="canRun ? 'Create, assign and start in one step' : 'Needs your approval first, so it cannot start yet'"
          class="h-11 cursor-pointer rounded bg-ink px-[18px] text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
          @click="run"
        >
          Create and start
        </button>
      </div>
    </template>
  </UModal>
</template>
