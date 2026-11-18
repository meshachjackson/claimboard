<script setup lang="ts">
// The view switch (Board v4): Stages and Table as one segmented control of icon buttons. The active one shows its
// label above 1099px. Stages needs no URL key and Table is ?layout=table (see viewPatch); old ?view=flow and ?view=states open Stages.
// `phone` is the 44px floating copy at the bottom left.
import type { BoardView } from '~/types/board'
import { BOARD_VIEWS, BOARD_VIEW_HINTS, BOARD_VIEW_LABELS } from '~/types/board'

defineProps<{ phone?: boolean }>()
const { query, setView } = useBoardFilters()

const active = computed<BoardView>(() => query.value.layout === 'table' ? 'table' : 'stages')
const icons: Record<BoardView, string> = { stages: 'i-lucide-columns-3', table: 'i-lucide-table' }
</script>

<template>
  <div
    role="group"
    aria-label="View"
    class="inline-flex gap-0.5 rounded-lg bg-(--ab-seg-track) p-0.5"
    :class="phone && 'rounded-xl border border-line bg-surface p-1 shadow-[0_8px_24px_rgba(16,24,40,0.18)]'"
  >
    <button
      v-for="(v, i) in BOARD_VIEWS"
      :key="v"
      type="button"
      :aria-pressed="active === v"
      :aria-label="BOARD_VIEW_LABELS[v]"
      :title="`${BOARD_VIEW_LABELS[v]}: ${BOARD_VIEW_HINTS[v]} ( ${i + 1} )`"
      class="inline-flex cursor-pointer items-center gap-1.5 rounded-md text-[13px] font-semibold"
      :class="[phone ? 'h-11 min-w-11 justify-center px-3' : 'h-7 px-2', active === v ? 'bg-(--ab-seg-on) text-ink shadow-[0_1px_2px_rgba(16,24,40,0.08)]' : 'text-text3 hover:text-ink']"
      @click="setView(v)"
    >
      <UIcon :name="icons[v]" class="size-[15px]" />
      <span v-if="active === v" :class="!phone && 'ab-compact-hide'">{{ BOARD_VIEW_LABELS[v] }}</span>
    </button>
  </div>
</template>
