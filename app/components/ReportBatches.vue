<script setup lang="ts">
// Batchable cards: one row per batch, "12 build cards", its project and who it is for, then a square for each card.
// Hover a row to light the batch on the map; "Select batch" (on hover) opens the board with those cards checked.
import { projectColor, REPORT_TOOL_LOOKS } from '~/types/board'
import type { ReportItem, ReportSection } from '~/utils/report'

const props = defineProps<{ section: ReportSection, items: ReportItem[] }>()
const hl = useReportHighlight()
const board = useBoardStore()
const look = REPORT_TOOL_LOOKS.batchable!

const label = (b: ReportItem) => `${b.task_ids?.length ?? 0} ${b.type} cards`
const select = (index: number) => navigateTo({ path: '/board', query: { report: `${props.section.tool}:${index}`, select: 'all' } })
</script>

<template>
  <ReportPanel :id="`sec-${section.tool}`" :title="section.title" :summary="section.summary" :look="look" :count="section.count" :pinned="hl.isPinned(`tool:${section.tool}`)">
    <ul class="m-0 list-none px-2 pb-3">
      <li
        v-for="(b, index) in items"
        :key="b.task_id + b.title"
        class="group flex flex-col gap-[7px] rounded-lg px-2.5 py-[9px] hover:bg-(--ab-row-hover) focus-within:bg-(--ab-row-hover)"
        :class="hl.isHovered(`batch:${index}`) ? 'bg-(--ab-row-hover)' : ''"
        @pointerenter="hl.enter(`batch:${index}`, b.task_ids ?? [], { accent: look.accent, label: label(b) })"
        @pointerleave="hl.leave()"
        @focusin="hl.enter(`batch:${index}`, b.task_ids ?? [], { accent: look.accent, label: label(b) })"
        @focusout="hl.leave()"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-[13px] font-bold whitespace-nowrap">{{ label(b) }}</span>
          <span class="inline-flex min-w-0 items-center gap-[5px] text-xs whitespace-nowrap text-text2">
            <span aria-hidden="true" class="size-2 rounded-xs" :style="{ background: projectColor(b.project ?? '', hl.projects.value) }" />{{ b.project || 'No project' }}
          </span>
          <span class="min-w-0 truncate text-xs text-text3">· {{ b.who ? board.nameOf(b.who) : 'Unassigned' }}</span>
          <button
            type="button"
            class="ml-auto h-[26px] flex-none cursor-pointer rounded-[7px] border border-(--color-input) bg-transparent px-[9px] text-xs font-semibold text-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-(--ab-row-hover) max-[559px]:opacity-100"
            @click="select(index)"
          >
            Select batch
          </button>
        </div>
        <div aria-hidden="true" class="flex flex-wrap gap-0.5">
          <span
            v-for="id in b.task_ids"
            :key="id"
            class="box-border size-[18px] rounded"
            :style="{
              background: hl.swatch(id).hollow ? 'transparent' : hl.swatch(id).color,
              border: hl.swatch(id).hollow ? `2px solid ${hl.swatch(id).color}` : '0',
              boxShadow: hl.card.value === id ? '0 0 0 2px var(--ab-bar), 0 0 0 4px var(--color-ink)' : 'none'
            }"
            @pointerenter="hl.card.value = id"
            @pointerleave="hl.card.value = ''"
          />
        </div>
      </li>
    </ul>
  </ReportPanel>
</template>
