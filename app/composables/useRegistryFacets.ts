// Registry's filter panel, bar pills, and bar tokens: the board's model (useBoardFacets) over agents.
// Show holds the computed signals; the other columns are registry fields, with Unknown for blanks.
import { computed } from 'vue'
import type { BarPill, BarToken, FacetColumn, FacetOption } from '~/utils/facets'
import { byCount, toggleIn } from '~/utils/facets'
import type { FilterKey, RegistryFacet } from '~/composables/useRegistryFilters'
import { FILTER_KEYS, UNKNOWN } from '~/composables/useRegistryFilters'
import { DOMAIN_LABELS, HOST_LABELS, REACH_LABELS, REGISTRY_SHOW } from '~/types/registry'

const COLUMNS: Record<RegistryFacet, { label: string, labels?: Record<string, string> }> = {
  show: { label: 'Show' },
  domain: { label: 'Domain', labels: DOMAIN_LABELS },
  host: { label: 'Host', labels: HOST_LABELS },
  agent_type: { label: 'Type' },
  inference: { label: 'Inference' },
  reachability: { label: 'Reachability', labels: REACH_LABELS }
}
const SHOW_LABELS: Record<string, string> = Object.fromEntries(REGISTRY_SHOW.map(s => [s.id, s.label]))

export function useRegistryFacets() {
  const registry = useRegistryStore()
  const route = useRoute()
  const { query, set, clearFilters, matches, test, selected } = useRegistryFilters()

  // Fleet leaves templates on their own shelf; Table lists every row.
  const pool = computed(() => route.path === '/registry/table' ? registry.views : registry.views.filter(v => v.row.lifecycle_status !== 'template'))
  const shown = computed(() => pool.value.filter(v => matches(v)))

  // Unregistered workflows aren't agents: count them only when no other column narrows the fleet.
  function unregisteredCount(): number {
    const q = query.value
    return q.q || FILTER_KEYS.some(k => q.f[k].length) ? 0 : registry.counts.unregistered
  }
  function countFor(facet: RegistryFacet, value: string): number {
    if (facet === 'show' && value === 'unregistered') return unregisteredCount()
    return pool.value.filter(v => matches(v, facet) && test(facet, v, value)).length
  }
  const totalFor = (facet: RegistryFacet, value: string) => pool.value.filter(v => test(facet, v, value)).length

  function labelOf(facet: RegistryFacet, value: string): string {
    if (facet === 'show') return SHOW_LABELS[value] ?? value
    if (value === UNKNOWN) return 'Unknown'
    return COLUMNS[facet].labels?.[value] ?? value
  }

  function option(facet: RegistryFacet, value: string): FacetOption {
    return { value, label: labelOf(facet, value), count: countFor(facet, value), on: selected(facet).includes(value) }
  }

  const columns = computed<FacetColumn[]>(() => {
    const show: FacetColumn = {
      key: 'show',
      label: COLUMNS.show.label,
      anyLabel: 'All',
      options: REGISTRY_SHOW.map(s => ({ ...option('show', s.id), marker: { kind: 'dot' as const, color: s.dot, square: s.square } }))
    }
    const fields = FILTER_KEYS.map((key: FilterKey): FacetColumn => {
      const raw = pool.value.map(v => v.row[key])
      // Values from the URL that no agent carries still get a row, so they can be unchecked.
      const picked = query.value.f[key].filter(v => v !== UNKNOWN)
      const values = byCount([...new Set([...raw.filter(Boolean), ...picked])], v => totalFor(key, v), v => labelOf(key, v))
      if (raw.includes('') || query.value.f[key].includes(UNKNOWN)) values.push(UNKNOWN)
      return { key, label: COLUMNS[key].label, anyLabel: 'Any', collapsible: true, options: values.map(v => option(key, v)) }
    })
    return [show, ...fields]
  })

  function toggle(key: string, value: string) {
    set({ [key]: toggleIn(selected(key as RegistryFacet), value) })
  }
  function clear(key: string) {
    set({ [key]: [] })
  }

  const pillIds = ['attention', 'drift']
  const pills = computed<BarPill[]>(() => REGISTRY_SHOW.filter(s => pillIds.includes(s.id)).map(s => ({
    value: s.id,
    label: s.label,
    tone: s.tone,
    square: s.square,
    count: countFor('show', s.id),
    on: query.value.show.includes(s.id)
  })))

  const tokens = computed<BarToken[]>(() => {
    const out: BarToken[] = []
    for (const col of columns.value) {
      const facet = col.key as RegistryFacet
      const values = selected(facet).filter(v => facet !== 'show' || !pillIds.includes(v))
      if (values.length) out.push({ key: col.key, label: col.label, value: values.map(v => labelOf(facet, v)).join(', ') })
    }
    return out
  })

  function removeToken(key: string) {
    if (key === 'show') set({ show: query.value.show.filter(v => pillIds.includes(v)) })
    else clear(key)
  }

  const facetCount = computed(() => columns.value.filter(c => selected(c.key as RegistryFacet).length).length)
  const hasActive = computed(() => facetCount.value > 0 || !!query.value.q)
  const countLabel = computed(() => {
    const q = query.value
    if (q.show.length === 1 && q.show[0] === 'unregistered') return `${unregisteredCount()} unregistered`
    const total = pool.value.length
    return shown.value.length === total ? `${total} agents` : `${shown.value.length} of ${total} agents`
  })

  return { columns, pills, tokens, facetCount, hasActive, countLabel, shown, toggle, clear, removeToken, clearAll: clearFilters }
}
