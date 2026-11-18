<script setup lang="ts">
// A swimlane as a list (View options, List): one row per card, so a whole project fits on one screen. The stage shows as a
// label because there are no columns. Rows open the ticket; moving a card is a drag in the card view.
import type { CardView } from '~/stores/board'
import { PRIORITY_BADGES, STAGE_LABELS } from '~/types/board'
import { normalizePriority, priorityLabel } from '~/utils/priority'

defineProps<{ cards: CardView[] }>()
const emit = defineEmits<{ open: [taskId: string] }>()
</script>

<template>
  <ul class="m-0 flex list-none flex-col gap-px overflow-hidden rounded border border-line bg-line p-0">
    <li v-for="card in cards" :key="card.task.task_id" class="relative flex items-center gap-3 bg-surface px-3 py-1.5 text-sm hover:bg-lane">
      <span class="w-[92px] flex-none text-xs font-semibold text-text2">{{ STAGE_LABELS[card.stage] }}</span>
      <span class="w-[78px] flex-none font-mono text-xs text-text3">{{ card.task.task_id }}</span>
      <button
        type="button"
        class="min-w-0 flex-1 cursor-pointer truncate text-left font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-accent"
        @click="emit('open', card.task.task_id)"
      >
        {{ card.task.title }}
      </button>
      <StatusPill v-if="card.pill" :pill="card.pill" class="flex-none" />
      <span
        v-if="PRIORITY_BADGES[normalizePriority(card.task.priority)]"
        class="flex-none rounded px-1.5 py-0.5 text-xs font-semibold"
        :style="{ background: PRIORITY_BADGES[normalizePriority(card.task.priority)]!.bg, color: PRIORITY_BADGES[normalizePriority(card.task.priority)]!.fg }"
      >{{ priorityLabel(card.task.priority) }}</span>
      <span v-if="card.noteCount" class="flex-none text-xs text-text3" :aria-label="`${card.noteCount} notes`">{{ card.noteCount }} notes</span>
      <AgentAvatar :id="card.assignee" :size="22" class="flex-none" />
    </li>
  </ul>
</template>
