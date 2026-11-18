// Fleet and Table filters, kept in the URL query like the board's. Every key takes a comma
// list: OR inside a key, AND across keys. Old ?quick= links are read as ?show= and rewritten.
import type { AgentView } from '~/stores/registry'
import { splitList } from '~/utils/format'

export const FILTER_KEYS = ['domain', 'host', 'agent_type', 'inference', 'reachability'] as const
export type FilterKey = typeof FILTER_KEYS[number]
/** The panel's columns: Show (the signals), then the registry fields. */
export type RegistryFacet = 'show' | FilterKey

/** Field value for a blank field. */
export const UNKNOWN = '_unknown'

/** Pages the filters apply to. Elsewhere a filter change opens Fleet. */
const FILTERED_PATHS = ['/registry', '/registry/table']

export interface RegistryQuery {
  q: string
  show: string[] // attention, drift, awaiting, unregistered
  lanes: 'none' | 'host' | 'domain'
  retired: boolean
  f: Record<FilterKey, string[]>
}

export function useRegistryFilters() {
  const route = useRoute()
  const router = useRouter()
  const str = (v: unknown) => (typeof v === 'string' ? v : '')

  const query = computed<RegistryQuery>(() => {
    const show = splitList(str(route.query.show))
    const legacy = str(route.query.quick)
    return {
      q: str(route.query.q),
      show: legacy && !show.includes(legacy) ? [...show, legacy] : show,
      lanes: (['host', 'domain'].includes(str(route.query.lanes)) ? str(route.query.lanes) : 'none') as RegistryQuery['lanes'],
      retired: route.query.retired === '1',
      f: Object.fromEntries(FILTER_KEYS.map(k => [k, splitList(str(route.query[k]))])) as Record<FilterKey, string[]>
    }
  })

  const onFilteredPage = computed(() => FILTERED_PATHS.includes(route.path))

  function set(patch: Record<string, string | boolean | string[]>) {
    const next: Record<string, string> = { ...(route.query as Record<string, string>) }
    if ('quick' in next) {
      delete next.quick
      if (query.value.show.length) next.show = query.value.show.join(',')
    }
    for (const [k, v] of Object.entries(patch)) {
      const value = Array.isArray(v) ? v.join(',') : typeof v === 'boolean' ? (v ? '1' : '') : v
      if (value) next[k] = value
      else delete next[k]
    }
    if (onFilteredPage.value) {
      router.replace({ query: next })
    } else {
      // The open agent drawer belongs to the page he's leaving.
      const { agent: _a, tab: _t, ...rest } = next
      router.push({ path: '/registry', query: rest })
    }
  }

  /** Rewrite an old ?quick= link as ?show=. */
  function rewriteLegacy() {
    if (route.query.quick !== undefined) set({})
  }

  const hasFilters = computed(() => !!(query.value.q || query.value.show.length || FILTER_KEYS.some(k => query.value.f[k].length)))

  function clearFilters() {
    set({ q: '', show: '', ...Object.fromEntries(FILTER_KEYS.map(k => [k, ''])) })
  }

  /** Whether one agent matches one value of one column. Agents never match Unregistered: only ghost cards do. */
  function test(facet: RegistryFacet, v: AgentView, value: string): boolean {
    if (facet === 'show') {
      if (value === 'attention') return v.attention
      if (value === 'drift') return !!v.signals.drift
      if (value === 'awaiting') return v.signals.awaiting.length > 0
      return false
    }
    return value === UNKNOWN ? v.row[facet] === '' : v.row[facet] === value
  }

  function selected(facet: RegistryFacet, q: RegistryQuery = query.value): string[] {
    return facet === 'show' ? q.show : q.f[facet]
  }

  /** Search and every column except `skip` (the column being counted, for faceted counts). */
  function matches(v: AgentView, skip?: RegistryFacet): boolean {
    const q = query.value
    for (const facet of ['show', ...FILTER_KEYS] as RegistryFacet[]) {
      if (facet === skip) continue
      const values = selected(facet)
      if (values.length && !values.some(val => test(facet, v, val))) return false
    }
    if (q.q) {
      const hay = [v.row.agent_id, v.row.name, v.row.description, v.row.responsibilities].join(' ').toLowerCase()
      if (!hay.includes(q.q.trim().toLowerCase())) return false
    }
    return true
  }

  /** Ghost cards (unregistered workflows) show with no filters at all, or when Unregistered is checked alone. */
  const showGhosts = computed(() => {
    const q = query.value
    const others = q.q || q.show.some(s => s !== 'unregistered') || FILTER_KEYS.some(k => q.f[k].length)
    return !others
  })

  return { query, set, rewriteLegacy, hasFilters, clearFilters, matches, test, selected, showGhosts, onFilteredPage }
}
