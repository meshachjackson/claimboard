<script setup lang="ts">
// Desktop columns for the active view, optionally split into swimlanes by project, epic or milestone.
// Clicking a column's title flips its sort direction; the sort key is in the filter bar.
import type { BoardColumn, Stage } from '~/types/board'
import type { CardView } from '~/stores/board'
import { COLUMN_RULES, SORT_LABELS, plainData } from '~/types/board'
import { matchesColumn, parseMatch } from '~/utils/rollup'
import { sortCards } from '~/utils/sort'
import type { LaneBy } from '~/utils/planning'
import { LANE_BY_LABELS, laneLabel, cardLane, NONE } from '~/utils/planning'
import { STAGES } from '~/types/board'
import { BACKLOG_CAP, capColumn } from '~/utils/backlogCap'

const props = defineProps<{ columns: BoardColumn[], cards: CardView[], lanes: boolean, laneBy: LaneBy, draggable: boolean }>()
const emit = defineEmits<{ open: [taskId: string] }>()
const board = useBoardStore()
const editor = useTicketEditor()
const sort = useColumnSort()
const fold = useLaneFold()
const { groupList } = useSettings()

// List view (View options): each swimlane is one line per card, so a whole project fits on one screen.
const listed = computed(() => props.lanes && groupList.value)
const laneKey = (lane: string) => `${props.laneBy}:${lane}`
const laneCards = (lane: string) => props.cards.filter(c => cardLane(c, props.laneBy) === lane)
// List order: by stage along the board, then the chosen sort within a stage.
const laneRows = (lane: string) => STAGES.flatMap(stage => sortCards(laneCards(lane).filter(c => c.stage === stage), sort.key.value, false))
const allFolded = computed(() => laneIds.value.every(l => l === null || fold.isFolded(laneKey(l))))

const isBacklog = (col: BoardColumn) => col.match === 'stage=backlog' || col.match === 'work_state=backlog'
const isDone = (col: BoardColumn) => col.match === 'stage=done' || col.match === 'work_state=done'
const inColumn = (col: BoardColumn, card: CardView) => matchesColumn(col.match, card)

const laneIds = computed(() => props.lanes
  ? [...new Set(props.cards.map(c => cardLane(c, props.laneBy)))].sort(compareLanes)
  : [null])

// Epic and milestone lanes: the cards nobody has placed go last.
function compareLanes(a: string, b: string) {
  return (a === NONE ? 1 : 0) - (b === NONE ? 1 : 0) || a.localeCompare(b)
}

// Backlog cap: which Backlog cells the user expanded, keyed by lane. Lives here, not in the URL, so it survives a data
// refresh and resets on a page reload.
const expanded = ref<Record<string, boolean>>({})
const cellKey = (lane: string | null) => lane ?? 'all'
const flip = (lane: string | null) => { expanded.value = { ...expanded.value, [cellKey(lane)]: !expanded.value[cellKey(lane)] } }
// The cards a column cell draws. Only Backlog is capped; every other column draws all of its cards.
function shownIn(col: BoardColumn, lane: string | null) {
  const all = cell(col, lane)
  return isBacklog(col) ? capColumn(all, BACKLOG_CAP, !!expanded.value[cellKey(lane)]) : { cards: all, hidden: 0 }
}
const wasCapped = (col: BoardColumn, lane: string | null) => isBacklog(col) && !!expanded.value[cellKey(lane)] && cell(col, lane).length > BACKLOG_CAP

function cell(col: BoardColumn, lane: string | null): CardView[] {
  const list = props.cards.filter(c => inColumn(col, c) && (lane === null || cardLane(c, props.laneBy) === lane))
  return sortCards(list, sort.key.value, sort.isDesc(col.column_id))
}

const ruleFor = (col: BoardColumn) => COLUMN_RULES[parseMatch(col.match).value.split('|')[0]!] ?? 'var(--color-ink)'

function countFor(col: BoardColumn) {
  return props.cards.filter(c => inColumn(col, c)).length
}

function onDrop(col: BoardColumn, taskId: string) {
  const { field, value } = parseMatch(col.match)
  if (field === 'stage') board.moveTask(taskId, value as Stage)
}
</script>

<template>
  <main class="flex-1 overflow-x-auto px-6 pt-5 pb-10">
    <div class="flex min-w-max flex-col gap-4">
      <!-- Column headers -->
      <div v-if="!listed" class="flex gap-4">
        <div v-for="col in columns" :key="col.column_id" class="flex w-[272px] flex-none flex-col gap-0.5 border-b-4 px-1 pb-1.5" :style="{ borderColor: ruleFor(col) }">
          <div class="flex items-center gap-2">
            <h2 class="m-0">
              <button
                type="button"
                class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md font-display text-[24px] font-bold text-ink"
                :title="`Sorted by ${SORT_LABELS[sort.key.value].toLowerCase()}, ${sort.isDesc(col.column_id) ? 'descending' : 'ascending'}. Click to flip.`"
                :aria-label="`${col.name}, sorted by ${SORT_LABELS[sort.key.value].toLowerCase()} ${sort.isDesc(col.column_id) ? 'descending' : 'ascending'}. Flip the order.`"
                @click="sort.toggle(col.column_id)"
              >
                {{ col.name }}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="!sort.isDesc(col.column_id) && 'rotate-180'"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
              </button>
            </h2>
            <span class="font-display text-[20px] font-semibold text-text3">{{ countFor(col) }}</span>
            <ArchiveDone v-if="isDone(col)" :cards="cards" />
          </div>
          <span class="text-xs text-text3">{{ plainData(col.hint) }}</span>
        </div>
      </div>

      <!-- One row per swimlane (a single unlabeled row when swimlanes are off) -->
      <section
        v-for="lane in laneIds"
        :key="lane ?? 'all'"
        :aria-label="lane === null ? 'Board' : `${LANE_BY_LABELS[laneBy]} ${laneLabel(lane, laneBy)}`"
        class="flex flex-col gap-2"
      >
        <div v-if="lane !== null" class="flex items-center gap-2 px-1">
          <h3 class="m-0 font-display text-lg font-bold text-text2">
            <button
              type="button"
              class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md font-display text-lg font-bold"
              :aria-expanded="!fold.isFolded(laneKey(lane))"
              :title="fold.isFolded(laneKey(lane)) ? 'Show this group' : 'Fold this group'"
              @click="fold.toggle(laneKey(lane))"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="fold.isFolded(laneKey(lane)) && '-rotate-90'"><path d="M6 9l6 6 6-6" /></svg>
              {{ laneLabel(lane, laneBy) }}
              <span class="font-semibold text-text3">{{ laneCards(lane).length }}</span>
            </button>
          </h3>
          <button
            v-if="laneBy === 'project' && lane && !board.readOnly"
            type="button"
            class="ab-ghost inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-line px-2 text-xs font-semibold text-text2"
            :title="`New card in ${lane}`"
            @click="editor.create(lane)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            New card
          </button>
          <button
            v-if="lane === laneIds[0] && laneIds.length > 1"
            type="button"
            class="ml-auto min-h-6 cursor-pointer px-1 text-xs font-semibold text-text3 hover:text-ink"
            @click="fold.setAll(allFolded ? [] : laneIds.filter((l): l is string => l !== null).map(laneKey))"
          >
            {{ allFolded ? 'Open all' : 'Fold all' }}
          </button>
        </div>
        <template v-if="lane === null || !fold.isFolded(laneKey(lane))">
          <LaneList v-if="listed && lane !== null" :cards="laneRows(lane)" class="w-[min(960px,calc(100vw-280px))]" @open="emit('open', $event)" />
          <div v-else class="flex items-start gap-4">
            <div
              v-for="col in columns"
              :key="col.column_id"
              :aria-label="col.name"
              role="region"
              class="flex w-[272px] flex-none flex-col gap-3.5 rounded bg-lane px-2 pt-3.5 pb-2"
            >
              <button
                v-if="!board.readOnly && isBacklog(col) && (lane === null || (lane === laneIds[0] && laneBy !== 'project'))"
                type="button"
                class="inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded border-2 border-dashed border-dash text-sm font-semibold text-text2 hover:border-ink hover:text-ink"
                @click="editor.create()"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                New card
              </button>
              <div class="relative">
                <ColumnDrop
                  :cards="shownIn(col, lane).cards"
                  :disabled="!draggable"
                  @drop="onDrop(col, $event)"
                  @open="emit('open', $event)"
                />
                <!-- Sits over the empty drop zone without becoming a draggable item. -->
                <p v-if="cell(col, lane).length === 0" class="pointer-events-none absolute inset-x-0 top-0 m-0 px-2 py-4 text-center text-[13px] text-text3">
                  Nothing here
                </p>
              </div>
              <button
                v-if="shownIn(col, lane).hidden > 0 || wasCapped(col, lane)"
                type="button"
                class="ab-ghost inline-flex h-8 cursor-pointer items-center justify-center rounded-md text-[13px] font-semibold text-text2"
                :aria-expanded="wasCapped(col, lane)"
                @click="flip(lane)"
              >
                {{ wasCapped(col, lane) ? 'Show fewer' : `Show all ${cell(col, lane).length}` }}
              </button>
            </div>
          </div>
        </template>
      </section>
    </div>
  </main>
</template>
