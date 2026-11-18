import type { CardView } from '~/stores/board'
import { parseDate } from './format.ts'

/** Overdue only while the card is still open, and only once the due day has passed. */
export function isOverdue(card: Pick<CardView, 'task' | 'workState'>, now = Date.now()): boolean {
  return !!card.task.due_at && card.workState !== 'done' && parseDate(card.task.due_at).getTime() + 86_400_000 <= now
}

/** True when the card needs the owner: blocked, asking a question, plan awaiting approval, a stranded step, or overdue. */
export function cardNeedsAttention(card: Pick<CardView, 'task' | 'workState' | 'approvalPending' | 'stranded'>, now = Date.now()): boolean {
  return card.workState === 'blocked' || card.workState === 'needs_input' || card.approvalPending || !!card.stranded || isOverdue(card, now)
}
