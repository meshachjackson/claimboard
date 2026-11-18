<script setup lang="ts">
// Project progress: one row per project, a square for each card, done first. Done is solid, in flight (architecture,
// build, review) is the same color at 45%, not started is a ring. Then the percent done and a badge for the projects
// close to done or behind. Every row lights its project's cards on the map.
import { projectColor, REPORT_TOOL_LOOKS } from '~/types/board'
import type { ReportProject, ReportSection } from '~/utils/report'
import { isBehind, isCloseToDone } from '~/utils/report'

const props = defineProps<{ section: ReportSection, rows: ReportProject[] }>()
const hl = useReportHighlight()
const look = REPORT_TOOL_LOOKS[props.section.tool === 'progress' ? 'progress' : props.section.tool]!

const RANK: Record<string, number> = { done: 0, review: 1, build: 2, architecture: 3, backlog: 4 }

const view = computed(() => props.rows.map((p) => {
  const color = projectColor(p.project, hl.projects.value)
  const units = p.task_ids.map(id => hl.cards.value.get(id)!).filter(Boolean)
    .map(c => ({ id: c.id, done: c.stage === 'done' || c.state === 'done', started: c.stage !== 'backlog' }))
    .sort((a, b) => (a.done ? 0 : RANK[hl.cards.value.get(a.id)!.stage] ?? 4) - (b.done ? 0 : RANK[hl.cards.value.get(b.id)!.stage] ?? 4))
  const badge = !p.project ? null
    : isCloseToDone(p) && !isBehind(p) ? { text: `${p.open} left`, good: true }
      : p.overdue ? { text: `${p.overdue} overdue`, good: false } : null
  return {
    p, color, units, badge, key: `proj:${p.project}`,
    name: p.project || 'No project',
    pct: `${p.total ? Math.round((p.done / p.total) * 100) : 0}%`,
    stat: `${p.done} of ${p.total} done${p.in_flight ? ` · ${p.in_flight} in flight` : ''}`
  }
}))

// Done is solid, in flight is 45% of the color, not started is a ring.
function unitStyle(u: { id: string, done: boolean, started: boolean }, color: string) {
  const ring = hl.card.value === u.id ? '0 0 0 2px var(--ab-bar), 0 0 0 4px var(--color-ink)' : 'none'
  if (u.done) return { background: color, boxShadow: ring }
  if (u.started) return { background: `color-mix(in srgb, ${color} 45%, transparent)`, boxShadow: ring }
  return { border: `2px solid ${color}`, boxShadow: ring }
}
</script>

<template>
  <ReportPanel :id="`sec-${section.tool}`" :title="section.title" :summary="section.summary" :look="look" :count="section.count || undefined" :pinned="hl.isPinned(`tool:${section.tool}`)">
    <template #actions>
      <div aria-label="Key" class="flex flex-wrap items-center gap-3 text-xs text-text3">
        <span class="inline-flex items-center gap-1.5"><span class="size-3 rounded-[3px] bg-(--ab-neutral-dot)" />Done</span>
        <span class="inline-flex items-center gap-1.5"><span class="size-3 rounded-[3px] bg-(--ab-neutral-dot) opacity-45" />In flight</span>
        <span class="inline-flex items-center gap-1.5"><span class="box-border size-3 rounded-[3px] border-2 border-(--ab-neutral-dot)" />Not started</span>
      </div>
    </template>
    <ul class="m-0 list-none px-2 pb-3">
      <li
        v-for="r in view"
        :key="r.key"
        tabindex="0"
        class="grid grid-cols-1 items-center gap-1.5 rounded-lg px-2.5 py-2 hover:bg-(--ab-row-hover) min-[560px]:grid-cols-[150px_minmax(0,1fr)] min-[560px]:gap-4 min-[1001px]:grid-cols-[170px_minmax(0,1fr)_240px]"
        :class="hl.isHovered(r.key) ? 'bg-(--ab-row-hover)' : ''"
        @pointerenter="hl.enter(r.key, r.p.task_ids, { label: r.name })"
        @pointerleave="hl.leave()"
        @focus="hl.enter(r.key, r.p.task_ids, { label: r.name })"
        @blur="hl.leave()"
      >
        <span class="inline-flex min-w-0 items-center gap-2">
          <span aria-hidden="true" class="size-2.5 flex-none rounded-[3px]" :style="{ background: r.color }" />
          <span class="truncate text-[13px] font-semibold">{{ r.name }}</span>
        </span>
        <span aria-hidden="true" class="flex flex-wrap gap-0.5">
          <span
            v-for="u in r.units"
            :key="u.id"
            class="box-border size-4 rounded"
            :style="unitStyle(u, r.color)"
            @pointerenter.stop="hl.card.value = u.id"
            @pointerleave="hl.card.value = ''"
          />
        </span>
        <span class="flex items-center gap-2 text-xs whitespace-nowrap text-text2 min-[560px]:col-start-2 min-[1001px]:col-start-auto">
          <strong class="text-sm text-ink">{{ r.pct }}</strong>
          <span>{{ r.stat }}</span>
          <span
            v-if="r.badge"
            class="rounded-full px-[7px] py-px text-xs font-bold"
            :style="r.badge.good ? { background: 'var(--ab-green-bg)', color: 'var(--ab-green-fg)' } : { background: 'var(--ab-red-bg)', color: 'var(--ab-red-text)' }"
          >{{ r.badge.text }}</span>
        </span>
      </li>
    </ul>
  </ReportPanel>
</template>
