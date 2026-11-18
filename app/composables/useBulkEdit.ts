// Runs a bulk edit: the same store call a single-card edit makes, once per card, in order. Every write
// goes through board.run, so permissions, stale checks and refusals are the gateway's, not this file's. It stops at the
// first refusal, like the Done cleanup, so a bad edit doesn't repeat itself across the whole selection.
import { ref } from 'vue'
import type { CardView } from '~/stores/board'
import type { Stage } from '~/types/board'
import type { BulkEdit } from '~/utils/bulk'
import { fieldsFor, planBulk } from '~/utils/bulk'

export interface BulkResult { done: number, of: number, skipped: { id: string, why: string }[], stoppedAt: string, reason: string }

const progress = ref<{ n: number, of: number } | null>(null)

export function useBulkEdit() {
  const board = useBoardStore()

  /** The cards (from the current board) the edit would run on and the ones it would skip. */
  const plan = (cards: CardView[], edit: BulkEdit) => planBulk(cards, edit)

  /** One card: true when the write went through. A refusal is read from the store, which also toasts it. */
  async function one(id: string, edit: BulkEdit): Promise<boolean> {
    board.lastRefusal = null
    switch (edit.kind) {
      case 'stage': await board.moveTask(id, edit.value as Stage); break
      case 'assignee': await board.assign(id, edit.value); break
      case 'pin': return board.setPinned(id, true)
      case 'unpin': return board.setPinned(id, false)
      case 'archive': return board.archive(id)
      case 'delete': return (await board.remove(id)) && !board.lastRefusal
      // The plan only lets pending gates through, so this is always approve_task, never approve_plan.
      case 'approve': await board.approve(id); break
      default: {
        // Read the card again each time: the last write may have changed it, and add_tag and remove_tag keep the other tags.
        const card = board.cards.find(c => c.task.task_id === id)
        const fields = card && fieldsFor(card, edit)
        return !!fields && board.updateTask(id, fields)
      }
    }
    return !board.lastRefusal
  }

  async function run(cards: CardView[], edit: BulkEdit): Promise<BulkResult> {
    const { run: ids, skipped } = plan(cards, edit)
    const result: BulkResult = { done: 0, of: ids.length, skipped, stoppedAt: '', reason: '' }
    progress.value = { n: 0, of: ids.length }
    for (const id of ids) {
      if (!await one(id, edit)) {
        result.stoppedAt = id
        result.reason = board.lastRefusal?.reason ?? 'refused'
        break
      }
      result.done += 1
      progress.value = { n: result.done, of: ids.length }
    }
    progress.value = null
    return result
  }

  return { plan, run, progress }
}
