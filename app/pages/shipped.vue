<script setup lang="ts">
// Shipped, Log tab: every finished card, grouped by the day it finished, newest first. The Report tab is /report.
import type { MoveCard } from '~/composables/useFloor'
import { formatDate } from '~/utils/format'

const floor = useFloor()
const board = useBoardStore()
const route = useRoute()
const shortcutsOpen = useShortcutsOpen()

// "Find a card" narrows the log by title, card id or who did the work. / focuses it (not while typing, in a dialog or with a card open).
const q = ref('')
const search = ref<HTMLInputElement>()
useBoardKeys({ search: () => search.value?.focus() }, () => !!route.query.task || shortcutsOpen.value)
const who = (m: MoveCard) => m.card.task.assignee || board.stepsFor(m.card.task.task_id).at(-1)?.lease_owner || ''
const shownCards = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return floor.shipped.value
  return floor.shipped.value.filter(m => `${m.card.task.task_id} ${m.card.task.title} ${board.nameOf(who(m))}`.toLowerCase().includes(needle))
})

const days = computed(() => {
  const groups = new Map<string, MoveCard[]>()
  for (const m of shownCards.value) {
    const day = formatDate(m.move.since)
    if (!groups.has(day)) groups.set(day, [])
    groups.get(day)!.push(m)
  }
  return [...groups.entries()].map(([day, items]) => ({ day, items }))
})
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-20 flex min-h-14 items-stretch gap-6 border-b-2 border-rule bg-ground px-5">
      <PageTitle class="self-center" />
      <PageTabs :tabs="[{ to: '/shipped', label: 'Log' }, { to: '/report', label: 'Report' }]" />
    </header>
    <FloorZone tone="run" :count="floor.shippedToday.value.length" title="Shipped today" :line="`${floor.shipped.value.length} in all`" />
    <div class="mx-auto w-full max-w-[880px] px-6 pb-12">
      <label class="mt-5 flex h-11 items-center gap-2 rounded-lg border border-input bg-surface px-3 text-text3 focus-within:border-accent">
        <UIcon name="i-lucide-search" class="size-4 flex-none" aria-hidden="true" />
        <input ref="search" v-model="q" type="search" aria-label="Find a card" placeholder="Find a card" class="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none">
        <kbd class="ab-narrow-hide rounded border border-input px-1.5 py-[3px] font-mono text-xs leading-none text-text3" aria-hidden="true">/</kbd>
      </label>
      <p v-if="q && !days.length" class="py-6 text-[15px] text-text2" role="status">No shipped card matches "{{ q }}".</p>
      <section v-for="d in days" :key="d.day" class="pt-6">
        <h2 class="m-0 flex items-baseline gap-3 border-b-2 border-rule pb-1.5 font-display text-[22px] font-bold">
          {{ d.day }} <span class="font-semibold text-text3">{{ d.items.length }}</span>
        </h2>
        <FloorShipped :items="d.items" />
      </section>
    </div>
  </div>
</template>
