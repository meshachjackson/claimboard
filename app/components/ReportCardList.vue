<script setup lang="ts">
// A list of cards (orphans): a color square, the title, a badge for high or urgent, the ID and the age.
// Shows eight, then "Show N more". Every row lights its card on the map. A callout points out when most of the list
// could go to one agent as a batch.
import { PRIORITY_BADGES, PRIORITY_LABELS, REPORT_TOOL_LOOKS } from '~/types/board'
import type { ReportItem, ReportSection } from '~/utils/report'
import { normalizePriority } from '~/utils/priority'

const props = defineProps<{ section: ReportSection, items: ReportItem[], total: number, asOf: string, batch?: ReportItem }>()
const hl = useReportHighlight()

const SHOWN = 8
const more = ref(false)
const shown = computed(() => more.value ? props.items : props.items.slice(0, SHOWN))
const look = REPORT_TOOL_LOOKS[props.section.tool]!

/** Days since the card was created, as the report was built. */
const ageOf = (created: string) => created ? `${Math.max(0, Math.floor((Date.parse(props.asOf) - Date.parse(created)) / 86_400_000))}d` : ''

// The cards of this list that sit in the biggest batch.
const overlap = computed(() => props.batch?.task_ids ? props.section.task_ids.filter(id => props.batch!.task_ids!.includes(id)) : [])
const insight = computed(() => overlap.value.length >= 3
  ? `${overlap.value.length} of these ${props.section.task_ids.length} are ${props.batch?.type} cards that could go to one agent as a batch.`
  : '')
const BATCH = REPORT_TOOL_LOOKS.batchable!

/** The badge for a high or urgent card; normal and low get none. */
function prio(id: string) {
  const p = normalizePriority(hl.cards.value.get(id)?.priority ?? '')
  const badge = PRIORITY_BADGES[p]
  return badge ? { ...badge, label: PRIORITY_LABELS[p] } : null
}

const select = () => navigateTo({ path: '/board', query: { report: props.section.tool, select: 'all' } })
</script>

<template>
  <ReportPanel :id="`sec-${section.tool}`" :title="section.title" :summary="section.summary" :look="look" :count="section.count" :pinned="hl.isPinned(`tool:${section.tool}`)">
    <template #actions>
      <button type="button" class="h-8 flex-none cursor-pointer rounded-lg border border-(--color-input) bg-transparent px-[11px] text-xs font-semibold text-ink hover:bg-(--ab-row-hover) max-[559px]:flex-[1_1_100%]" @click="select">
        Select {{ section.count }} on the board
      </button>
    </template>

    <button
      v-if="insight"
      type="button"
      class="mx-[18px] mb-2.5 flex w-[calc(100%-36px)] cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left text-[13px] text-ink"
      :style="{ background: BATCH.bg, borderColor: BATCH.accent }"
      @pointerenter="hl.enter('insight:orphans-batch', overlap, { accent: BATCH.accent, label: 'Orphan cards in the biggest batch' })"
      @pointerleave="hl.leave()"
      @click="hl.toggle('insight:orphans-batch', overlap, { accent: BATCH.accent, label: 'Orphan cards in the biggest batch' })"
    >
      <span aria-hidden="true" class="font-bold" :style="{ color: BATCH.accent }">↳</span>
      <span class="flex-1">{{ insight }}</span>
      <span class="text-xs font-semibold" :style="{ color: BATCH.accent }">Show</span>
    </button>

    <ul class="m-0 list-none px-2 pb-2.5">
      <li
        v-for="i in shown"
        :key="i.task_id"
        class="flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 hover:bg-(--ab-row-hover)"
        :class="hl.card.value === i.task_id ? 'bg-(--ab-row-hover)' : ''"
        @pointerenter="hl.card.value = i.task_id"
        @pointerleave="hl.card.value = ''"
        @focusin="hl.card.value = i.task_id"
        @focusout="hl.card.value = ''"
      >
        <span
          aria-hidden="true"
          class="box-border size-2.5 flex-none rounded-[3px]"
          :style="hl.swatch(i.task_id).hollow ? { border: `2px solid ${hl.swatch(i.task_id).color}` } : { background: hl.swatch(i.task_id).color }"
        />
        <NuxtLink :to="{ path: '/board', query: { task: i.task_id } }" class="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink no-underline hover:underline">{{ i.title }}</NuxtLink>
        <span
          v-if="prio(i.task_id)"
          class="flex-none rounded px-1.5 text-xs font-semibold"
          :style="{ background: prio(i.task_id)!.bg, color: prio(i.task_id)!.fg }"
        >{{ prio(i.task_id)!.label }}</span>
        <span class="flex-none font-mono text-xs text-text3 max-[559px]:hidden">{{ i.task_id }}</span>
        <span class="w-11 flex-none text-right text-xs text-text3">{{ ageOf(hl.cards.value.get(i.task_id)?.created ?? '') }}</span>
      </li>
    </ul>
    <button v-if="total > SHOWN" type="button" class="mb-3 ml-[18px] h-[26px] cursor-pointer border-0 bg-transparent p-0.5 text-xs font-semibold text-(--ab-blue-link)" @click="more = !more">
      {{ more ? 'Show fewer' : `Show ${total - SHOWN} more` }}
    </button>
  </ReportPanel>
</template>
