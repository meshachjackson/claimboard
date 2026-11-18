<script setup lang="ts">
// The report's detail sections, drawn by block kind (docs/design/report/README.md §4): cards → a list or batches,
// projects → progress rows, timeline → due dates, bars → a breakdown. A finding with nothing to say draws no section;
// its tile already says "All clear". A new report tool needs no new component.
import type { Report, ReportSection } from '~/utils/report'

const props = defineProps<{ report: Report }>()

const hasProgress = computed(() => props.report.sections.some(s => s.tool === 'progress'))
const batchTop = computed(() => {
  const b = props.report.sections.find(s => s.tool === 'batchable')?.block
  return b?.kind === 'cards' ? b.items[0] : undefined
})

function drawn(s: ReportSection): boolean {
  const b = s.block
  if (b.kind === 'timeline') return b.items.length > 0
  if (b.kind === 'bars') return b.rows.length > 0
  if (s.tool === 'progress') return b.kind === 'projects' && b.rows.length > 0
  // Close-to-done and behind are shown as badges on the progress rows when those are on the page.
  if ((s.tool === 'almost_done' || s.tool === 'behind') && hasProgress.value) return false
  return s.count > 0
}
const sections = computed(() => props.report.sections.filter(drawn))
</script>

<template>
  <div class="grid grid-cols-1 items-start gap-4 min-[1001px]:grid-cols-2">
    <template v-for="s in sections" :key="s.tool">
      <ReportCardList v-if="s.block.kind === 'cards' && s.tool !== 'batchable'" :section="s" :items="s.block.items" :total="s.block.total" :as-of="report.as_of" :batch="batchTop" />
      <ReportBatches v-else-if="s.block.kind === 'cards'" :section="s" :items="s.block.items" />
      <ReportProgress v-else-if="s.block.kind === 'projects'" :class="s.tool === 'progress' ? 'min-[1001px]:col-span-full' : ''" :section="s" :rows="s.block.rows" />
      <ReportTimeline v-else-if="s.block.kind === 'timeline'" :section="s" :items="s.block.items" :as-of="report.as_of" />
      <ReportBars v-else :section="s" :rows="s.block.rows" :total="s.block.total" />
    </template>
    <p v-if="!report.sections.length" class="m-0 text-sm text-text2 min-[1001px]:col-span-full">No report tools named.</p>
  </div>
</template>
