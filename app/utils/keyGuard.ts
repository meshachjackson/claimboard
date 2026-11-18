// The guard every board shortcut shares (see useBoardKeys).

interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  /** A DOM event's target, or anything with `closest` (the tests pass a stub). */
  target: EventTarget | { closest: (selector: string) => unknown } | null
}

/** Whether a key press may trigger a shortcut at all. */
export function keyGuard(e: KeyLike, blocked: boolean): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || blocked) return false
  const target = e.target as { closest?: (selector: string) => unknown } | null
  return !target?.closest?.('input, textarea, select, [contenteditable]')
}
