// Filters, view, and open ticket live in the URL query so a view can be shared or bookmarked.
// Filter keys take comma lists: OR inside a key, AND across the panel's columns. A single value is a list of
// one, so old links keep working. Old ?quick= links are read and rewritten (docs/design/refresh/README.md §3), and so
// are the table's old filter keys (docs/design/v4/README.md §2; the key names are in utils/boardUrl.ts).
import { computed } from 'vue'
import type { BoardView, ViewId } from '~/types/board'
import type { CardView } from '~/stores/board'
import { isPool, poolType } from '~/utils/rollup'
import { LEGACY_URL_KEYS, listFrom, viewPatch } from '~/utils/boardUrl'
import { normalizePriority } from '~/utils/priority'
import type { LaneBy } from '~/utils/planning'
import { planValue } from '~/utils/planning'
import { reportFilter } from '~/utils/report'

/** URL keys that hold comma lists. `agent` uses `_none` for Unassigned. */
export const LIST_KEYS = ['work_state', 'stage', 'agent', 'agent_type', 'project', 'epic', 'milestone', 'priority', 'task_type', 'tags'] as const
export type ListKey = typeof LIST_KEYS[number]

/** The filter panel's columns. Who covers two URL keys: `agent` and `agent_type`. */
export const FACETS = ['work_state', 'stage', 'who', 'project', 'epic', 'milestone', 'priority', 'task_type', 'tags'] as const
export type Facet = typeof FACETS[number]

/** Who values: an agent id, `_none` for Unassigned, or `type:<agent_type>` for "Any advisor". */
export const UNASSIGNED = '_none'
export const TYPE_PREFIX = 'type:'

export interface BoardQuery extends Record<ListKey, string[]> {
  q: string
  view: ViewId
  layout: 'board' | 'table'
  lanes: boolean // swimlanes
  lane_by: LaneBy // what the swimlanes group by
  task: string // open ticket
  col: string // phone: active column_id
  sort: string // column sort key (useColumnSort); blank means created
  archived: boolean // show archived cards in Done
  report: string // a report finding (utils/report.ts reportFilter): only the cards it covers, e.g. orphans or batchable:2
}

type Patch = Partial<Record<keyof BoardQuery, string | boolean | string[]>>

export function useBoardFilters() {
  const route = useRoute()
  const router = useRouter()
  const board = useBoardStore()
  // What the board opens on when the URL names none (Settings, per device).
  const { defaultView, defaultSort, defaultLanes } = useSettings()

  const str = (key: string) => {
    const v = route.query[key]
    return typeof v === 'string' ? v : ''
  }

  const queryStrings = () => Object.fromEntries(Object.entries(route.query).filter(([, v]) => typeof v === 'string')) as Record<string, string>
  const list = (key: ListKey) => listFrom(queryStrings(), key)

  const query = computed<BoardQuery>(() => ({
    q: str('q'),
    work_state: list('work_state'),
    agent: list('agent'),
    agent_type: list('agent_type'),
    project: list('project'),
    epic: list('epic'),
    milestone: list('milestone'),
    stage: list('stage'),
    priority: list('priority'),
    task_type: list('task_type'),
    tags: list('tags'),
    // Stages is the only column view; an old ?view=flow or ?view=states lands here too.
    view: 'stages',
    // layout=board is the explicit "not the table", for when Settings opens on Table.
    layout: str('layout') === 'table' || (str('layout') !== 'board' && defaultView.value === 'table') ? 'table' : 'board',
    lanes: str('lanes') === '' ? defaultLanes.value : str('lanes') === '1',
    lane_by: str('lane_by') === 'epic' || str('lane_by') === 'milestone' ? str('lane_by') as LaneBy : 'project',
    task: str('task'),
    col: str('col'),
    sort: str('sort') || defaultSort.value,
    archived: str('archived') === '1',
    report: str('report')
  }))

  // The cards a ?report= key covers, worked out by the same report tools the report page runs, so the filter stays right
  // as cards change. Null for no key or an unknown one (an old link filters nothing instead of everything).
  function resolveReport(key: string) {
    if (!key || !board.loaded) return null
    const r = reportFilter({ tasks: board.cards.map(c => ({ ...c.task, stage: c.stage })) }, key)
    return r && { tool: r.tool, label: r.label, ids: new Set(r.task_ids) }
  }
  /** What the URL's ?report= key resolves to: its tool, a label for the bar token, and its card ids. */
  const report = computed(() => resolveReport(query.value.report))

  // ?view= is legacy too: Flow and States are retired, so any ?view= is dropped when the link is rewritten.
  const hasLegacy = () => LEGACY_URL_KEYS.some(k => route.query[k] !== undefined) || route.query.view !== undefined
  /** True while the URL carries an old key; the page watches it and rewrites the link. */
  const legacyPresent = computed(hasLegacy)

  /**
   * Merge a patch into the query. Empty values drop out of the URL, and old keys are rewritten on the way.
   * A default that the URL would otherwise lose (lanes, sort) is written out when the user picks the other value.
   */
  function set(patch: Patch) {
    const merged: Record<string, unknown> = { ...route.query }
    if (hasLegacy()) {
      for (const k of LEGACY_URL_KEYS) delete merged[k]
      for (const k of LIST_KEYS) merged[k] = query.value[k]
    }
    Object.assign(merged, patch)
    if ('lanes' in patch) merged.lanes = patch.lanes ? '1' : defaultLanes.value ? '0' : ''
    if ('sort' in patch) merged.sort = patch.sort === defaultSort.value ? '' : patch.sort || 'created'
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(merged)) {
      const value = Array.isArray(v) ? v.join(',') : v === true ? '1' : v
      if (typeof value === 'string' && value !== '') next[k] = value
    }
    delete next.view // Stages is the only column view, so an old ?view= is never kept
    router.replace({ query: next })
  }

  /** Rewrite an old link to the keys that replaced its old keys. */
  function rewriteLegacy() {
    if (hasLegacy()) set({})
  }

  /** Pick a view: Stages clears ?layout=; Table is ?layout=table. */
  function setView(next: BoardView) {
    set(viewPatch(next, defaultView.value))
  }

  /** The Stage column only means something where the columns aren't stages already (the table). */
  const stageShown = (f: BoardQuery = query.value) => f.layout === 'table'

  function clearFilters() {
    set({ q: '', report: '', ...Object.fromEntries(LIST_KEYS.map(k => [k, ''])) })
  }

  const hasFilters = computed(() => !!query.value.q || !!report.value || LIST_KEYS.some(k => query.value[k].length))

  /** Everyone working the card: the task's assignee plus every step's assignee. */
  function people(card: CardView): string[] {
    return [card.task.assignee, ...card.steps.map(s => s.assignee)].filter(Boolean)
  }

  function typesOf(card: CardView): string[] {
    return people(card).map(p => isPool(p) ? poolType(p) : board.agent(p)?.agent_type ?? '').filter(Boolean)
  }

  function isUnassigned(card: CardView): boolean {
    const agentStage = card.stage === 'architecture' || card.stage === 'build'
    return agentStage && (!card.assignee || isPool(card.assignee))
  }

  /** The values checked in one column. */
  function selected(facet: Facet, f: BoardQuery = query.value): string[] {
    if (facet === 'who') return [...f.agent, ...f.agent_type.map(t => TYPE_PREFIX + t)]
    return f[facet]
  }

  /** Whether one card matches one value of one column. */
  function test(facet: Facet, card: CardView, value: string): boolean {
    switch (facet) {
      case 'work_state': return card.workState === value
      case 'who':
        if (value === UNASSIGNED) return isUnassigned(card)
        if (value.startsWith(TYPE_PREFIX)) return typesOf(card).includes(value.slice(TYPE_PREFIX.length))
        return people(card).includes(value)
      case 'stage': return card.stage === value
      case 'project': return card.task.project_id === value
      case 'epic': return planValue(card.tags, 'epic') === value
      case 'milestone': return planValue(card.tags, 'milestone') === value
      case 'priority': return normalizePriority(card.task.priority) === value
      case 'task_type': return card.task.task_type === value
      case 'tags': return card.tags.includes(value)
    }
  }

  /** Search, archive, and every column except `skip` (the column being counted, for faceted counts). */
  function matches(card: CardView, f: BoardQuery = query.value, skip?: Facet): boolean {
    // Archived cards are off the board unless asked for.
    if (card.archived && !f.archived) return false
    // A report finding limits the board to its cards whichever column is being counted, like search.
    const found = f.report === query.value.report ? report.value : resolveReport(f.report)
    if (found && !found.ids.has(card.task.task_id)) return false
    for (const facet of FACETS) {
      if (facet === skip || (facet === 'stage' && !stageShown(f))) continue
      const values = selected(facet, f)
      if (values.length && !values.some(v => test(facet, card, v))) return false
    }
    if (f.q) {
      const t = card.task
      const hay = [
        t.task_id, t.title, t.project_id, card.tags.join(' '), card.activity,
        ...people(card).map(p => board.nameOf(p))
      ].join(' ').toLowerCase()
      if (!hay.includes(f.q.trim().toLowerCase())) return false
    }
    return true
  }

  return { query, report, set, setView, stageShown, legacyPresent, rewriteLegacy, clearFilters, hasFilters, matches, test, selected, people, isUnassigned }
}
