<script setup lang="ts">
import type { CardView } from '~/stores/board'
import { APPROVAL_BADGE, ATTENTION_DOT, stepSummaryLabel, APPROVAL_LABELS, MOVE_SIGNALS, PRIORITY_BADGES, STEP_STATE_DOTS, STEP_STATE_LABELS, WORK_STATE_HELP } from '~/types/board'
import { isOverdue, cardNeedsAttention } from '~/utils/attention'
import { stepCounts } from '~/utils/steps'
import { formatDate } from '~/utils/format'
import { normalizePriority, priorityLabel } from '~/utils/priority'
import { epicOf, KIND_LABELS, kindOfTag, milestoneOf, planLabel, plainTags } from '~/utils/planning'

const props = defineProps<{ card: CardView, phone?: boolean }>()
const emit = defineEmits<{ open: [taskId: string] }>()
const board = useBoardStore()
// Selection (Board v4): a checkbox chip on the card's top-left corner, shown on hover or focus, and on
// every card once any is picked. A click on the card still opens the ticket; X toggles the focused card.
const selection = useBulkSelection()
const { density } = useSettings()
const checked = computed(() => selection.has(props.card.task.task_id))
const anyPicked = computed(() => selection.selected.value.length > 0 || selection.reveal.value)
const canPick = computed(() => !board.readOnly)

// Step chips only when more than one agent works the card.
// Done vs open across the card's steps; nothing when the card has none.
const counts = computed(() => stepCounts(props.card.steps))
const chips = computed(() => props.card.steps.length > 1 ? props.card.steps : [])
const priority = computed(() => PRIORITY_BADGES[normalizePriority(props.card.task.priority)])
// A blocked card shows the plain reason in place of the agent's raw words (the drawer keeps both).
const line = computed(() => (props.card.workState === 'blocked' && props.card.explain?.short) || props.card.activity)
const overdue = computed(() => isOverdue(props.card))
// Compact hides the badges, so one red dot stands in for them.
const dot = computed(() => density.value === 'compact' && cardNeedsAttention(props.card))
</script>

<template>
  <article
    :data-id="card.task.task_id"
    class="ab-ticket group relative flex flex-col rounded-[2px_2px_6px_6px] border bg-surface"
    :class="[phone ? 'p-3.5' : 'p-3', density === 'compact' ? 'ab-compact' : 'gap-2']"
    :style="checked ? { borderColor: 'var(--ab-pick-border)', background: 'var(--ab-pick-bg)' } : { borderColor: `var(--ab-report-accent, ${card.border})`, boxShadow: card.shadow }"
  >
    <!-- Picked cards use --ab-pick-border and --ab-pick-bg (PALETTE in types/board.ts). The chip takes no layout space. -->
    <label
      v-if="canPick && !phone"
      class="absolute -top-[7px] -left-[7px] z-10 inline-flex size-[22px] cursor-pointer items-center justify-center rounded-md border border-input bg-surface group-focus-within:opacity-100 group-hover:opacity-100"
      :class="checked || anyPicked ? 'opacity-100' : 'opacity-0'"
      @click.stop
    >
      <input
        type="checkbox"
        class="size-3.5 cursor-pointer accent-(--color-accent)"
        :checked="checked"
        :aria-label="`Select ${card.task.task_id}`"
        @click="selection.toggle(card.task.task_id)"
      >
    </label>
    <div class="flex items-center gap-1.5 text-xs text-text3">
      <SelectBox v-if="phone && canPick && anyPicked" class="-my-1.5 -ml-2" :checked="checked" :label="`Select ${card.task.task_id}`" phone @toggle="selection.toggle(card.task.task_id)" />
      <span class="font-mono font-medium text-text2">{{ card.task.task_id }}</span>
      <span v-if="card.task.project_id" class="truncate">{{ card.task.project_id }}</span>
      <span
        v-if="dot"
        role="img"
        class="ml-auto size-2 shrink-0 rounded-full"
        :style="{ background: ATTENTION_DOT.color }"
        :aria-label="ATTENTION_DOT.label"
        :title="ATTENTION_DOT.label"
      />
      <span class="inline-flex" :class="dot ? '' : 'ml-auto'">
        <AgentAvatar :id="card.assignee" :size="phone ? 26 : 24" />
      </span>
    </div>

    <h3 class="m-0 font-semibold leading-[1.35]" :class="phone ? 'text-[15px]' : 'text-sm'">
      <!-- The ::after overlay makes the whole card clickable while keeping a real button. -->
      <button
        type="button"
        class="cursor-pointer text-left after:absolute after:inset-0 after:rounded-[2px_2px_6px_6px] after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
        @click="emit('open', card.task.task_id)"
      >
        {{ card.task.title }}
      </button>
    </h3>

    <!-- A click on this card the server has not answered yet. The card already shows the result. -->
    <span v-if="board.isSaving(card.task.task_id)" role="status" class="text-xs font-semibold text-text3">Saving...</span>

    <div v-if="card.pill || card.approvalPending || card.stranded" class="ab-full flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <!-- Marked so it can't hide in Running: no agent will ever pick this card up as it stands. -->
      <span
        v-if="card.stranded"
        class="rounded-sm px-1.5 py-px text-xs font-semibold"
        :style="{ background: MOVE_SIGNALS.stranded!.bg, color: MOVE_SIGNALS.stranded!.fg }"
        :title="card.stranded"
      >{{ MOVE_SIGNALS.stranded!.label }}</span>
      <StatusPill v-if="card.pill" :pill="card.pill" :title="WORK_STATE_HELP[card.workState]" />
      <span
        v-if="card.approvalPending"
        class="rounded px-1.5 py-px text-xs font-semibold"
        :style="{ background: APPROVAL_BADGE.bg, color: APPROVAL_BADGE.fg, border: `1px solid ${APPROVAL_BADGE.border}` }"
      >{{ APPROVAL_LABELS.pending }}</span>
      <span v-if="line" class="ab-activity text-xs leading-[1.4] text-text3">{{ line }}</span>
    </div>

    <p v-if="card.classWarning" role="status" class="ab-full m-0 text-xs leading-[1.4] font-semibold text-(--ab-red-text)">{{ card.classWarning }}</p>
    <p v-else-if="card.stranded" class="ab-full m-0 text-xs leading-[1.4] font-semibold text-text2">{{ card.stranded }}</p>

    <p v-if="card.heldBy" class="ab-full m-0 text-xs leading-[1.4] text-text2">
      Assigned to {{ board.nameOf(card.task.assignee) }}, step held by {{ board.nameOf(card.heldBy) }}
    </p>

    <p v-if="card.steps.length" class="ab-full m-0 text-xs text-text3">{{ stepSummaryLabel(counts.done, counts.open) }}</p>

    <ul v-if="chips.length" class="ab-full m-0 flex list-none flex-col gap-1 p-0" aria-label="Steps">
      <li
        v-for="s in chips"
        :key="s.step_id"
        class="flex items-center gap-1.5 rounded-md bg-chip px-1.5 py-1 text-xs text-text2"
      >
        <span class="size-1.5 shrink-0 rounded-full" :style="{ background: STEP_STATE_DOTS[s.step_state] }" />
        <span class="font-semibold">{{ s.role || `step ${s.step_no}` }}</span>
        <span aria-hidden="true">·</span>
        <span class="truncate">{{ board.nameOf(s.assignee) }}</span>
        <span class="ml-auto font-mono">{{ STEP_STATE_LABELS[s.step_state] }}</span>
      </li>
    </ul>

    <div v-if="card.chat" class="ab-full flex items-center gap-1.5 text-xs text-text2">
      <span class="ab-pulse size-1.5 rounded-full bg-accent" />
      Waiting for {{ board.nameOf(card.chat.assignee) }} to answer
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <span
        v-if="priority"
        class="ab-full rounded px-1.5 py-0.5 text-xs font-semibold"
        :style="{ background: priority.bg, color: priority.fg }"
      >{{ priorityLabel(card.task.priority) }}</span>
      <span
        v-if="card.task.due_at && card.workState !== 'done'"
        class="ab-full rounded px-1.5 py-0.5 text-xs"
        :class="overdue ? 'bg-(--ab-red-bg) font-semibold text-(--ab-red-text)' : 'bg-chip text-text2'"
      >{{ overdue ? 'Overdue' : 'Due' }} {{ formatDate(card.task.due_at) }}</span>
      <span v-if="card.pinned" class="ab-full rounded bg-chip px-1.5 py-0.5 text-xs font-semibold text-text2" title="Pinned: first in its column, skipped by cleanup">Pinned</span>
      <span v-if="card.archived" class="ab-full rounded border border-line px-1.5 py-0.5 text-xs text-text3">Archived</span>
      <span
        v-for="tag in [epicOf(card.tags), milestoneOf(card.tags)].filter(Boolean)"
        :key="tag"
        class="ab-full rounded border border-line bg-surface px-1.5 py-0.5 text-xs font-semibold text-text2"
        :title="KIND_LABELS[kindOfTag(tag) ?? 'epic']"
      >{{ planLabel(tag) }}</span>
      <!-- No "Unplanned" chip: it sat on every card and said nothing (audit, 11/1/2026). The report's orphan finding
           and the Plan page still show unplaced cards. Two tags at most; the card panel lists them all. -->
      <span
        v-for="tag in plainTags(card.tags).slice(0, 2)"
        :key="tag"
        class="ab-full rounded bg-chip px-1.5 py-0.5 text-xs text-text2"
      >#{{ tag }}</span>
      <span v-if="plainTags(card.tags).length > 2" class="ab-full text-xs text-text3">+{{ plainTags(card.tags).length - 2 }}</span>
      <span v-if="card.noteCount" class="ml-auto inline-flex items-center gap-1 text-xs text-text3" :aria-label="`${card.noteCount} notes`">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
        {{ card.noteCount }}
      </span>
    </div>
  </article>
</template>
