// Column sort state. The key is in the URL (?sort=, shared with the view); each column's direction is a
// per-viewer convenience kept in localStorage. The default is newest first, so a new ticket lands on top.
import { computed, ref } from 'vue'
import type { SortKey } from '~/types/board'
import { SORT_KEYS } from '~/types/board'

const STORAGE_KEY = 'agent-board:sort-dir:v1'
// Shared by every column, loaded once.
const ascending = ref<Record<string, boolean>>({})
let loaded = false

export function useColumnSort() {
  const { query, set } = useBoardFilters()

  if (!loaded && import.meta.client) {
    loaded = true
    try {
      ascending.value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    } catch {
      // Unreadable storage: every column sorts descending.
    }
  }

  const key = computed<SortKey>(() => (SORT_KEYS as readonly string[]).includes(query.value.sort) ? query.value.sort as SortKey : 'created')

  function isDesc(columnId: string): boolean {
    return !ascending.value[columnId]
  }

  function toggle(columnId: string) {
    ascending.value = { ...ascending.value, [columnId]: !ascending.value[columnId] }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ascending.value))
    } catch {
      // Private mode: the direction lasts until reload.
    }
  }

  function setKey(next: SortKey) {
    set({ sort: next })
  }

  return { key, isDesc, toggle, setKey }
}
