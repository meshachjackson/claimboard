// Per-device saved views, kept in this browser like Settings (useSettings). The list is shared
// by every caller and loaded once. The logic is in utils/savedViews.ts.
import { computed, ref } from 'vue'
import type { SavedView } from '~/utils/savedViews'
import { parseViews, removeView, saveView } from '~/utils/savedViews'

const STORAGE_KEY = 'agent-board:views:v1'
const views = ref<SavedView[]>([])
let loaded = false

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(views.value))
  } catch {
    // Private mode: the list lasts until reload.
  }
}

export function useSavedViews() {
  if (!loaded && import.meta.client) {
    loaded = true
    try {
      views.value = parseViews(localStorage.getItem(STORAGE_KEY))
    } catch {
      // Unreadable storage: start empty.
    }
  }
  return {
    views: computed(() => views.value),
    save: (name: string, query: Record<string, unknown>) => { views.value = saveView(views.value, name, query); persist() },
    remove: (name: string) => { views.value = removeView(views.value, name); persist() }
  }
}
