// Macro planning: epics, milestones, releases, and sketch boards.
// gov_tasks has no epic or milestone field and schema/tables.json is authoritative, so a card's epic, milestone and
// release ride in its tags, which already flow through create_task, update_task, CSV and bulk edit. Tags are lowercase
// slugs, so the kind is a prefix: epic-auth, ms-beta, rel-1-0. A sketch board's column is the tag col-<slug>.
// Names and deadlines live here per device, like saved views; the cards themselves are real gov_tasks rows.

export const PLAN_KINDS = ['epic', 'milestone', 'release'] as const
export type PlanKind = typeof PLAN_KINDS[number]

export const KIND_PREFIX: Record<PlanKind, string> = { epic: 'epic-', milestone: 'ms-', release: 'rel-' }
export const KIND_LABELS: Record<PlanKind, string> = { epic: 'Epic', milestone: 'Milestone', release: 'Release' }
export const COLUMN_PREFIX = 'col-'
/** Facet and lane value for a card that has no epic (or no milestone or release). */
export const NONE = '_none'

/** Lowercase slug, the only shape a tag may take. */
export const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** A planning tag is any tag that carries a prefix; the board's plain tag list leaves these out. */
export function isPlanTag(tag: string): boolean {
  return tag.startsWith(COLUMN_PREFIX) || PLAN_KINDS.some(k => tag.startsWith(KIND_PREFIX[k]))
}
export const plainTags = (tags: string[]) => tags.filter(t => !isPlanTag(t))

/** The first tag of one kind on a card ('' when none). Milestone and release both count as the card's milestone slot. */
export function tagOf(tags: string[], kind: PlanKind): string {
  return tags.find(t => t.startsWith(KIND_PREFIX[kind])) ?? ''
}
export const epicOf = (tags: string[]) => tagOf(tags, 'epic')
export const milestoneOf = (tags: string[]) => tagOf(tags, 'milestone') || tagOf(tags, 'release')

/** What a person reads: the tag without its prefix. */
export function planLabel(tag: string): string {
  for (const k of PLAN_KINDS) if (tag.startsWith(KIND_PREFIX[k])) return tag.slice(KIND_PREFIX[k].length)
  return tag.startsWith(COLUMN_PREFIX) ? tag.slice(COLUMN_PREFIX.length) : tag
}
export function kindOfTag(tag: string): PlanKind | null {
  return PLAN_KINDS.find(k => tag.startsWith(KIND_PREFIX[k])) ?? null
}

/** The tag list with one slot set. A blank name clears the slot. The milestone slot clears both milestone and release tags. */
export function setPlanTag(tags: string[], kind: PlanKind, name: string): string[] {
  const clear = kind === 'epic' ? ['epic'] : ['milestone', 'release']
  const kept = tags.filter(t => !clear.some(k => t.startsWith(KIND_PREFIX[k as PlanKind])))
  const slug = slugify(name.replace(/^(epic|ms|rel)-/, ''))
  return slug ? [...kept, KIND_PREFIX[kind] + slug] : kept
}

/** What swimlanes group by. */
export type LaneBy = 'project' | 'epic' | 'milestone'
export const LANE_BY_LABELS: Record<LaneBy, string> = { project: 'Project', epic: 'Epic', milestone: 'Milestone' }

/** The card's lane: its project_id, or its epic or milestone tag (NONE when it has none). */
export function cardLane(card: { task: { project_id: string | null }, tags: string[] }, by: LaneBy): string {
  // The live table sends null for a blank project; the lane is '' ("No project") so lane sorting never sees null.
  return by === 'project' ? card.task.project_id || '' : planValue(card.tags, by)
}

/** A lane heading: the project name, the tag without its prefix, or "No epic". */
export function laneLabel(lane: string, by: LaneBy): string {
  if (by === 'project') return lane || 'No project'
  return lane === NONE ? `No ${by}` : planLabel(lane)
}

/** The card's value in a lane or facet: its tag, or NONE. */
export function planValue(tags: string[], by: 'epic' | 'milestone'): string {
  return (by === 'epic' ? epicOf(tags) : milestoneOf(tags)) || NONE
}

/** No epic and no milestone or release: the weight nobody has placed. */
export const isOrphan = (tags: string[]) => !epicOf(tags) && !milestoneOf(tags)

// ---------- Definitions with deadlines ----------

export interface PlanItem { tag: string, kind: PlanKind, due_at: string }

/** Add an item or update the deadline of the one with that tag. A blank name saves nothing. */
export function savePlanItem(list: PlanItem[], kind: PlanKind, name: string, due_at: string): PlanItem[] {
  const slug = slugify(name.replace(/^(epic|ms|rel)-/, ''))
  if (!slug) return list
  const item = { tag: KIND_PREFIX[kind] + slug, kind, due_at: due_at.slice(0, 10) }
  const i = list.findIndex(p => p.tag === item.tag)
  return i < 0 ? [...list, item] : list.map((p, j) => j === i ? item : p)
}

export const removePlanItem = (list: PlanItem[], tag: string) => list.filter(p => p.tag !== tag)

/** The stored list, read back safely. */
export function parsePlanItems(raw: string | null): PlanItem[] {
  try {
    const data: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(data)) return []
    return data.flatMap((d): PlanItem[] => {
      const { tag, due_at } = (d ?? {}) as { tag?: unknown, due_at?: unknown }
      if (typeof tag !== 'string') return []
      const kind = kindOfTag(tag)
      return kind ? [{ tag, kind, due_at: typeof due_at === 'string' ? due_at.slice(0, 10) : '' }] : []
    })
  } catch {
    return []
  }
}

// ---------- Roll-up ----------

export interface PlanRow { tag: string, kind: PlanKind, label: string, due_at: string, total: number, done: number, overdue: boolean }

interface Counted { tags: string[], done: boolean }

/**
 * One row per epic, milestone and release: every defined item plus every one a card carries, with its card count,
 * done count and deadline. `today` is YYYY-MM-DD. Sorted by deadline (undated last), then name.
 */
export function rollup(cards: Counted[], items: PlanItem[], today: string): PlanRow[] {
  const rows = new Map<string, PlanRow>()
  const row = (tag: string, kind: PlanKind, due_at = '') => {
    let r = rows.get(tag)
    if (!r) rows.set(tag, r = { tag, kind, label: planLabel(tag), due_at, total: 0, done: 0, overdue: false })
    return r
  }
  for (const p of items) row(p.tag, p.kind, p.due_at)
  for (const c of cards) {
    for (const t of c.tags) {
      const kind = kindOfTag(t)
      if (!kind) continue
      const r = row(t, kind)
      r.total += 1
      if (c.done) r.done += 1
    }
  }
  for (const r of rows.values()) r.overdue = !!r.due_at && r.due_at < today && r.done < r.total
  return [...rows.values()].sort((a, b) => (a.due_at || '9999').localeCompare(b.due_at || '9999') || a.label.localeCompare(b.label))
}

export type PlanSort = 'deadline' | 'name' | 'cards'
export function sortPlanRows(rows: PlanRow[], by: PlanSort): PlanRow[] {
  if (by === 'name') return [...rows].sort((a, b) => a.label.localeCompare(b.label))
  if (by === 'cards') return [...rows].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  return rows
}

// ---------- Sketch boards ----------

/** A sketch board: custom columns, loose notes before saving, and a project name once saved. */
export interface Sketch { id: string, name: string, columns: string[], notes: { text: string, col: string }[], saved: boolean }

export const DEFAULT_SKETCH_COLUMNS = ['Ideas', 'Next', 'Later']

/** The project_id a saved sketch writes on its cards. */
export const sketchProject = (s: Sketch) => slugify(s.name)

export function parseSketches(raw: string | null): Sketch[] {
  try {
    const data: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(data)) return []
    return data.flatMap((d): Sketch[] => {
      const s = (d ?? {}) as Partial<Sketch>
      if (typeof s.id !== 'string' || typeof s.name !== 'string' || !Array.isArray(s.columns)) return []
      const columns = s.columns.filter((c): c is string => typeof c === 'string' && !!c.trim())
      const notes = (Array.isArray(s.notes) ? s.notes : []).filter(n => n && typeof n.text === 'string' && typeof n.col === 'string')
      return columns.length ? [{ id: s.id, name: s.name, columns, notes, saved: s.saved === true }] : []
    })
  } catch {
    return []
  }
}
