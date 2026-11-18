// The client side of the event feed: when steps live in Postgres the page polls GET /api/board/feed and
// merges what comes back into the store, instead of waiting for the 5-minute snapshot. Pure functions, no Nuxt imports.
import type { GovTaskNote, GovTaskStep } from '~/types/board'

/** How often the page asks for new events. Inside the 2 to 5 second budget, so a finished step shows within 5 seconds. */
export const FEED_POLL_MS = 3000

export interface FeedReply { cursor: number, events: { seq: number, task_id: string, step_id: string, kind: string }[], steps: GovTaskStep[], notes: GovTaskNote[] }

/**
 * Applies one feed reply to the rows on screen and returns new arrays (the inputs are not changed).
 * A step replaces the one with the same step_id unless the incoming row is older; an unknown step is added.
 * A note is added once, by note_id. Replaying the same reply changes nothing.
 */
export function mergeFeed(steps: GovTaskStep[], notes: GovTaskNote[], feed: Pick<FeedReply, 'steps' | 'notes'>): { steps: GovTaskStep[], notes: GovTaskNote[] } {
  const nextSteps = [...steps]
  for (const incoming of feed.steps) {
    const i = nextSteps.findIndex(s => s.step_id === incoming.step_id)
    if (i < 0) nextSteps.push(incoming)
    else if (Date.parse(incoming.updated_at ?? '') >= Date.parse(nextSteps[i]!.updated_at ?? '')) nextSteps[i] = incoming
  }
  const seen = new Set(notes.map(n => n.note_id))
  const nextNotes = [...notes, ...feed.notes.filter(n => !seen.has(n.note_id))]
  return { steps: nextSteps, notes: nextNotes }
}
