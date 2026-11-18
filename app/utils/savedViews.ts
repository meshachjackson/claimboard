// Saved views: a name for a board URL. A view keeps the query keys that describe what is on
// screen (search, filters, view, layout, sort, lanes, archived) and drops the ones that describe a moment (the open
// ticket, the phone's current column). The list is per device, like Settings; this file is the logic, useSavedViews
// keeps it in the browser.

export interface SavedView { name: string, query: Record<string, string> }

/** Query keys a view never keeps. */
const MOMENT_KEYS = ['task', 'col', 'select']

/** The part of the URL query a view saves: string values only, no blanks, no moment keys, in key order. */
export function viewFrom(query: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(query).sort()) {
    const v = query[k]
    if (typeof v === 'string' && v !== '' && !MOMENT_KEYS.includes(k)) out[k] = v
  }
  return out
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Add a view, or replace the one with that name (case-insensitive). A blank name saves nothing. A new array. */
export function saveView(list: SavedView[], name: string, query: Record<string, unknown>): SavedView[] {
  const clean = name.trim()
  if (!clean) return list
  const view = { name: clean, query: viewFrom(query) }
  const i = list.findIndex(v => same(v.name, clean))
  return i < 0 ? [...list, view] : list.map((v, j) => j === i ? view : v)
}

/** Remove the view with that name. A new array; the same array when nothing matched. */
export function removeView(list: SavedView[], name: string): SavedView[] {
  const kept = list.filter(v => !same(v.name, name))
  return kept.length === list.length ? list : kept
}

/** The board link for a view ('/board' when the view is the bare board). */
export function viewHref(view: SavedView): string {
  const qs = new URLSearchParams(view.query).toString()
  return qs ? `/board?${qs}` : '/board'
}

/** Whether the screen shows this view now: the same saved keys and values, nothing more. */
export function isCurrent(view: SavedView, query: Record<string, unknown>): boolean {
  const now = viewFrom(query)
  const keys = Object.keys(now)
  return keys.length === Object.keys(view.query).length && keys.every(k => view.query[k] === now[k])
}

/** The stored list, read back safely: anything that isn't a named view with string values is dropped. */
export function parseViews(raw: string | null): SavedView[] {
  try {
    const data: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(data)) return []
    const out: SavedView[] = []
    for (const v of data) {
      if (!v || typeof v !== 'object') continue
      const { name, query } = v as { name?: unknown, query?: unknown }
      if (typeof name !== 'string' || !name.trim() || !query || typeof query !== 'object') continue
      const q = Object.fromEntries(Object.entries(query as Record<string, unknown>).filter(([, x]) => typeof x === 'string' && x !== '')) as Record<string, string>
      if (!out.some(o => same(o.name, name))) out.push({ name: name.trim(), query: viewFrom(q) })
    }
    return out
  } catch {
    return []
  }
}
