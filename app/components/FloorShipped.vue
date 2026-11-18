<script setup lang="ts">
// Shipped: finished cards, newest first, with the time they finished and who did the work.
import type { MoveCard } from '~/composables/useFloor'
import { formatDate, formatTime } from '~/utils/format'

const props = defineProps<{ items: MoveCard[], limit?: number }>()
const board = useBoardStore()
const route = useRoute()

const today = new Date().toDateString()
// Today's cards show the time; older ones show the date.
const when = (iso: string) => new Date(iso).toDateString() === today ? formatTime(iso) : formatDate(iso)
const shown = computed(() => props.limit ? props.items.slice(0, props.limit) : props.items)
const openTo = (id: string) => ({ path: route.path, query: { ...route.query, task: id } })
// Who did the work: the card's assignee, else whoever held its last step.
const who = (m: MoveCard) => m.card.task.assignee || board.stepsFor(m.card.task.task_id).at(-1)?.lease_owner || board.stepsFor(m.card.task.task_id).at(-1)?.assignee || ''
</script>

<template>
  <ol class="m-0 list-none p-0">
    <li v-for="m in shown" :key="m.card.task.task_id" class="grid grid-cols-[76px_1fr] gap-2.5 border-b border-line py-3">
      <span class="pt-0.5 text-[13px] text-text3">{{ when(m.move.since) }}</span>
      <NuxtLink :to="openTo(m.card.task.task_id)" class="min-w-0 text-[15px] leading-snug text-ink no-underline hover:underline">
        {{ m.card.task.title }}
        <span class="mt-0.5 block text-xs text-text3">{{ m.card.task.task_id }}<template v-if="who(m)">, {{ board.nameOf(who(m)) }}</template></span>
      </NuxtLink>
    </li>
    <li v-if="!items.length" class="py-6 text-[15px] text-text2">Nothing has shipped yet.</li>
  </ol>
</template>
