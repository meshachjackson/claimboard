// The table's own sort. It lives in the URL query like the board's filters, so a table view can be
// bookmarked. The layout itself (?layout=table) and the Stage and Priority filters are read in useBoardFilters; other
// keys in the query (search, filters, open ticket) are kept.
import { computed } from 'vue'
import type { TableSortKey } from '~/types/board'
import { TABLE_SORT_KEYS } from '~/types/board'

export function useBoardLayout() {
  const route = useRoute()
  const router = useRouter()
  const { query } = useBoardFilters()
  const str = (key: string) => (typeof route.query[key] === 'string' ? route.query[key] as string : '')

  const layout = computed(() => query.value.layout)
  const sortKey = computed<TableSortKey>(() => (TABLE_SORT_KEYS as readonly string[]).includes(str('tsort')) ? str('tsort') as TableSortKey : 'updated')
  const sortDesc = computed(() => str('tsort') ? str('tdir') !== 'asc' : true) // the default sort is newest first

  function setSort(key: TableSortKey, desc: boolean) {
    router.replace({ query: { ...route.query, tsort: key, tdir: desc ? 'desc' : 'asc' } })
  }

  return { layout, sortKey, sortDesc, setSort }
}
