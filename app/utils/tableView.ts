// The table view's sort. The search box and filter panel (which now carries Stage and Priority) narrow the
// cards; the table sorts any column.
import type { Stage, TableSortKey } from '~/types/board'
import { STAGES } from '~/types/board'
import { STAGE_LABELS, TASK_TYPE_LABELS } from '~/types/board'
import { formatDate } from '~/utils/format'
import { normalizePriority, priorityLabel } from '~/utils/priority'
import { epicOf, milestoneOf } from '~/utils/planning'

/** The slice of a card the table reads. CardView satisfies it. */
export interface TableRow {
  stage: Stage
  workState: string
  assignee: string
  pinned: boolean
  tags?: string[]
  task: { task_id: string, title: string, project_id: string, task_type: string, priority: string, due_at: string | null, updated_at: string }
}

// Free-text priorities rank after the known ones, like the board's column sort.
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
const STAGE_RANK: Record<string, number> = Object.fromEntries(STAGES.map((s, i) => [s, i]))

function value(r: TableRow, key: TableSortKey, nameOf: (id: string) => string): string | number {
  const t = r.task
  switch (key) {
    case 'id': return t.task_id
    case 'title': return t.title.toLowerCase()
    case 'stage': return STAGE_RANK[r.stage] ?? 99
    case 'state': return r.workState
    case 'assignee': return r.assignee ? nameOf(r.assignee).toLowerCase() : '￿' // unassigned last
    case 'project': return t.project_id.toLowerCase() || '￿'
    case 'epic': return epicOf(r.tags ?? []) || '￿' // unplanned last
    case 'milestone': return milestoneOf(r.tags ?? []) || '￿'
    case 'type': return t.task_type
    case 'priority': return PRIORITY_RANK[normalizePriority(t.priority)] ?? 4 // ascending is most urgent first
    case 'due': return t.due_at ? Date.parse(t.due_at) : Number.MAX_SAFE_INTEGER // no date last
    case 'updated': return Date.parse(t.updated_at) || 0
  }
}

/**
 * A sorted copy. Pinned rows come first whatever the key or direction, as on the board. Ties fall back to
 * task_id, newest first, so the order never jumps between reads.
 */
export function sortRows<T extends TableRow>(rows: T[], key: TableSortKey, desc: boolean, nameOf: (id: string) => string): T[] {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const x = value(a, key, nameOf)
    const y = value(b, key, nameOf)
    const c = x < y ? -1 : x > y ? 1 : 0
    return (desc ? -c : c) || b.task.task_id.localeCompare(a.task.task_id)
  })
}

/** The text a cell shows, which is what a column filter matches against. */
export function cellText(r: TableRow, key: TableSortKey, nameOf: (id: string) => string): string {
  const t = r.task
  switch (key) {
    case 'id': return t.task_id
    case 'title': return t.title
    case 'stage': return STAGE_LABELS[r.stage]
    case 'state': return r.workState
    case 'assignee': return nameOf(r.assignee)
    case 'project': return t.project_id
    case 'type': return TASK_TYPE_LABELS[t.task_type as keyof typeof TASK_TYPE_LABELS] ?? t.task_type
    case 'epic': return epicOf(r.tags ?? [])
    case 'milestone': return milestoneOf(r.tags ?? [])
    case 'priority': return priorityLabel(t.priority)
    case 'due': return formatDate(t.due_at)
    case 'updated': return formatDate(t.updated_at)
  }
}

/** Rows whose cell contains every non-empty column filter (case-insensitive). */
export function filterRows<T extends TableRow>(rows: T[], filters: Partial<Record<TableSortKey, string>>, nameOf: (id: string) => string): T[] {
  const active = Object.entries(filters).filter(([, v]) => v?.trim()) as [TableSortKey, string][]
  if (!active.length) return rows
  return rows.filter(r => active.every(([k, v]) => cellText(r, k, nameOf).toLowerCase().includes(v.trim().toLowerCase())))
}

/** What a header click gives: the same column flips direction, a new column starts ascending. */
export function nextSort(current: { key: TableSortKey, desc: boolean }, clicked: TableSortKey): { key: TableSortKey, desc: boolean } {
  return current.key === clicked ? { key: clicked, desc: !current.desc } : { key: clicked, desc: false }
}
