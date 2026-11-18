<script setup lang="ts">
// The kanban at /board. It moved here from / when the Floor became home (redesign, 11/1/2026).
import { REPORT_TOOL_LOOKS } from '~/types/board'
const board = useBoardStore()
const { query, report, matches, rewriteLegacy, legacyPresent } = useBoardFilters()
const isPhone = useIsPhone()
const route = useRoute()
const router = useRouter()

const columns = computed(() => board.columnsFor(query.value.view))
const shown = computed(() => board.cards.filter(c => matches(c)))

// Table layout and bulk edit. The bar only acts on the rows on screen, so the table reports which it shows.
const { layout } = useBoardLayout()
const selection = useBulkSelection()
const tableIds = ref<string[]>([])
const barCards = computed(() => layout.value === 'table' ? shown.value.filter(c => tableIds.value.includes(c.task.task_id)) : shown.value)
watch(() => board.readOnly, (ro) => { if (ro) selection.clear() })

// A report finding colors the border of every card it keeps (TaskCard reads --ab-report-accent).
const reportAccent = computed(() => report.value ? { '--ab-report-accent': REPORT_TOOL_LOOKS[report.value.tool]?.accent } : undefined)

// The report's "Select N on the board" opens /?report=…&select=all: check every card the filter keeps, which opens the bulk
// bar, then drop the key so a refresh does not check them again.
watch([() => route.query.select, () => board.loaded, shown], ([select, loaded]) => {
  if (select !== 'all' || !loaded || !shown.value.length) return
  selection.clear()
  selection.toggleAll(shown.value.map(c => c.task.task_id))
  const { select: _drop, ...rest } = route.query
  router.replace({ query: rest })
}, { immediate: true })

// The open ticket is in the URL; the layout draws its panel over the page. Opening pushes history so Back closes it.
const drawerOpen = computed(() => board.tasks.some(t => t.task_id === query.value.task))
const editor = useTicketEditor()

function open(taskId: string) {
  router.push({ query: { ...route.query, task: taskId } })
}

// Old links open the same view, then the URL is rewritten to the keys that replaced their old ones.
watch(legacyPresent, (present) => { if (present) rewriteLegacy() }, { immediate: true })

</script>

<template>
  <div :style="reportAccent">
    <template v-if="isPhone">
      <EmptyState v-if="!board.loaded" loading class="px-4" />
      <BoardTable v-else-if="layout === 'table'" :cards="shown" phone @open="open" @rows="tableIds = $event" />
      <PhoneBoard v-else :columns="columns" :cards="shown" @open="open" />
      <BoardViews phone class="fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-3 z-20" />
    </template>
    <div v-else class="flex min-h-dvh flex-col">
      <!-- The bar's task count and state pills would read 0 until the first read lands, so a plain header stands in. -->
      <BoardBar v-if="board.loaded" :dialog-open="drawerOpen || editor.open.value" />
      <header v-else class="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b-2 border-rule bg-ground px-5">
        <PageTitle label="Board" />
        <span class="text-sm text-text3">Loading…</span>
      </header>
      <LoadBanner />
      <!-- Until the first read lands every column would show 0 and "Nothing here", so draw quiet columns instead. -->
      <div v-if="!board.loaded" class="flex flex-1 gap-4 overflow-hidden px-6 pt-5" role="status" aria-busy="true">
        <span class="sr-only">Loading the board</span>
        <div v-for="n in 5" :key="n" class="flex w-[272px] flex-none flex-col gap-3 border-t-4 border-line pt-3">
          <span class="font-display text-[20px] font-semibold text-text3">–</span>
          <span v-for="k in 3" :key="k" class="h-20 animate-pulse rounded bg-line" />
        </div>
      </div>
      <BoardTable v-else-if="layout === 'table'" :cards="shown" @open="open" @rows="tableIds = $event" />
      <BoardColumns
        v-else
        :columns="columns"
        :cards="shown"
        :lanes="query.lanes"
        :lane-by="query.lane_by"
        :draggable="query.view === 'stages' && !board.readOnly"
        @open="open"
      />
    </div>
    <BulkBar :cards="barCards" :phone="isPhone" />
  </div>
</template>
