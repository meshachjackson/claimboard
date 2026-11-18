// The board's filter panel, bar pills, and bar tokens, built from the cards and the URL query.
// Counts are faceted: each option counts the cards that match every other column. Options keep a fixed
// order (overall count) so nothing jumps while he clicks.
import { computed } from 'vue'
import type { BarPill, BarToken, FacetColumn, FacetOption, Marker } from '~/utils/facets'
import { byCount, toggleIn } from '~/utils/facets'
import type { Facet } from '~/composables/useBoardFilters'
import { TYPE_PREFIX, UNASSIGNED } from '~/composables/useBoardFilters'
import { BOARD_PILLS, PRIORITY_FACET_DOTS, PRIORITY_FACET_ORDER, PRIORITY_LABELS, STAGES, STAGE_LABELS, STATE_FILTER_DOTS, STATE_FILTER_ORDER, TASK_TYPES, TASK_TYPE_LABELS, WORK_STATE_LABELS } from '~/types/board'
import { isPool, poolType } from '~/utils/rollup'
import { laneLabel, NONE, planValue, plainTags } from '~/utils/planning'

const COLUMN_LABELS: Record<Facet, string> = { work_state: 'State', stage: 'Stage', who: 'Who', project: 'Project', epic: 'Epic', milestone: 'Milestone', priority: 'Priority', task_type: 'Type', tags: 'Tags' }

export function useBoardFacets() {
  const board = useBoardStore()
  const { query, report, set, clearFilters, matches, test, selected, people, stageShown } = useBoardFilters()

  // Every card the board could show; archived ones only when asked for.
  const pool = computed(() => board.cards.filter(c => !c.archived || query.value.archived))
  const shown = computed(() => board.cards.filter(c => matches(c)))

  const countFor = (facet: Facet, value: string) => pool.value.filter(c => matches(c, query.value, facet) && test(facet, c, value)).length
  const totalFor = (facet: Facet, value: string) => pool.value.filter(c => test(facet, c, value)).length

  function whoLabel(value: string): string {
    if (value === UNASSIGNED) return 'Unassigned'
    if (value.startsWith(TYPE_PREFIX)) return `Any ${value.slice(TYPE_PREFIX.length)}`
    return board.nameOf(value)
  }
  const tagLabel = (t: string) => `#${t}`
  const labelOf: Record<Facet, (v: string) => string> = {
    work_state: v => WORK_STATE_LABELS[v as keyof typeof WORK_STATE_LABELS] ?? v,
    stage: v => STAGE_LABELS[v as keyof typeof STAGE_LABELS] ?? v,
    who: whoLabel,
    project: v => v,
    epic: v => laneLabel(v, 'epic'),
    milestone: v => laneLabel(v, 'milestone'),
    priority: v => PRIORITY_LABELS[v] ?? v,
    task_type: v => TASK_TYPE_LABELS[v as keyof typeof TASK_TYPE_LABELS] ?? v,
    tags: tagLabel
  }

  function option(facet: Facet, value: string, marker?: Marker): FacetOption {
    return { value, label: labelOf[facet](value), count: countFor(facet, value), on: selected(facet).includes(value), marker }
  }

  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))]
  // A value from the URL that no card carries still gets a row, so it can be unchecked.
  const withSelected = (values: string[], facet: Facet) => uniq([...values, ...selected(facet)])

  const columns = computed<FacetColumn[]>(() => {
    const cards = pool.value
    // Who: agent types first (any advisor, any builder), a rule, agents by card count, then Unassigned.
    const types = uniq([...cards.flatMap(c => people(c).map(p => isPool(p) ? poolType(p) : board.agent(p)?.agent_type ?? '')), ...query.value.agent_type])
      .filter(t => t !== 'person').sort()
    const agents = byCount(uniq([...cards.flatMap(c => people(c)), ...query.value.agent]).filter(p => !isPool(p) && p !== UNASSIGNED), v => totalFor('who', v), board.nameOf)
    const who: FacetOption[] = [
      ...types.map(t => option('who', TYPE_PREFIX + t, { kind: 'group', letter: t.charAt(0).toUpperCase() })),
      ...agents.map((a, i) => ({ ...option('who', a, { kind: 'avatar', id: a }), divider: i === 0 && types.length > 0 })),
      option('who', UNASSIGNED, { kind: 'avatar', id: '' })
    ]
    const projects = byCount(withSelected(cards.map(c => c.task.project_id), 'project'), v => totalFor('project', v))
    const tags = byCount(withSelected(cards.flatMap(c => plainTags(c.tags)), 'tags'), v => totalFor('tags', v))
    // Epic and milestone rows: the ones cards carry, then "No epic" / "No milestone" for the orphans.
    const planOptions = (facet: 'epic' | 'milestone') => [
      ...byCount(withSelected(cards.map(c => planValue(c.tags, facet)).filter(v => v !== NONE), facet), v => totalFor(facet, v)),
      NONE
    ].map(v => option(facet, v))

    // The four known priorities in a fixed order; a value from the URL that none of them covers still gets a row.
    const priorities = [...PRIORITY_FACET_ORDER, ...selected('priority').filter(p => !(PRIORITY_FACET_ORDER as readonly string[]).includes(p))]

    const all: FacetColumn[] = [
      { key: 'work_state', label: COLUMN_LABELS.work_state, anyLabel: 'Any', options: STATE_FILTER_ORDER.map(s => option('work_state', s, { kind: 'dot', color: STATE_FILTER_DOTS[s] })) },
      { key: 'stage', label: COLUMN_LABELS.stage, anyLabel: 'Any', options: STAGES.map(s => option('stage', s)) },
      { key: 'who', label: COLUMN_LABELS.who, anyLabel: 'Anyone', collapsible: true, pinned: types.length, options: who },
      { key: 'project', label: COLUMN_LABELS.project, anyLabel: 'Any', collapsible: true, options: projects.map(p => option('project', p)) },
      { key: 'epic', label: COLUMN_LABELS.epic, anyLabel: 'Any', collapsible: true, options: planOptions('epic') },
      { key: 'milestone', label: COLUMN_LABELS.milestone, anyLabel: 'Any', collapsible: true, options: planOptions('milestone') },
      { key: 'priority', label: COLUMN_LABELS.priority, anyLabel: 'Any', options: priorities.map(p => option('priority', p, { kind: 'dot', color: PRIORITY_FACET_DOTS[p] ?? '' })) },
      { key: 'task_type', label: COLUMN_LABELS.task_type, anyLabel: 'Any', options: TASK_TYPES.map(t => option('task_type', t)) },
      { key: 'tags', label: COLUMN_LABELS.tags, anyLabel: 'Any', collapsible: true, options: tags.map(t => option('tags', t)) }
    ]
    return all.filter(c => c.key !== 'stage' || stageShown())
  })

  /** Check or uncheck one option. Who writes `agent` or `agent_type` depending on the value. */
  function toggle(key: string, value: string) {
    const f = query.value
    if (key === 'who') {
      if (value.startsWith(TYPE_PREFIX)) set({ agent_type: toggleIn(f.agent_type, value.slice(TYPE_PREFIX.length)) })
      else set({ agent: toggleIn(f.agent, value) })
    } else {
      const facet = key as Exclude<Facet, 'who'>
      set({ [facet]: toggleIn(f[facet], value) })
    }
  }

  function clear(key: string) {
    if (key === 'who') set({ agent: [], agent_type: [] })
    else set({ [key]: [] })
  }

  const pills = computed<BarPill[]>(() => BOARD_PILLS.map(p => ({
    value: p.value,
    label: p.label,
    tone: p.tone,
    count: countFor('work_state', p.value),
    on: query.value.work_state.includes(p.value)
  })))

  // One token per column in use. State values already shown by a pill don't repeat.
  const tokens = computed<BarToken[]>(() => {
    const pillValues: string[] = BOARD_PILLS.map(p => p.value)
    // A report finding comes first: "Report  Orphan cards  ×".
    const out: BarToken[] = report.value ? [{ key: 'report', label: 'Report', value: report.value.label }] : []
    for (const col of columns.value) {
      const values = selected(col.key as Facet).filter(v => col.key !== 'work_state' || !pillValues.includes(v))
      if (values.length) out.push({ key: col.key, label: col.label, value: values.map(labelOf[col.key as Facet]).join(', ') })
    }
    return out
  })

  /** Remove a token: clears its column, except the State values the pills show. */
  function removeToken(key: string) {
    if (key === 'report') set({ report: '' })
    else if (key === 'work_state') set({ work_state: query.value.work_state.filter(v => (BOARD_PILLS as readonly { value: string }[]).some(p => p.value === v)) })
    else clear(key)
  }

  const facetCount = computed(() => columns.value.filter(c => selected(c.key as Facet).length).length)
  const hasActive = computed(() => facetCount.value > 0 || !!query.value.q || !!report.value)
  const total = computed(() => pool.value.length)
  const countLabel = computed(() => shown.value.length === total.value ? `${total.value} cards` : `${shown.value.length} of ${total.value} cards`)

  return { columns, pills, tokens, facetCount, hasActive, countLabel, shown, toggle, clear, removeToken, clearAll: clearFilters }
}
