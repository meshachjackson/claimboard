<script setup lang="ts">
// A breakdown: ranked horizontal bars, colored by the field's own colors (state, priority, project), else the first
// project color. Every bar lights its cards on the map.
import {
  PRIORITY_FACET_DOTS, PRIORITY_LABELS, projectColor, REPORT_TOOL_LOOKS, STAGE_LABELS, STATE_FILTER_DOTS, TASK_TYPE_LABELS, WORK_STATE_LABELS
} from '~/types/board'
import type { Stage, TaskType, WorkState } from '~/types/board'
import type { ReportBar, ReportSection } from '~/utils/report'

const props = defineProps<{ section: ReportSection, rows: ReportBar[], total: number }>()
const hl = useReportHighlight()
const board = useBoardStore()
const look = REPORT_TOOL_LOOKS.breakdown!

const field = computed(() => props.section.tool.split(':')[1] || 'work_state')
const FIELD_WORDS: Record<string, string> = { work_state: 'state', project_id: 'project', task_type: 'type' }
const title = computed(() => `Open cards by ${FIELD_WORDS[field.value] ?? field.value}`)

/** A bar's label and fill. Hollow means a ring (Backlog, Low). */
function look1(r: ReportBar): { label: string, color: string, hollow: boolean } {
  const f = field.value
  const v = r.label
  const first = 'var(--ab-proj-1)'
  if (f === 'work_state') return { label: WORK_STATE_LABELS[v as WorkState] ?? v, color: STATE_FILTER_DOTS[v as WorkState] || 'var(--ab-neutral-dot)', hollow: v === 'backlog' }
  if (f === 'priority') return { label: PRIORITY_LABELS[v] ?? v, color: PRIORITY_FACET_DOTS[v] || 'var(--ab-neutral-dot)', hollow: v === 'low' }
  if (f === 'project_id') return { label: v === '(blank)' ? 'No project' : v, color: projectColor(v === '(blank)' ? '' : v, hl.projects.value), hollow: false }
  if (f === 'assignee') return { label: v === '(blank)' ? 'Unassigned' : board.nameOf(v), color: first, hollow: false }
  if (f === 'stage') return { label: STAGE_LABELS[v as Stage] ?? v, color: first, hollow: false }
  if (f === 'task_type') return { label: TASK_TYPE_LABELS[v as TaskType] ?? v, color: first, hollow: false }
  return { label: v, color: first, hollow: false }
}

const bars = computed(() => {
  const max = props.rows[0]?.value || 1
  return props.rows.map(r => ({ r, ...look1(r), w: `${Math.max(3, Math.round((r.value / max) * 100))}%`, key: `bd:${field.value}:${r.label}` }))
})
</script>

<template>
  <ReportPanel :title="title" :summary="`${section.task_ids.length} open cards. Hover a bar to light up its cards.`" :look="look">
    <ul class="m-0 list-none px-2 pb-3.5">
      <li
        v-for="b in bars"
        :key="b.key"
        tabindex="0"
        class="grid h-[30px] grid-cols-[110px_minmax(0,1fr)_36px] items-center gap-2.5 rounded-lg px-2.5 hover:bg-(--ab-row-hover) min-[560px]:grid-cols-[150px_minmax(0,1fr)_36px]"
        :class="hl.isHovered(b.key) ? 'bg-(--ab-row-hover)' : ''"
        @pointerenter="hl.enter(b.key, b.r.task_ids, { label: b.label })"
        @pointerleave="hl.leave()"
        @focus="hl.enter(b.key, b.r.task_ids, { label: b.label })"
        @blur="hl.leave()"
      >
        <span class="truncate text-[13px] text-text2">{{ b.label }}</span>
        <span class="h-3.5 rounded bg-(--ab-row-hover)">
          <span class="box-border block h-3.5 rounded" :style="{ width: b.w, background: b.hollow ? 'transparent' : b.color, border: b.hollow ? `2px solid ${b.color}` : '0' }" />
        </span>
        <span class="text-right font-mono text-xs text-ink">{{ b.r.value }}</span>
      </li>
      <li v-if="total > rows.length" class="px-2.5 pt-1 text-[13px] text-text3">+{{ total - rows.length }} more</li>
    </ul>
  </ReportPanel>
</template>
