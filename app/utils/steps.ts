import type { GovTaskStep } from '~/types/board'

// Steps done vs open for a card's active steps. Only `verified` is done; every other state (failed and needs_input included) is still open.
export function stepCounts(steps: Pick<GovTaskStep, 'step_state'>[]): { done: number, open: number } {
  const done = steps.filter(s => s.step_state === 'verified').length
  return { done, open: steps.length - done }
}
