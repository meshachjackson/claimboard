// Per-device settings (Part 1; Settings v4): kept in this browser only, like column sort. Board-wide settings
// (the clean-up thresholds, weekly triage) need a table behind the gateway and wait for Part 2.
// The board reads a default only when the URL doesn't name that key (see useBoardFilters).
import { computed, ref } from 'vue'
import type { DefaultView, Density, SortKey } from '~/types/board'
import { DENSITIES, SORT_KEYS } from '~/types/board'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type FloorZoneId = 'mine' | 'floor' | 'shipped'
export const FLOOR_ZONES: FloorZoneId[] = ['mine', 'floor', 'shipped']

/** Live-refresh choices in seconds; 0 is off. The default stays off so a hosted board costs nothing extra. */
export const LIVE_SECONDS = [0, 2, 5, 15, 60] as const

const STORAGE_KEY = 'agent-board:settings:v1'
// Shared by every caller, loaded once.
const defaultView = ref<DefaultView>('stages')
const defaultSort = ref<SortKey>('created')
const defaultLanes = ref(true) // group by project (quiet mode, 11/02/2026: on by default)
const density = ref<Density>('comfortable')
const groupList = ref(false) // grouped boards: each group as one-line rows instead of columns
const rememberFilters = ref(true) // off: the filter panel starts closed on every load
const liveSeconds = ref(0) // how often this browser re-reads the board; 0 = only on load, Refresh and focus
const filtersExpanded = ref(false) // the header's filter panel, open or closed (header refresh v3)
const railHidden = ref(false) // the desktop sidebar, hidden with its toggle or [
const floorHidden = ref<FloorZoneId[]>([]) // Floor zones folded down to their head
let loaded = false

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      defaultView: defaultView.value,
      lanesEra: true, // marks a save made after lanes became the default, so a saved false is a real choice
      defaultSort: defaultSort.value,
      defaultLanes: defaultLanes.value,
      density: density.value,
      groupList: groupList.value,
      rememberFilters: rememberFilters.value,
      liveSeconds: liveSeconds.value,
      filtersExpanded: rememberFilters.value && filtersExpanded.value,
      railHidden: railHidden.value,
      floorHidden: floorHidden.value
    }))
  } catch {
    // Private mode: the choice lasts until reload.
  }
}

export function useSettings() {
  // Nuxt UI's color mode stores the theme itself (nuxt.config colorMode.storageKey) and sets .dark on <html>.
  const colorMode = useColorMode()

  if (!loaded && import.meta.client) {
    loaded = true
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      // Flow and States were retired: a saved 'flow' or 'states' opens Stages, the default.
      if (saved.defaultView === 'table') defaultView.value = 'table'
      if ((SORT_KEYS as readonly string[]).includes(saved.defaultSort)) defaultSort.value = saved.defaultSort
      // Before lanes became the default every save wrote false, so without lanesEra it is not a choice: lanes win.
      if (saved.lanesEra === true) defaultLanes.value = saved.defaultLanes !== false
      if ((DENSITIES as readonly string[]).includes(saved.density)) density.value = saved.density
      if (saved.groupList === true) groupList.value = true
      if ((LIVE_SECONDS as readonly number[]).includes(saved.liveSeconds)) liveSeconds.value = saved.liveSeconds
      if (saved.rememberFilters === false) rememberFilters.value = false
      if (saved.filtersExpanded === true && rememberFilters.value) filtersExpanded.value = true
      if (saved.railHidden === true) railHidden.value = true
      if (Array.isArray(saved.floorHidden)) floorHidden.value = FLOOR_ZONES.filter(z => saved.floorHidden.includes(z))
    } catch {
      // Unreadable storage: the defaults stand.
    }
  }

  const theme = computed<ThemeChoice>({
    get: () => (['light', 'dark'].includes(colorMode.preference) ? colorMode.preference : 'system') as ThemeChoice,
    set: (v) => { colorMode.preference = v }
  })

  function setFiltersExpanded(open: boolean) {
    filtersExpanded.value = open
    save()
    // The panel is not pinned with the bar, so opening it while scrolled would show nothing. Bring it into view.
    if (open && import.meta.client) document.getElementById('app-frame')?.scrollTo({ top: 0 })
  }

  /** One setter per stored value; each saves at once. */
  const setter = <T>(target: { value: T }) => (v: T) => { target.value = v; save() }

  return {
    theme,
    defaultView: computed(() => defaultView.value),
    setDefaultView: setter(defaultView),
    defaultSort: computed(() => defaultSort.value),
    setDefaultSort: setter(defaultSort),
    defaultLanes: computed(() => defaultLanes.value),
    setDefaultLanes: setter(defaultLanes),
    density: computed(() => density.value),
    setDensity: setter(density),
    groupList: computed(() => groupList.value),
    setGroupList: setter(groupList),
    rememberFilters: computed(() => rememberFilters.value),
    setRememberFilters: setter(rememberFilters),
    liveSeconds: computed(() => liveSeconds.value),
    setLiveSeconds: setter(liveSeconds),
    filtersExpanded: computed(() => filtersExpanded.value),
    setFiltersExpanded,
    railHidden: computed(() => railHidden.value),
    setRailHidden: setter(railHidden),
    floorHidden: computed(() => floorHidden.value),
    /** Fold a Floor zone to its head, or open it again. */
    toggleFloorZone(z: FloorZoneId) {
      floorHidden.value = floorHidden.value.includes(z) ? floorHidden.value.filter(x => x !== z) : FLOOR_ZONES.filter(x => x === z || floorHidden.value.includes(x))
      save()
    },
    setFloorHidden: setter(floorHidden)
  }
}
