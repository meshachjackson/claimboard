// The lamp colors of a Floor zone (direction B), shared by the zone head and its folded strip: amber for Needs you
// (lit only while something waits), ink for On the floor, green for Shipped.
export type FloorTone = 'amber' | 'floor' | 'run'

export function zoneLook(tone: FloorTone, count: number): string {
  if (tone === 'amber') return count ? 'bg-(--ab-amber) text-(--ab-amber-fg)' : 'bg-surface text-ink'
  return tone === 'floor' ? 'bg-(--ab-floor) text-(--ab-floor-fg)' : 'bg-(--ab-run) text-(--ab-run-fg)'
}

/** A zero on the floor is dimmed: nothing working is a fact to notice, not a number to celebrate. */
export const dimZero = (tone: FloorTone, count: number) => tone === 'floor' && count === 0 ? 'text-(--ab-floor-dim)' : ''
