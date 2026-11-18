<script setup lang="ts">
// Due dates: an axis from 10 days back to 80 days ahead with a Today rule. Late cards are red and say how late;
// upcoming cards are gray and say when. Hover a dot to ring its card on the map.
import { REPORT_TOOL_LOOKS } from '~/types/board'
import type { ReportDue, ReportSection } from '~/utils/report'

const props = defineProps<{ section: ReportSection, items: ReportDue[], asOf: string }>()
const hl = useReportHighlight()
const look = REPORT_TOOL_LOOKS.overdue!

const DAY = 86_400_000
const now = computed(() => Date.parse(props.asOf))
const t0 = computed(() => now.value - 10 * DAY)
const t1 = computed(() => now.value + 80 * DAY)
const xOf = (ms: number) => `${Math.max(0, Math.min(100, ((ms - t0.value) / (t1.value - t0.value)) * 100))}%`
// A bare due day sits at noon on the axis.
const dueAt = (d: ReportDue) => Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(d.due_at) ? `${d.due_at}T12:00:00` : d.due_at)
const md = (ms: number) => `${new Date(ms).getMonth() + 1}/${new Date(ms).getDate()}`
const mdy = (ms: number) => `${md(ms)}/${new Date(ms).getFullYear()}`

const marks = computed(() => props.items.map((d) => {
  const at = dueAt(d)
  const days = Math.max(0, Math.round((now.value - at) / DAY))
  const id = d.task_id.replace('TSK-', '')
  return {
    d, x: xOf(at),
    label: d.late ? `${days}d late · ${id}` : `Due ${md(at)} · ${id}`,
    aria: `${d.task_id}, ${d.title}, ${d.late ? `${days} days late` : `due ${mdy(at)}`}`
  }
}))
</script>

<template>
  <ReportPanel :id="`sec-${section.tool}`" :title="look.label" :summary="section.summary" :look="look" :pinned="hl.isPinned(`tool:${section.tool}`)">
    <div class="relative mx-[18px] mt-1.5 h-16">
      <span aria-hidden="true" class="absolute top-[30px] right-0 left-0 h-px bg-line" />
      <span aria-hidden="true" class="absolute top-1.5 bottom-1.5 w-0.5 rounded-xs bg-ink" :style="{ left: xOf(now) }" />
      <span class="absolute -top-3 -translate-x-1/2 text-xs font-bold text-ink" :style="{ left: xOf(now) }">Today</span>
      <template v-for="m in marks" :key="m.d.task_id">
        <button
          type="button"
          :aria-label="m.aria"
          class="ab-dot absolute top-[22px] -ml-[9px] box-border size-[18px] cursor-pointer rounded-full border-2 border-(--ab-bar) p-0"
          :style="{ left: m.x, background: m.d.late ? 'var(--ab-red)' : 'var(--ab-neutral-dot)', boxShadow: hl.card.value === m.d.task_id ? '0 0 0 2px var(--color-ink)' : 'none' }"
          @pointerenter="hl.card.value = m.d.task_id"
          @pointerleave="hl.card.value = ''"
          @focus="hl.card.value = m.d.task_id"
          @blur="hl.card.value = ''"
        />
        <span class="absolute top-[46px] -translate-x-1/2 text-xs whitespace-nowrap" :class="m.d.late ? 'text-(--ab-red-text)' : 'text-text2'" :style="{ left: m.x }">{{ m.label }}</span>
      </template>
    </div>
    <div class="mx-[18px] mb-3.5 flex justify-between font-mono text-xs text-text3">
      <span>{{ md(t0) }}</span><span>{{ mdy(t1) }}</span>
    </div>
  </ReportPanel>
</template>

<style scoped>
.ab-dot { transition: transform 0.12s ease; }
.ab-dot:hover, .ab-dot:focus-visible { transform: scale(1.25); outline: none; }
@media (prefers-reduced-motion: reduce) { .ab-dot { transition: none; } .ab-dot:hover, .ab-dot:focus-visible { transform: none; } }
</style>
