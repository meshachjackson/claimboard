<script setup lang="ts">
// Phone layout: the header (switch, live, account), search and filter rows, a swipeable column tab strip,
// one column of cards, a New card button, and the filter sheet.
import type { BoardColumn } from '~/types/board'
import type { CardView } from '~/stores/board'
import { SORT_LABELS, plainData } from '~/types/board'
import { matchesColumn } from '~/utils/rollup'
import { sortCards } from '~/utils/sort'
import { laneLabel, cardLane } from '~/utils/planning'

const props = defineProps<{ columns: BoardColumn[], cards: CardView[] }>()
const emit = defineEmits<{ open: [taskId: string] }>()
const board = useBoardStore()
const { query, set } = useBoardFilters()
const facets = useBoardFacets()
const toast = useToast()

function reset() {
  if (!confirm('Reset fixtures? This drops every local edit.')) return
  board.reset()
  toast.add({ title: 'Fixtures reloaded', color: 'neutral' })
}

// The same rule as the desktop columns, so a Flow column like Running (awaiting_start|in_progress) counts every card it
// matches. A plain equality check here showed Running 0 on the phone (audit, 11/1/2026).
const inColumn = (col: BoardColumn, card: CardView) => matchesColumn(col.match, card)

const sort = useColumnSort()
const editor = useTicketEditor()

const active = computed(() => props.columns.find(c => c.column_id === query.value.col) ?? props.columns[0]!)
const activeCards = computed(() => sortCards(
  props.cards.filter(c => inColumn(active.value, c)),
  sort.key.value,
  sort.isDesc(active.value.column_id)
))

// Swimlanes on the phone: group the column's cards under project headings.
const groups = computed(() => {
  if (!query.value.lanes) return [{ lane: null as string | null, cards: activeCards.value }]
  const by = query.value.lane_by
  const lanes = [...new Set(activeCards.value.map(c => cardLane(c, by)))].sort()
  return lanes.map(lane => ({ lane, cards: activeCards.value.filter(c => cardLane(c, by) === lane) }))
})

function selectColumn(col: BoardColumn) {
  set({ col: col.column_id })
  nextTick(() => document.getElementById(`tab-${col.column_id}`)?.scrollIntoView({ inline: 'center', block: 'nearest' }))
}

// Swipe sideways on the list to change columns.
let startX = 0
let startY = 0
function onTouchStart(e: TouchEvent) {
  startX = e.touches[0]!.clientX
  startY = e.touches[0]!.clientY
}
function onTouchEnd(e: TouchEvent) {
  const dx = e.changedTouches[0]!.clientX - startX
  const dy = e.changedTouches[0]!.clientY - startY
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
  const i = props.columns.indexOf(active.value) + (dx < 0 ? 1 : -1)
  const next = props.columns[i]
  if (next) selectColumn(next)
}

const filtersOpen = ref(false)
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-ground">
    <div class="sticky top-0 z-10 border-b border-line bg-(--ab-bar)">
      <header class="flex h-14 items-center gap-2.5 pr-3 pl-4">
        <PageTitle />
        <span class="ml-auto inline-flex items-center gap-1">
          <BuildStatus v-if="board.source === 'gateway'" />
          <LiveStatus phone :source="board.source" :read-only="board.readOnly" :updated-at="board.updatedAt" :refreshing="board.refreshing" :saved="board.saved" />
          <button
            v-if="board.localOnly"
            type="button"
            class="h-11 min-w-11 cursor-pointer px-1.5 text-xs font-semibold text-(--ab-blue-link)"
            @click="reset"
          >
            Reset
          </button>
        </span>
        <PhoneMore />
        <AccountMenu />
      </header>
      <LoadBanner />
      <PhoneFilterRow
        search-label="Search cards"
        :q="query.q"
        :pills="facets.pills.value"
        :tokens="facets.tokens.value"
        :facet-count="facets.facetCount.value"
        @search="set({ q: $event })"
        @pill="facets.toggle('work_state', $event)"
        @remove-token="facets.removeToken"
        @open="filtersOpen = true"
      />
      <nav aria-label="Columns" class="ab-row flex gap-0.5 overflow-x-auto px-2">
        <a
          v-for="col in columns"
          :id="`tab-${col.column_id}`"
          :key="col.column_id"
          href="#"
          :aria-current="col.column_id === active.column_id ? 'page' : undefined"
          class="inline-flex h-11 flex-none items-center gap-1.5 border-b-2 px-2.5 text-sm no-underline"
          :class="col.column_id === active.column_id ? 'border-ink font-bold text-ink' : 'border-transparent font-medium text-text3'"
          @click.prevent="selectColumn(col)"
        >
          {{ col.name }}
          <span class="font-mono text-xs">{{ cards.filter(c => inColumn(col, c)).length }}</span>
        </a>
      </nav>
    </div>

    <div
      class="flex flex-1 flex-col gap-2.5 px-4 pt-3 pb-24"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
    >
      <div class="mx-0.5 flex items-center gap-2">
        <p class="m-0 flex-1 text-xs text-text3">{{ plainData(active.hint) }} · swipe sideways for other columns</p>
        <ArchiveDone v-if="active.match === 'stage=done' || active.match === 'work_state=done'" :cards="cards" phone />
        <button
          type="button"
          class="inline-flex h-11 flex-none cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-semibold text-text2"
          @click="sort.toggle(active.column_id)"
        >
          {{ SORT_LABELS[sort.key.value] }}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="!sort.isDesc(active.column_id) && 'rotate-180'"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
          <span class="sr-only">{{ sort.isDesc(active.column_id) ? 'descending' : 'ascending' }}, tap to flip</span>
        </button>
      </div>
      <template v-for="g in groups" :key="g.lane ?? 'all'">
        <h3 v-if="g.lane !== null" class="m-0 mt-1 font-mono text-xs font-medium text-text2">{{ laneLabel(g.lane, query.lane_by) }} · {{ g.cards.length }}</h3>
        <TaskCard v-for="card in g.cards" :key="card.task.task_id" :card="card" phone @open="emit('open', $event)" />
      </template>
      <p v-if="activeCards.length === 0" class="m-0 px-2 py-4 text-center text-[13px] text-text3">Nothing here</p>
    </div>

    <button
      v-if="!board.readOnly"
      type="button"
      class="fixed right-4 bottom-[calc(88px+env(safe-area-inset-bottom))] z-20 inline-flex h-[52px] cursor-pointer items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-surface shadow-[0_8px_24px_rgba(16,24,40,0.24)]"
      @click="editor.create()"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      New card
    </button>

    <FilterSheet
      v-model:open="filtersOpen"
      :columns="facets.columns.value"
      :show-label="`Show ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`"
      @toggle="facets.toggle"
      @clear-all="facets.clearAll"
    >
      <template #display>
        <BoardDisplay />
      </template>
    </FilterSheet>

  </div>
</template>
