// Priority is free text. Other tools' words ("medium") fold onto the editor's choices for display, counts and sorting;
// the stored value is never rewritten.
import { PRIORITY_LABELS, PRIORITY_SYNONYMS } from '~/types/board'

export function normalizePriority(priority: string): string {
  const v = priority.trim().toLowerCase()
  return PRIORITY_SYNONYMS[v] ?? v
}

/** "Normal" for "medium"; free text the labels don't know is shown as stored. */
export function priorityLabel(priority: string): string {
  return PRIORITY_LABELS[normalizePriority(priority)] ?? priority
}
