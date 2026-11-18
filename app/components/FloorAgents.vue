<script setup lang="ts">
// On the floor: one row per agent with what it is doing, what it owes the owner, and its queue. A pool row ("Any advisor")
// holds steps nobody has claimed yet.
import type { AgentRow } from '~/composables/useFloor'
import { formatDateTime } from '~/utils/format'
import { waitLabel } from '~/utils/whoseMove'

defineProps<{ rows: AgentRow[], limit?: number }>()
const board = useBoardStore()
const route = useRoute()

function state(r: AgentRow): { text: string, lamp: string } {
  if (r.working.length) return { text: `working on ${r.working.length === 1 ? r.working[0]!.card.task.task_id : `${r.working.length} cards`}`, lamp: 'var(--ab-run)' }
  if (r.owes.length) return { text: `owes you ${r.owes.length === 1 ? 'an answer' : `${r.owes.length} answers`}, ${waitLabel(r.owes[0]!.move.since)}`, lamp: 'var(--ab-amber)' }
  return { text: r.lastBeat ? `idle, last seen ${formatDateTime(r.lastBeat)}` : 'not seen yet', lamp: 'var(--color-dash)' }
}
// The card the agent will touch next: what it is working on, else what it owes, else the oldest in its queue.
const next = (r: AgentRow) => (r.working[0] ?? r.owes[0] ?? r.queued[0])?.card.task
const openTo = (id: string) => ({ path: route.path, query: { ...route.query, task: id } })
</script>

<template>
  <ul class="m-0 list-none p-0">
    <li v-for="r in (limit ? rows.slice(0, limit) : rows)" :key="r.id" class="grid grid-cols-[40px_1fr_auto] items-center gap-3.5 border-b border-line py-3.5">
      <span
        class="flex size-10 items-center justify-center rounded font-display text-[17px] font-bold text-white"
        :style="r.id.startsWith('pool:') ? { background: 'var(--ab-neutral-dot)', color: 'var(--color-surface)' } : { background: board.avatarOf(r.id).color }"
        aria-hidden="true"
      >{{ r.id.startsWith('pool:') ? '··' : board.avatarOf(r.id).mono }}</span>
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-base font-semibold text-ink">{{ board.nameOf(r.id) }}</span>
          <span class="size-[9px] flex-none rounded-full" :style="{ background: state(r).lamp }" aria-hidden="true" />
          <span class="truncate text-[13px] text-text3">{{ state(r).text }}</span>
        </div>
        <NuxtLink
          v-if="next(r)"
          :to="openTo(next(r)!.task_id)"
          class="block truncate py-0.5 text-sm text-text2 no-underline hover:underline"
        >Next: {{ next(r)!.task_id }} {{ next(r)!.title }}</NuxtLink>
      </div>
      <span class="text-right font-display text-[28px] leading-none font-bold text-ink">
        {{ r.queued.length }}
        <span class="block font-sans text-xs font-medium text-text3">queued</span>
      </span>
    </li>
    <li v-if="!rows.length" class="py-6 text-[15px] text-text2">No agent has work on the board.</li>
  </ul>
</template>
