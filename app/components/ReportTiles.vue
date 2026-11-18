<script setup lang="ts">
// One tile per finding: the count at 44px, one line of context, and a strip of squares, one per card the finding covers.
// Hover or focus lights those cards on the map; click pins them and scrolls to the section; click again to clear.
import { REPORT_TOOL_LOOKS } from '~/types/board'
import { FINDING_TOOLS } from '~/utils/report'
import type { Report, ReportSection } from '~/utils/report'

const props = defineProps<{ report: Report }>()
const hl = useReportHighlight()

const DOTS = 40 // squares drawn per tile; the count says the rest

const open = computed(() => [...hl.cards.value.values()].filter(c => c.state !== 'done' && c.stage !== 'done').length)

function words(s: ReportSection): { unit: string, context: string } {
  const b = s.block
  if (s.tool === 'orphans') return { unit: s.count === 1 ? 'card' : 'cards', context: `of ${open.value} open cards ${s.count === 1 ? 'has' : 'have'} no project and nobody on them.` }
  if (s.tool === 'batchable') return { unit: `in ${b.total} ${b.total === 1 ? 'batch' : 'batches'}`, context: 'Backlog cards one agent could take together.' }
  if (s.tool === 'almost_done') {
    const first = b.kind === 'projects' ? b.rows[0] : undefined
    return { unit: s.count === 1 ? 'project' : 'projects', context: first ? `${first.project} has ${first.open} left.` : 'No project is down to its last one or two cards.' }
  }
  if (s.tool === 'behind') {
    const first = b.kind === 'projects' ? b.rows[0] : undefined
    return { unit: s.count === 1 ? 'project' : 'projects', context: first ? `${first.project} has ${first.overdue} overdue.` : 'No project has most of its open cards overdue.' }
  }
  const late = s.task_ids.map(id => id.replace('TSK-', ''))
  return { unit: s.count === 1 ? 'card' : 'cards', context: late.length ? `${late.slice(0, 3).join(', ')}${late.length > 3 ? ` and ${late.length - 3} more` : ''} past due.` : 'Nothing is past due.' }
}

const tiles = computed(() => props.report.sections.filter(s => (FINDING_TOOLS as readonly string[]).includes(s.tool)).map((s) => {
  const look = REPORT_TOOL_LOOKS[s.tool]!
  const w = words(s)
  return { s, look, key: `tool:${s.tool}`, clear: s.count === 0, ...w, label: `${look.label}: ${s.count} ${w.unit}. ${w.context}` }
}))

function pin(t: (typeof tiles.value)[number]) {
  const was = hl.isPinned(t.key)
  hl.toggle(t.key, t.s.task_ids, { accent: t.look.accent, label: t.look.label })
  if (!was) document.getElementById(`sec-${t.s.tool}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}
</script>

<template>
  <div v-if="tiles.length" class="grid grid-cols-2 gap-2 min-[560px]:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] min-[560px]:gap-3">
    <button
      v-for="t in tiles"
      :key="t.key"
      type="button"
      :aria-pressed="hl.isPinned(t.key)"
      :aria-label="t.label"
      class="ab-tile relative flex min-h-[148px] cursor-pointer flex-col items-stretch gap-1.5 overflow-hidden rounded-[14px] border border-line px-4 pt-3.5 pb-3.5 text-left text-ink"
      :style="{
        background: hl.isPinned(t.key) || hl.isHovered(t.key) ? 'var(--ab-row-hover)' : 'var(--ab-bar)',
        borderColor: hl.isPinned(t.key) || hl.isHovered(t.key) ? t.look.accent : undefined,
        boxShadow: hl.isPinned(t.key) ? `0 0 0 1px ${t.look.accent}, 0 10px 24px rgba(0,0,0,0.25)` : undefined
      }"
      @pointerenter="hl.enter(t.key, t.s.task_ids, { accent: t.look.accent, label: t.look.label })"
      @pointerleave="hl.leave()"
      @focus="hl.enter(t.key, t.s.task_ids, { accent: t.look.accent, label: t.look.label })"
      @blur="hl.leave()"
      @click="pin(t)"
    >
      <span aria-hidden="true" class="absolute top-0 bottom-0 left-0 w-1" :style="{ background: t.look.accent, opacity: t.clear ? 0.25 : 1 }" />
      <span class="flex items-center gap-2 text-[13px] font-semibold text-text2">
        <span
          aria-hidden="true"
          class="inline-flex size-[22px] items-center justify-center rounded-md text-xs font-bold"
          :style="t.clear ? { background: 'var(--ab-neutral-bg)', color: t.look.accent } : { background: t.look.bg, color: t.look.accent }"
        >{{ t.look.glyph }}</span>
        {{ t.look.label }}
      </span>
      <span class="flex items-baseline gap-2">
        <span class="ab-big text-[34px] leading-none font-bold tracking-[-0.02em] min-[560px]:text-[44px]" :class="t.clear ? 'text-text3' : 'text-ink'" style="font-variant-numeric: proportional-nums">{{ t.s.count }}</span>
        <span class="text-[13px] text-text3">{{ t.unit }}</span>
      </span>
      <span class="text-xs leading-[1.45] text-text3">{{ t.context }}</span>
      <span aria-hidden="true" class="mt-auto flex flex-wrap gap-0.5 pt-1">
        <span
          v-for="id in t.s.task_ids.slice(0, DOTS)"
          :key="id"
          class="box-border size-2 rounded-xs"
          :style="hl.swatch(id).hollow ? { border: `1.5px solid ${hl.swatch(id).color}` } : { background: hl.swatch(id).color }"
        />
        <span v-if="t.clear" class="inline-flex items-center gap-1.5 text-xs font-semibold text-(--ab-green-fg)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10" /></svg>
          All clear
        </span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.ab-tile { transition: transform 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease; }
.ab-tile:hover, .ab-tile:focus-visible { transform: translateY(-2px); }
@media (prefers-reduced-motion: reduce) {
  .ab-tile { transition: none; }
  .ab-tile:hover, .ab-tile:focus-visible { transform: none; }
}
</style>
