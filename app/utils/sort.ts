// Column sort: one key for the board, a direction per column (useColumnSort).
import type { SortKey } from '~/types/board'
import type { CardView } from '~/stores/board'
import { normalizePriority } from '~/utils/priority'

// Free-text priorities rank after the known ones.
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

function value(card: CardView, key: SortKey): string | number {
  const t = card.task
  switch (key) {
    case 'created': return Date.parse(t.created_at) || 0
    case 'updated': return Date.parse(t.updated_at) || 0
    // Ascending priority means most urgent first.
    case 'priority': return -(PRIORITY_RANK[normalizePriority(t.priority)] ?? 4)
    case 'due': return t.due_at ? Date.parse(t.due_at) : Number.MAX_SAFE_INTEGER
    case 'title': return t.title.toLowerCase()
  }
}

/**
 * A sorted copy. Pinned cards come first whatever the key or direction. Ties fall back to task_id,
 * newest first, so the order never jumps between reads.
 */
export function sortCards(cards: CardView[], key: SortKey, desc: boolean): CardView[] {
  return [...cards].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const x = value(a, key)
    const y = value(b, key)
    const c = x < y ? -1 : x > y ? 1 : 0
    return (desc ? -c : c) || b.task.task_id.localeCompare(a.task.task_id)
  })
}
