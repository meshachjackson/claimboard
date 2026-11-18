// Which swimlanes are folded to their header, kept in this browser like the Floor zones. Keyed by lane kind and name,
// so a folded project stays folded after a reload.
import { ref } from 'vue'

const STORAGE_KEY = 'agent-board:folded-lanes:v1'
const folded = ref<string[]>([])
let loaded = false

export function useLaneFold() {
  if (!loaded && import.meta.client) {
    loaded = true
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
      if (Array.isArray(saved)) folded.value = saved.filter((k): k is string => typeof k === 'string')
    } catch {
      // Unreadable storage: every lane starts open.
    }
  }
  const save = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(folded.value)) } catch { /* Private mode: lasts until reload. */ }
  }
  return {
    isFolded: (key: string) => folded.value.includes(key),
    toggle(key: string) {
      folded.value = folded.value.includes(key) ? folded.value.filter(k => k !== key) : [...folded.value, key]
      save()
    },
    /** Fold every given lane, or open them all (an empty list). */
    setAll(keys: string[]) {
      folded.value = keys
      save()
    }
  }
}
