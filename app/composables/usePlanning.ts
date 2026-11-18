// Per-device planning data: epic, milestone and release deadlines, and sketch boards. Kept in this browser
// like saved views (useSavedViews). The logic is in utils/planning.ts.
import { computed, ref } from 'vue'
import type { PlanItem, PlanKind, Sketch } from '~/utils/planning'
import { parsePlanItems, parseSketches, removePlanItem, savePlanItem } from '~/utils/planning'

const ITEMS_KEY = 'agent-board:plan-items:v1'
const SKETCHES_KEY = 'agent-board:sketches:v1'
const items = ref<PlanItem[]>([])
const sketches = ref<Sketch[]>([])
let loaded = false

function persist() {
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items.value))
    localStorage.setItem(SKETCHES_KEY, JSON.stringify(sketches.value))
  } catch {
    // Private mode: the lists last until reload.
  }
}

export function usePlanning() {
  if (!loaded && import.meta.client) {
    loaded = true
    try {
      items.value = parsePlanItems(localStorage.getItem(ITEMS_KEY))
      sketches.value = parseSketches(localStorage.getItem(SKETCHES_KEY))
    } catch {
      // Unreadable storage: start empty.
    }
  }
  return {
    items: computed(() => items.value),
    sketches: computed(() => sketches.value),
    saveItem: (kind: PlanKind, name: string, due_at: string) => { items.value = savePlanItem(items.value, kind, name, due_at); persist() },
    removeItem: (tag: string) => { items.value = removePlanItem(items.value, tag); persist() },
    /** Replace one sketch (or add it) and keep the list. */
    putSketch: (s: Sketch) => {
      sketches.value = sketches.value.some(x => x.id === s.id) ? sketches.value.map(x => x.id === s.id ? s : x) : [...sketches.value, s]
      persist()
    },
    removeSketch: (id: string) => { sketches.value = sketches.value.filter(s => s.id !== id); persist() }
  }
}
