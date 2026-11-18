// Filter facets shared by Board and Registry (docs/design/refresh/README.md): one checklist column per facet,
// OR inside a column and AND across columns. The composables build these; the components only draw them.

/** What sits between the checkbox and the label. A dot with color '' is a hollow ring. */
export type Marker =
  | { kind: 'dot', color: string, square?: boolean }
  | { kind: 'avatar', id: string } // AgentAvatar; '' draws the dashed "unassigned" circle
  | { kind: 'group', letter: string } // boxed letter for "Any advisor", "Any builder"

export interface FacetOption {
  value: string
  label: string
  /** Faceted: cards that match every other column's filters and this value. */
  count: number
  on: boolean
  marker?: Marker
  /** Draw a rule above this option. */
  divider?: boolean
}

export interface FacetColumn {
  key: string
  label: string
  options: FacetOption[]
  /** Long columns show this many leading options, then the limit more plus anything selected, behind "Show N more". */
  pinned?: number
  collapsible?: boolean
  /** Phone accordion summary when nothing is selected: "Any" or "Anyone". */
  anyLabel?: string
}

/** A bar pill: a shortcut for one value of a column (Needs you, Blocked, Agent problems, Drift). */
export interface BarPill {
  value: string
  label: string
  count: number
  on: boolean
  tone: 'orange' | 'red'
  square?: boolean
}

/** An applied-filter token in the bar: "Who  Largo, Claude Code  ×". */
export interface BarToken {
  key: string
  label: string
  value: string
}

export const COLLAPSED_LIMIT = 5

/** Options a collapsed column shows, and how many it hides. `limit` is how many past the pinned ones: 6 in the panel's columns, 12 in its detail pane. */
export function visibleOptions(col: FacetColumn, expanded: boolean, limit = COLLAPSED_LIMIT): { options: FacetOption[], hidden: number } {
  const pinned = col.pinned ?? 0
  if (!col.collapsible || expanded || col.options.length - pinned <= limit) return { options: col.options, hidden: 0 }
  const options = col.options.filter((o, i) => i < pinned + limit || o.on)
  return { options, hidden: col.options.length - options.length }
}

/** Add the value if it's missing, drop it if it's there. */
export function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
}

/** Sort values by a count, highest first, then by label, so the order never moves while he clicks. */
export function byCount(values: string[], count: (v: string) => number, label: (v: string) => string = v => v): string[] {
  return [...values].sort((a, b) => count(b) - count(a) || label(a).localeCompare(label(b)))
}
