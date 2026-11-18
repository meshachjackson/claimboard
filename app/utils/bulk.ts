// Multi-select and bulk edit, as plain functions. A bulk edit is the same single-card edit the board
// already has, repeated per card; this file only decides which cards the edit applies to and what each card's fields become.
import type { BulkKind, Stage } from '~/types/board'
import { PRIORITIES } from '~/types/board'

/** The slice of a card a bulk edit looks at. CardView satisfies it. */
export interface BulkCard {
  stage: Stage
  workState: string
  archived: boolean
  pinned: boolean
  tags: string[]
  task: { task_id: string, assignee: string, priority: string, task_type: string, project_id: string, due_at: string | null, approval_state: string }
}

export interface BulkEdit { kind: BulkKind, value: string }

/** Why a card is left out of a bulk edit (shown to the owner), or '' when the edit applies. */
export function skipReason(card: BulkCard, edit: BulkEdit): string {
  const t = card.task
  if (card.archived) return 'archived'
  const done = card.workState === 'done'
  switch (edit.kind) {
    case 'stage': return card.stage === edit.value ? 'already there' : ''
    case 'archive': return !done ? 'not Done' : card.pinned ? 'pinned' : ''
    // Delete is the bar's own button: it takes any card, clearing steps, stage and pin first (board.remove).
    case 'delete': return ''
    case 'pin': return card.pinned ? 'already pinned' : ''
    case 'unpin': return card.pinned ? '' : 'not pinned'
    // update_task and assign refuse Done cards.
    case 'assignee': return done ? 'Done' : t.assignee === edit.value ? 'already assigned' : ''
    case 'priority': return done ? 'Done' : t.priority === edit.value ? 'already set' : ''
    case 'task_type': return done ? 'Done' : t.task_type === edit.value ? 'already set' : ''
    case 'project_id': return done ? 'Done' : t.project_id === edit.value ? 'already set' : ''
    case 'add_tag': return done ? 'Done' : card.tags.includes(edit.value) ? 'already tagged' : ''
    case 'remove_tag': return done ? 'Done' : card.tags.includes(edit.value) ? '' : 'not tagged'
    // due_at is stored as a date or date-time; the edit is a day, so compare days.
    case 'due_at': return done ? 'Done' : dayOf(t.due_at) === edit.value ? 'already set' : ''
    case 'clear_due': return done ? 'Done' : t.due_at ? '' : 'no due date'
    // approve_task only takes a pending gate; a plan approval is a different op and stays a single-card act.
    case 'approve': return done ? 'Done' : t.approval_state === 'pending' ? '' : 'not pending'
  }
}

/** The day part of a stored due date ('' when there is none). */
export function dayOf(dueAt: string | null): string {
  return (dueAt ?? '').slice(0, 10)
}

/** A due date the bar accepts: YYYY-MM-DD that parses. */
export function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

/** Which selected cards the edit runs on, in the order given, and which it skips and why. */
export function planBulk(cards: BulkCard[], edit: BulkEdit): { run: string[], skipped: { id: string, why: string }[] } {
  const run: string[] = []
  const skipped: { id: string, why: string }[] = []
  for (const c of cards) {
    const why = skipReason(c, edit)
    if (why) skipped.push({ id: c.task.task_id, why })
    else run.push(c.task.task_id)
  }
  return { run, skipped }
}

/** The update_task fields for the field edits; null for edits that go through another op. */
export function fieldsFor(card: BulkCard, edit: BulkEdit): Record<string, string> | null {
  switch (edit.kind) {
    case 'priority': return { priority: edit.value }
    case 'task_type': return { task_type: edit.value }
    case 'project_id': return { project_id: edit.value }
    case 'add_tag': return { tags: [...card.tags, edit.value].join(',') }
    case 'remove_tag': return { tags: card.tags.filter(t => t !== edit.value).join(',') }
    case 'due_at': return { due_at: edit.value }
    case 'clear_due': return { due_at: '' } // a blank due_at clears it (update_task stores null)
    default: return null
  }
}

/** Tags are lowercase slugs (create_task refuses anything else); fix the easy cases. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-')
}

/**
 * Whether the edit has what it needs to run. A blank assignee is a real edit (unassign); pin, unpin, archive, clear_due
 * and approve need no value; a due date must be a real day.
 */
export function editReady(edit: BulkEdit): boolean {
  if (['pin', 'unpin', 'archive', 'assignee', 'clear_due', 'approve'].includes(edit.kind)) return true
  if (edit.kind === 'priority') return (PRIORITIES as readonly string[]).includes(edit.value)
  if (edit.kind === 'due_at') return isDay(edit.value)
  return edit.value.trim() !== ''
}

// ---------- Selection ----------

/** Add the id, or remove it if it is already in. A new array; the input is not changed. */
export function toggleId(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
}

/** Drop ids that are no longer on screen (a filter changed, a card was archived). An edit never reaches a hidden card. */
export function pruneSelection(selected: string[], visible: string[]): string[] {
  const shown = new Set(visible)
  const kept = selected.filter(id => shown.has(id))
  return kept.length === selected.length ? selected : kept
}

/** Header checkbox: everything shown when anything is missing, else nothing. */
export function toggleAll(selected: string[], visible: string[]): string[] {
  return visible.length > 0 && visible.every(id => selected.includes(id)) ? [] : [...visible]
}

/** Header checkbox state. */
export function selectionState(selected: string[], visible: string[]): 'all' | 'some' | 'none' {
  const n = visible.filter(id => selected.includes(id)).length
  return n === 0 ? 'none' : n === visible.length ? 'all' : 'some'
}

/** Shift-click: every id from the last clicked row to this one, in the order shown, added to the selection. */
export function selectRange(selected: string[], visible: string[], from: string, to: string): string[] {
  const a = visible.indexOf(from)
  const b = visible.indexOf(to)
  if (a < 0 || b < 0) return toggleId(selected, to)
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return [...new Set([...selected, ...visible.slice(lo, hi + 1)])]
}
