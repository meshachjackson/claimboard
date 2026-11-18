<script setup lang="ts">
import { orchestratorName } from '~/types/board'
const orch = orchestratorName()
// The board's desktop header (Board v4): the shared bar with the view switch, Live, New, the orchestrator and the ⋯ menu, and the
// filter panel below it. Saved views and View options live in that panel (UX Phase 5). Everything else lives in ⋯, the
// bulk bar or Settings.
import { BOARD_VIEWS } from '~/types/board'

const props = defineProps<{ dialogOpen: boolean }>()
const board = useBoardStore()
const editor = useTicketEditor()
const managerOpen = useManagerOpen()
const selection = useBulkSelection()
const shortcutsOpen = useShortcutsOpen()
const { query, set, setView } = useBoardFilters()
const facets = useBoardFacets()
const { filtersExpanded, setFiltersExpanded } = useSettings()

const bar = ref<{ focusSearch: () => void, focusToggle: () => void }>()

function close() {
  setFiltersExpanded(false)
  nextTick(() => bar.value?.focusToggle())
}

function togglePill(value: string) {
  facets.toggle('work_state', value)
}

useBoardKeys({
  search: () => bar.value?.focusSearch(),
  filters: () => setFiltersExpanded(!filtersExpanded.value),
  view: n => setView(BOARD_VIEWS[n - 1]!),
  // X toggles the card that has keyboard focus.
  selectFocused: () => {
    const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-id]')?.dataset.id
    if (id && !board.readOnly) selection.toggle(id)
  },
  escape: () => { if (filtersExpanded.value) close(); else selection.clear() },
  shortcuts: () => { shortcutsOpen.value = true }
}, () => props.dialogOpen || shortcutsOpen.value)
</script>

<template>
  <!-- `contents` so the bar sticks against the page, not this wrapper. The filter panel below it scrolls away. -->
  <div class="contents">
    <TopBar
      ref="bar"
      class="sticky top-0 z-30"
      title="Board"
      search-label="Search"
      :q="query.q"
      :pills="facets.pills.value"
      :tokens="facets.tokens.value"
      :count-label="facets.countLabel.value"
      :facet-count="facets.facetCount.value"
      :has-active="facets.hasActive.value"
      :expanded="filtersExpanded"
      @search="set({ q: $event })"
      @pill="togglePill"
      @remove-token="facets.removeToken"
      @toggle="setFiltersExpanded(!filtersExpanded)"
      @clear-all="facets.clearAll"
    >
      <template #actions>
        <BoardViews />
        <span aria-hidden="true" class="h-5 w-px bg-line" />
        <LiveStatus
          :source="board.source"
          :read-only="board.readOnly"
          :updated-at="board.updatedAt"
          :refreshing="board.refreshing"
          :saved="board.saved"
          @refresh="board.refresh(true)"
        />
        <BuildStatus v-if="board.source === 'gateway'" />
        <button
          v-if="!board.readOnly"
          type="button"
          aria-label="New card"
          title="New card ( N )"
          class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-ink px-2.5 text-[13px] font-semibold text-surface"
          @click="editor.create()"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          <!-- Shows from 1100px, with the Filters label. -->
          <span class="ab-compact-hide pr-0.5">New card</span>
        </button>
        <button
          v-if="!board.readOnly"
          type="button"
          :aria-label="orch"
          title="Ask the orchestrator: ask about the board, a card or a blocker"
          class="ab-ghost inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] font-semibold text-ink"
          @click="managerOpen = !managerOpen"
        >
          <UIcon name="i-lucide-bot" class="size-4" />
          <span class="ab-narrow-hide">{{ orch }}</span>
        </button>
        <BoardMenu />
      </template>
    </TopBar>
    <FilterPanel
      v-if="filtersExpanded"
      :columns="facets.columns.value"
      @toggle="facets.toggle"
      @clear="facets.clear"
      @close="close"
    />
  </div>
</template>
