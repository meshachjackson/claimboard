// The goal contract every card carries (hands-off board, phase B): goal, "done when", budget.
// It lives in fields the card already has, so no schema change: original_request, acceptance_requirements and a budget-N tag.
import type { GovTask, GovTaskStep } from '~/types/board'
import { CHAT_ROLE } from '~/types/board'
import { splitList, splitRequirements } from '~/utils/format'

export const DEFAULT_BUDGET = 4
/** A retry step's goal starts with this, so the board retries a failed step only once. */
export const RETRY_PREFIX = 'retry:'

/** Attempts a card may use: tag `budget-N` with N from 1 to 20, else 4. */
export function loopBudget(tags: string[]): number {
  for (const tag of tags) {
    const m = /^budget-(\d{1,2})$/.exec(tag)
    const n = m ? Number(m[1]) : 0
    if (n >= 1 && n <= 20) return n
  }
  return DEFAULT_BUDGET
}

export interface GoalContract {
  goal: string
  doneWhen: string[]
  budget: number
}

export function goalContract(task: Pick<GovTask, 'original_request' | 'acceptance_requirements' | 'tags'>): GoalContract {
  return {
    goal: task.original_request,
    doneWhen: splitRequirements(task.acceptance_requirements ?? ''),
    budget: loopBudget(splitList(task.tags))
  }
}

/** Steps of a role that were not cancelled: the attempts the card has used. Chat steps never count. */
export function attemptsFor(steps: GovTaskStep[], role: string): number {
  return steps.filter(x => x.cancelled !== true && x.role !== CHAT_ROLE && x.role === role).length
}
