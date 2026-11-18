// The list an open ticket belongs to, so J and K in the ticket panel step through it (redesign).
// On the Floor: Needs you, then the agents' cards, then Shipped. On the board: the cards on screen, column by column,
// in each column's sort. Anywhere else: every card on the board.
import { matchesColumn } from '~/utils/rollup'
import { sortCards } from '~/utils/sort'

export function useTicketOrder(taskId: () => string) {
  const route = useRoute()
  const board = useBoardStore()
  const floor = useFloor()
  const { query, matches } = useBoardFilters()
  const sort = useColumnSort()

  const ids = computed<string[]>(() => {
    if (route.path === '/') {
      const agentCards = floor.agents.value.flatMap(r => [...r.working, ...r.owes, ...r.queued])
      return [...floor.mine.value, ...agentCards, ...floor.shipped.value].map(m => m.card.task.task_id)
    }
    if (route.path === '/board') {
      const shown = board.cards.filter(c => matches(c))
      return board.columnsFor(query.value.view).flatMap(col =>
        sortCards(shown.filter(c => matchesColumn(col.match, c)), sort.key.value, sort.isDesc(col.column_id)).map(c => c.task.task_id))
    }
    return board.cards.filter(c => !c.archived).map(c => c.task.task_id)
  })

  const index = computed(() => ids.value.indexOf(taskId()))
  /** The id one step along the list, wrapping at the ends; '' when the ticket is not in the list. */
  const step = (d: 1 | -1) => index.value < 0 ? '' : ids.value[(index.value + d + ids.value.length) % ids.value.length]!

  return { ids, index, step }
}
