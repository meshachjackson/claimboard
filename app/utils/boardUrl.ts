// Pure URL rules for the board (Board v4), kept apart from the composables so they can be tested.
import type { BoardView, DefaultView } from '~/types/board'
import { LEGACY_QUICK } from '~/types/board'
import { splitList } from '~/utils/format'
import { normalizePriority } from '~/utils/priority'

/** Keys that moved: the table's old filters now live in the filter panel under the same names as every other column. */
export const LEGACY_KEYS: Record<string, string> = { tstage: 'stage', tprio: 'priority' }

export const LEGACY_URL_KEYS = ['quick', ...Object.keys(LEGACY_KEYS)]

/** One list key from a query, with the old keys' values folded in. Priority is normalized ("medium" is Normal). */
export function listFrom(query: Record<string, string>, key: string): string[] {
  const values = splitList(query[key] ?? '')
  for (const [old, now] of Object.entries(LEGACY_KEYS)) if (now === key) values.push(...splitList(query[old] ?? ''))
  const quick = LEGACY_QUICK[query.quick ?? '']
  if (quick?.key === key) values.push(quick.value)
  return [...new Set(key === 'priority' ? values.map(normalizePriority) : values)]
}

/**
 * What the view switch writes. Stages drops ?layout= (and any old ?view=flow or ?view=states). Table sets ?layout=table.
 * When Settings opens on Table, "not the table" has to be written out.
 */
export function viewPatch(next: BoardView, defaultView: DefaultView): { view?: string, layout: string, col?: string } {
  if (next === 'table') return { layout: 'table' }
  return { view: '', col: '', layout: defaultView === 'table' ? 'board' : '' }
}

/** A key press that may only be a shortcut when the page has a handler for it is tested in useBoardKeys (keyGuard). */
