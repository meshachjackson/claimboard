// Backlog cap: a Backlog column (or lane cell) shows only its top cards so 77 waiting cards do not bury the working columns.
// "Show all M" expands one column; the count in the column header always stays the full total.
import type { CardView } from '~/stores/board'
import { normalizePriority } from '~/utils/priority'

/** How many Backlog cards show before "Show all". Other columns are never capped. */
export const BACKLOG_CAP = 15

const RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** Most urgent first, then newest first. Free-text priorities rank after the known ones. Pinned cards keep the lead. */
export function backlogOrder(cards: CardView[]): CardView[] {
  const rank = (c: CardView) => RANK[normalizePriority(c.task.priority)] ?? 4
  const made = (c: CardView) => Date.parse(c.task.created_at) || 0
  return [...cards].sort((a, b) =>
    (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1)
    || rank(a) - rank(b)
    || made(b) - made(a)
    || b.task.task_id.localeCompare(a.task.task_id))
}

/** The cards to draw and how many are folded away. At or under `n`, or expanded, nothing is cut. */
export function capColumn(cards: CardView[], n: number, expanded: boolean): { cards: CardView[], hidden: number } {
  if (expanded || cards.length <= n) return { cards, hidden: 0 }
  const ordered = backlogOrder(cards)
  return { cards: ordered.slice(0, n), hidden: ordered.length - n }
}
