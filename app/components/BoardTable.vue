<script setup lang="ts">
// The table layout (Board v4): one row per card, sortable columns, a checkbox per row. The search box and the
// filter panel (which has Stage and Priority) narrow the rows as on the board. Clicking a row opens the ticket.
// Under 1100px of table width Project, Type, Due and Updated drop out so nothing scrolls sideways.
// On the phone the table has no board header, so it carries the view switch, search, a Filters button that opens the
// board's filter sheet, and the account menu.
import type { CardView } from '~/stores/board'
import type { TableSortKey } from '~/types/board'
import { STAGE_LABELS, TABLE_SORT_KEYS, TABLE_SORT_LABELS, TASK_TYPE_LABELS } from '~/types/board'
import { filterRows, nextSort, sortRows } from '~/utils/tableView'
import { formatDate } from '~/utils/format'
import { priorityLabel } from '~/utils/priority'

const props = defineProps<{ cards: CardView[], phone?: boolean }>()
const emit = defineEmits<{ open: [taskId: string], rows: [ids: string[]] }>()
const board = useBoardStore()
const layout = useBoardLayout()
const selection = useBulkSelection()
const { query, set } = useBoardFilters()
const facets = useBoardFacets()
const filtersOpen = ref(false)

// One text filter per column, matched against what the cell shows. Local to the table, on top of the search and filter panel.
const columnFilters = ref<Partial<Record<TableSortKey, string>>>({})
const rows = computed(() => sortRows(
  filterRows(props.cards, columnFilters.value, board.nameOf),
  layout.sortKey.value,
  layout.sortDesc.value,
  board.nameOf
))
const ids = computed(() => rows.value.map(r => r.task.task_id))
// The bar and the selection only ever see the rows on screen.
watch(ids, v => emit('rows', v), { immediate: true })

const headerState = computed(() => selection.stateFor(ids.value))
const sortLabel = (key: TableSortKey) => TABLE_SORT_LABELS[key]
function sortBy(key: TableSortKey) {
  const next = nextSort({ key: layout.sortKey.value, desc: layout.sortDesc.value }, key)
  layout.setSort(next.key, next.desc)
}
const ariaSort = (key: TableSortKey) => layout.sortKey.value !== key ? 'none' : layout.sortDesc.value ? 'descending' : 'ascending'

import { epicOf, milestoneOf, planLabel } from '~/utils/planning'

const cell = 'px-3 py-2 align-middle'
// Columns that drop out in a narrow table (the phone keeps them and scrolls).
const EXTRA: readonly string[] = ['project', 'epic', 'milestone', 'type', 'due', 'updated']
const extra = (on: boolean) => on && 'ab-tcol-extra'
</script>

<template>
  <main class="flex-1 px-3 pt-4 pb-40 sm:px-6">
    <!-- The phone board's own header isn't shown in the table, so the table carries the essentials: title, search, account. -->
    <div v-if="phone" class="mb-3 flex items-center gap-2">
      <PageTitle />
      <input
        type="search"
        aria-label="Search cards"
        placeholder="Search cards"
        :value="query.q"
        class="ab-select h-11 min-w-0 flex-1 rounded-lg px-3 text-sm"
        @input="set({ q: ($event.target as HTMLInputElement).value })"
      >
      <button
        type="button"
        :aria-label="facets.facetCount.value ? `Filters, ${facets.facetCount.value} applied` : 'Filters'"
        class="relative inline-flex size-11 flex-none cursor-pointer items-center justify-center rounded-[10px] border border-input bg-(--ab-seg-track) text-ink"
        @click="filtersOpen = true"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        <span v-if="facets.facetCount.value" class="absolute -top-[5px] -right-[5px] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-[5px] text-xs font-bold text-white">{{ facets.facetCount.value }}</span>
      </button>
      <AccountMenu />
    </div>
    <!-- The same sheet as the phone board; its Display section (columns, group, card sort) is for the board, so it is left out here. -->
    <FilterSheet
      v-if="phone"
      v-model:open="filtersOpen"
      :columns="facets.columns.value"
      :show-label="`Show ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`"
      @toggle="facets.toggle"
      @clear-all="facets.clearAll"
    />
    <div class="ab-tablewrap overflow-x-auto rounded-xl border border-line bg-surface">
      <table class="w-full border-collapse text-left text-[13px]" :class="phone && 'min-w-[920px]'">
        <thead>
          <tr class="border-b border-line bg-(--color-filterbar) text-xs text-text3">
            <th scope="col" class="w-10 px-1">
              <SelectBox :checked="headerState === 'all'" :state="headerState" label="Select all rows" :phone="phone" @toggle="selection.toggleAll(ids)" />
            </th>
            <th v-for="key in TABLE_SORT_KEYS" :key="key" scope="col" :aria-sort="ariaSort(key)" class="px-3 py-1 font-semibold whitespace-nowrap" :class="!phone && EXTRA.includes(key) && 'ab-tcol-extra'">
              <button type="button" class="inline-flex h-8 min-w-6 max-md:h-11 max-md:min-w-11 cursor-pointer items-center gap-1 hover:text-ink" :class="layout.sortKey.value === key && 'text-ink'" @click="sortBy(key)">
                {{ sortLabel(key) }}
                <svg v-if="layout.sortKey.value === key" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="!layout.sortDesc.value && 'rotate-180'"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
              </button>
            </th>
          </tr>
          <tr class="border-b border-line bg-(--color-filterbar)">
            <th class="w-10 px-1" />
            <th v-for="key in TABLE_SORT_KEYS" :key="key" class="px-2 pb-2 font-normal" :class="!phone && EXTRA.includes(key) && 'ab-tcol-extra'">
              <input
                v-model="columnFilters[key]"
                type="search"
                :aria-label="`Filter ${sortLabel(key)}`"
                :placeholder="`Filter ${sortLabel(key).toLowerCase()}`"
                class="ab-select h-8 w-full min-w-[84px] rounded-md px-2 text-xs"
              >
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in rows"
            :key="c.task.task_id"
            class="cursor-pointer border-b border-line last:border-b-0 hover:bg-chip"
            :class="selection.has(c.task.task_id) && 'bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]'"
            @click="emit('open', c.task.task_id)"
          >
            <td class="px-1">
              <SelectBox
                :checked="selection.has(c.task.task_id)"
                :label="`Select ${c.task.task_id}`"
                :phone="phone"
                @toggle="selection.toggle(c.task.task_id, ids, $event)"
              />
            </td>
            <td :class="cell" class="font-mono text-xs font-medium whitespace-nowrap text-text2">{{ c.task.task_id }}</td>
            <th scope="row" :class="cell" class="max-w-[320px] font-semibold">
              <span class="line-clamp-2">{{ c.pinned ? '📌 ' : '' }}{{ c.task.title }}</span>
            </th>
            <td :class="cell" class="whitespace-nowrap">{{ STAGE_LABELS[c.stage] }}</td>
            <td :class="cell"><StatusPill v-if="c.pill" :pill="c.pill" /></td>
            <td :class="cell" class="max-w-[160px] truncate whitespace-nowrap" :title="board.nameOf(c.assignee)">{{ board.nameOf(c.assignee) }}</td>
            <td :class="[cell, extra(!phone)]" class="whitespace-nowrap text-text2">{{ c.task.project_id || '—' }}</td>
            <td :class="[cell, extra(!phone)]" class="whitespace-nowrap text-text2">{{ epicOf(c.tags) ? planLabel(epicOf(c.tags)) : '—' }}</td>
            <td :class="[cell, extra(!phone)]" class="whitespace-nowrap text-text2">{{ milestoneOf(c.tags) ? planLabel(milestoneOf(c.tags)) : '—' }}</td>
            <td :class="[cell, extra(!phone)]" class="whitespace-nowrap text-text2">{{ TASK_TYPE_LABELS[c.task.task_type as keyof typeof TASK_TYPE_LABELS] ?? c.task.task_type }}</td>
            <td :class="cell" class="whitespace-nowrap">{{ priorityLabel(c.task.priority) }}</td>
            <td :class="[cell, extra(!phone)]" class="font-mono text-xs whitespace-nowrap text-text2">{{ formatDate(c.task.due_at) || '—' }}</td>
            <td :class="[cell, extra(!phone)]" class="font-mono text-xs whitespace-nowrap text-text2">{{ formatDate(c.task.updated_at) }}</td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="12" class="px-3 py-8 text-center text-text3">Nothing here</td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
</template>
