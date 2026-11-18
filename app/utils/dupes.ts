// Finds duplicate cards and plans a merge. Pure functions, so the rules are tested without the store.
import type { GovTask, GovTaskStep } from '~/types/board'
import { holdsCardOut } from '~/utils/boardOps'

export const normalizeTitle = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ')

/** Groups of two or more matching cards (not archived), each oldest first. */
export function findDupes(tasks: GovTask[]): GovTask[][] {
  const byTitle = new Map<string, GovTask[]>()
  for (const t of tasks) {
    if (t.archived_at) continue
    const key = normalizeTitle(t.title)
    if (key) byTitle.set(key, [...(byTitle.get(key) ?? []), t])
  }
  return [...byTitle.values()]
    .filter(g => g.length > 1)
    .map(g => g.sort((a, b) => a.created_at.localeCompare(b.created_at)))
}

const isDone = (t: GovTask) => t.work_state === 'done' || t.stage === 'done'

/** The suggested keeper of a group: a pinned card, else one still open, else the oldest. The owner can pick another. */
export function suggestKeeper(group: GovTask[]): string {
  const rank = (t: GovTask) => (t.pinned_at ? 0 : isDone(t) ? 2 : 1)
  // Array.sort is stable, so equal ranks stay oldest first.
  return [...group].sort((a, b) => rank(a) - rank(b))[0]!.task_id
}

/** Why a duplicate can't be removed, or '' when it can. Pinned cards are never removed; a step an agent is running is left alone. */
export function keepReason(t: GovTask, steps: GovTaskStep[]): string {
  if (t.pinned_at) return 'pinned'
  const running = steps.some(s => s.task_id === t.task_id && s.cancelled !== true && s.step_state === 'dispatched' && !s.acked_at)
  return running ? 'an agent is working on it' : ''
}

export interface MergePlan {
  keeper: string
  /** Duplicates to close and archive, with the open steps each one has to cancel first. */
  remove: { task: GovTask, cancel: GovTaskStep[] }[]
  /** Duplicates that stay on the board, with the reason. */
  kept: { task: GovTask, reason: string }[]
}

/** The preview for one group: what the merge would do to each non-keeper card. Nothing here writes. */
export function planMerge(group: GovTask[], steps: GovTaskStep[], keeper: string): MergePlan {
  const plan: MergePlan = { keeper, remove: [], kept: [] }
  for (const task of group) {
    if (task.task_id === keeper) continue
    const reason = keepReason(task, steps)
    if (reason) plan.kept.push({ task, reason })
    else plan.remove.push({ task, cancel: steps.filter(s => s.task_id === task.task_id && holdsCardOut(s)) })
  }
  return plan
}
