<script setup lang="ts">
// The bar that appears while cards are checked (Board v4): one row on a desktop. Pick one edit, see how many
// cards it changes, apply it, or export the picked cards.
// Edits are the ones a single card already has (move, assign, priority, type, project, due date, tag, approve, pin,
// archive). The runner is
// useBulkEdit; every card is its own write, so the gateway's permission and stale checks apply to each.
import type { CardView } from '~/stores/board'
import type { BulkKind } from '~/types/board'
import {
  BULK_KINDS, BULK_LABELS, BULK_OPS, boardOwner, PRIORITIES, PRIORITY_LABELS, STAGES, STAGE_LABELS, TASK_TYPES, TASK_TYPE_LABELS
} from '~/types/board'
import { editReady, normalizeTag } from '~/utils/bulk'
import type { BulkResult } from '~/composables/useBulkEdit'

const props = defineProps<{ cards: CardView[], phone?: boolean }>()
const board = useBoardStore()
const toast = useToast()
const selection = useBulkSelection()
const bulk = useBulkEdit()

const visibleIds = computed(() => props.cards.map(c => c.task.task_id))
// A filter or a write can hide a checked card; an edit never reaches one the user can't see.
watch(visibleIds, ids => selection.prune(ids))

const picked = computed(() => props.cards.filter(c => selection.has(c.task.task_id)))
const open = computed(() => selection.selected.value.length > 0 || selection.reveal.value)
const exportAny = useCsvExport()

// Stage moves and assign are plain gateway ops; the rest are proposed ops that may not be live yet.
const kinds = computed(() => BULK_KINDS.filter((k) => {
  const op = BULK_OPS[k]
  return k !== 'delete' && !board.readOnly && (!op || board.canUse(op))
}))

const kind = ref<BulkKind>('stage')
const value = ref('')
watch(kind, () => { value.value = '' })
watch(kinds, (list) => { if (!list.includes(kind.value)) kind.value = list[0] ?? 'stage' })

const isTag = computed(() => kind.value === 'add_tag' || kind.value === 'remove_tag')
const edit = computed(() => ({ kind: kind.value, value: isTag.value ? normalizeTag(value.value) : value.value }))
const plan = computed(() => bulk.plan(picked.value, edit.value))
const ready = computed(() => editReady(edit.value) && picked.value.length > 0 && plan.value.run.length > 0 && !bulk.progress.value && !board.writing)

const assignees = computed(() => [boardOwner(), ...board.registry.filter(a => a.lifecycle_status === 'active' && a.agent_type !== 'gateway').map(a => a.agent_id)])
const projects = computed(() => [...new Set(board.tasks.map(t => t.project_id).filter(Boolean))].sort())
// Remove tag offers the tags the picked cards carry; add tag offers every tag on the board.
const tags = computed(() => [...new Set((kind.value === 'remove_tag' ? picked.value : board.cards).flatMap(c => c.tags))].sort())

const result = ref<BulkResult | null>(null)
watch([kind, value], () => { result.value = null })

async function apply() {
  const { run } = plan.value
  const n = run.length
  const what = `${n} card${n === 1 ? '' : 's'}`
  const writes = `This runs ${n} write${n === 1 ? '' : 's'}, one per card.`
  const sure = kind.value === 'archive' || kind.value === 'approve' || (kind.value === 'stage' && value.value === 'done')
  if (sure && !confirm(
    kind.value === 'archive'
      ? `Archive ${what}? They leave the board; their rows stay in the tables. ${writes}`
      : kind.value === 'approve'
        ? `Approve ${what}? Each one's approval opens and its work can start. ${writes}`
        : `Move ${what} to Done? ${writes}`
  )) return
  const r = await bulk.run(picked.value, edit.value)
  result.value = r
  if (r.stoppedAt) toast.add({ title: `Changed ${r.done} of ${r.of}`, description: `Stopped at ${r.stoppedAt}.`, color: 'error' })
  else toast.add({ title: `Changed ${r.done} card${r.done === 1 ? '' : 's'}`, color: 'neutral' })
  // Keep only the cards that were skipped or not reached, so a retry doesn't need a new selection.
  selection.selected.value = selection.selected.value.filter(id => r.stoppedAt ? (!run.slice(0, r.done).includes(id)) : !run.includes(id))
}

// Delete takes every picked card off the board, whatever its stage. The gateway has no hard delete (the app never writes
// the tables), so each card is cancelled, moved to Done, unpinned and archived (board.remove): the rows stay in the
// tables and the Archived toggle shows them again. The confirm names the count and the cards still in progress.
async function remove() {
  const n = picked.value.length
  const live = picked.value.filter(c => c.workState !== 'done').length
  const extra = live ? ` ${live} not Done yet: their open steps are cancelled first.` : ''
  if (!confirm(`Delete ${n} card${n === 1 ? '' : 's'}? They leave the board.${extra} Several writes per card; the Archived toggle shows them again.`)) return
  const r = await bulk.run(picked.value, { kind: 'delete', value: '' })
  result.value = r
  if (r.stoppedAt) toast.add({ title: `Deleted ${r.done} of ${r.of}`, description: `Stopped at ${r.stoppedAt}.`, color: 'error' })
  else toast.add({ title: `Deleted ${r.done} card${r.done === 1 ? '' : 's'}`, color: 'neutral' })
}
const canDelete = computed(() => !board.readOnly && board.canUse('archive_task') && !bulk.progress.value && !board.writing)

const field = 'ab-select h-9 min-w-0 rounded-lg px-2 text-[13px]'
</script>

<template>
  <section
    v-if="open"
    aria-label="Bulk edit"
    class="fixed z-40 flex items-center gap-x-3 gap-y-2 border border-line bg-surface shadow-[0_8px_24px_rgba(16,24,40,0.18)]"
    :class="phone ? 'inset-x-0 bottom-[calc(148px+env(safe-area-inset-bottom))] mx-3 flex-wrap rounded-xl p-3' : 'inset-x-4 bottom-4 mx-auto w-fit rounded-xl px-3 py-1.5 whitespace-nowrap'"
  >
    <strong class="text-sm" role="status">{{ selection.selected.value.length }} selected</strong>
    <button type="button" class="h-8 cursor-pointer text-xs font-semibold text-approve" @click="selection.toggleAll(visibleIds)">
      {{ selection.stateFor(visibleIds) === 'all' ? 'Select none' : `Select all ${visibleIds.length} shown` }}
    </button>

    <template v-if="selection.selected.value.length">
      <select v-model="kind" aria-label="Edit" :class="field">
        <option v-for="k in kinds" :key="k" :value="k">{{ BULK_LABELS[k] }}</option>
      </select>

      <select v-if="kind === 'stage'" v-model="value" aria-label="Stage" :class="field">
        <option value="" disabled>Choose…</option>
        <option v-for="s in STAGES" :key="s" :value="s">{{ STAGE_LABELS[s] }}</option>
      </select>
      <select v-else-if="kind === 'assignee'" v-model="value" aria-label="Assignee" :class="field">
        <option value="">Unassigned · open to claim</option>
        <option v-for="a in assignees" :key="a" :value="a" :disabled="board.agentOff(a)">{{ board.pickerName(a) }}</option>
      </select>
      <select v-else-if="kind === 'priority'" v-model="value" aria-label="Priority" :class="field">
        <option value="" disabled>Choose…</option>
        <option v-for="p in PRIORITIES" :key="p" :value="p">{{ PRIORITY_LABELS[p] }}</option>
      </select>
      <select v-else-if="kind === 'task_type'" v-model="value" aria-label="Type" :class="field">
        <option value="" disabled>Choose…</option>
        <option v-for="t in TASK_TYPES.filter(x => x !== 'upgrade')" :key="t" :value="t">{{ TASK_TYPE_LABELS[t] }}</option>
      </select>
      <template v-else-if="kind === 'project_id' || isTag">
        <input
          v-model="value"
          :list="kind === 'project_id' ? 'ab-bulk-projects' : 'ab-bulk-tags'"
          :aria-label="kind === 'project_id' ? 'Project' : 'Tag'"
          :placeholder="kind === 'project_id' ? 'Project' : 'tag-name'"
          autocomplete="off"
          :class="field"
          class="w-40"
        >
        <datalist id="ab-bulk-projects"><option v-for="p in projects" :key="p" :value="p" /></datalist>
        <datalist id="ab-bulk-tags"><option v-for="t in tags" :key="t" :value="t" /></datalist>
      </template>
      <input v-else-if="kind === 'due_at'" v-model="value" type="date" aria-label="Due date" :class="field" class="w-40">

      <button
        type="button"
        :disabled="!ready"
        class="inline-flex h-9 cursor-pointer items-center rounded-lg bg-ink px-3 text-[13px] font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-40"
        @click="apply"
      >
        <template v-if="bulk.progress.value">Working {{ bulk.progress.value.n }} of {{ bulk.progress.value.of }}…</template>
        <template v-else>Apply to {{ plan.run.length }}</template>
      </button>
      <span v-if="plan.skipped.length" class="text-xs text-text3" :title="plan.skipped.map(s => `${s.id}: ${s.why}`).join('\n')">
        {{ plan.skipped.length }} skipped ({{ [...new Set(plan.skipped.map(s => s.why))].join(', ') }})
      </span>
      <span v-if="result" role="status" class="text-xs" :class="result.stoppedAt ? 'font-semibold text-(--ab-red-text)' : 'text-text2'">
        Changed {{ result.done }} of {{ result.of }}<template v-if="result.stoppedAt">. Stopped at {{ result.stoppedAt }}: {{ result.reason }}. The rest were not touched.</template>
      </span>
      <button
        v-if="canDelete"
        type="button"
        class="inline-flex h-9 cursor-pointer items-center rounded-lg border border-line px-3 text-[13px] font-semibold text-(--ab-red-text)"
        @click="remove"
      >
        Delete {{ selection.selected.value.length }}
      </button>
      <button
        type="button"
        aria-label="Export selected"
        title="Export selected as CSV"
        class="ab-ghost inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-line"
        @click="exportAny(picked, 'The cards picked now.')"
      >
        <UIcon name="i-lucide-download" class="size-4" />
      </button>
    </template>
    <button type="button" class="h-8 cursor-pointer text-xs font-semibold text-text2" :class="!phone && 'ml-auto'" @click="selection.clear()">Done</button>
  </section>
</template>
