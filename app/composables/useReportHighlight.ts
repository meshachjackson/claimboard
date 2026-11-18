// One highlight state for the whole report page (docs/design/report/README.md §7). Tiles, legend entries, rows and bars
// each say which cards they cover; the map lights those and dims the rest. `hover` is what the pointer is on, `pin` is
// what a click kept. Hover wins over pin while the pointer is on something. One hovered square rings its card and dims nothing.
import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { ColorBy, ReportCard, Swatch } from '~/utils/reportPaint'
import { keyOf, legendFor, projectsOf, swatchOf } from '~/utils/reportPaint'

/** A set of cards under one key. `accent` is the ring color while it is lit; `label` names it in the map's caption. */
export interface HighlightGroup { key: string, ids: Set<string>, accent: string, label: string }
export interface HighlightOptions { accent?: string, label?: string }

export interface ReportContext {
  cards: ComputedRef<Map<string, ReportCard>>
  /** The board's project ids, sorted: the order a project takes its color slot in. */
  projects: ComputedRef<string[]>
  colorBy: Ref<ColorBy>
  legend: ComputedRef<Swatch[]>
  hover: Ref<HighlightGroup | null>
  pin: Ref<HighlightGroup | null>
  /** The one card under the pointer or focus (rings it, shows the tooltip). */
  card: Ref<string>
  active: ComputedRef<HighlightGroup | null>
  isLit: (id: string) => boolean
  enter: (key: string, ids: readonly string[], opts?: HighlightOptions) => void
  leave: () => void
  toggle: (key: string, ids: readonly string[], opts?: HighlightOptions) => void
  clear: () => void
  isPinned: (key: string) => boolean
  isHovered: (key: string) => boolean
  swatch: (id: string) => Swatch
  keyOf: (id: string) => string
}

const RING = 'rgba(255,255,255,0.35)'
const CONTEXT: InjectionKey<ReportContext> = Symbol('report-highlight')

/** The page calls this once and everything under it reads the result with useReportHighlight(). */
export function provideReportHighlight(cards: ComputedRef<Map<string, ReportCard>>): ReportContext {
  const colorBy = ref<ColorBy>('project')
  const hover = ref<HighlightGroup | null>(null)
  const pin = ref<HighlightGroup | null>(null)
  const card = ref('')
  const projects = computed(() => projectsOf([...cards.value.values()]))
  const legend = computed(() => legendFor(colorBy.value, projects.value))
  const group = (key: string, ids: readonly string[], opts: HighlightOptions = {}): HighlightGroup => ({ key, ids: new Set(ids), accent: opts.accent ?? RING, label: opts.label ?? '' })
  const active = computed(() => hover.value ?? pin.value)

  const ctx: ReportContext = {
    cards, projects, colorBy, legend, hover, pin, card, active,
    isLit: id => !active.value || active.value.ids.has(id),
    enter: (key, ids, opts) => { hover.value = group(key, ids, opts) },
    leave: () => { hover.value = null },
    toggle: (key, ids, opts) => {
      pin.value = pin.value?.key === key ? null : group(key, ids, opts)
      hover.value = null
    },
    clear: () => { pin.value = null; hover.value = null; card.value = '' },
    isPinned: key => pin.value?.key === key,
    isHovered: key => hover.value?.key === key,
    swatch: id => swatchOf(cards.value.get(id)!, colorBy.value, legend.value),
    keyOf: id => keyOf(cards.value.get(id)!, colorBy.value)
  }
  // A legend pin means nothing once the legend changes under it.
  watch(colorBy, () => { if (pin.value?.key.startsWith('lg:')) pin.value = null })
  provide(CONTEXT, ctx)
  return ctx
}

export function useReportHighlight(): ReportContext {
  const ctx = inject(CONTEXT)
  if (!ctx) throw new Error('useReportHighlight() needs a page that called provideReportHighlight()')
  return ctx
}
