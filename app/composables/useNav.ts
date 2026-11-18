// The four places (redesign): Floor, Board, Agents, Shipped. The orchestrator's full history is a Screen under Agents. The desktop rail, the phone tabs and the
// command palette list the same items with the same counts and the same G-chord keys.
export interface NavItem { to: string, label: string, key: string, count: number, text: string, hint: string, lit: boolean, on: boolean }

export function useNav() {
  const route = useRoute()
  const board = useBoardStore()
  const floor = useFloor()

  const at = (path: string) => path === '/' ? route.path === '/' : route.path.startsWith(path)

  const raw = computed(() => [
    // Floor carries the Needs you count and lights amber while anything waits on the owner.
    { to: '/', label: 'Floor', key: 'G F', count: floor.mine.value.length, lit: floor.mine.value.length > 0, on: at('/') },
    { to: '/board', label: 'Board', key: 'G B', count: board.cards.filter(c => !c.archived).length, lit: false, on: at('/board') || at('/plan') || at('/sketch') },
    { to: '/agents', label: 'Agents', key: 'G A', count: floor.working.value, lit: false, on: at('/agents') || at('/registry') || at('/orchestrator') },
    { to: '/shipped', label: 'Shipped', key: 'G S', count: floor.shippedToday.value.length, lit: false, on: at('/shipped') || at('/report') }
  ])
  // Before the board loads the counts are unknown: show a dash, never amber, and say what each badge counts.
  const items = computed<NavItem[]>(() => raw.value.map(i => ({
    ...i,
    text: navBadgeText(i.count, board.loaded),
    hint: navBadgeLabel(i.label, i.count, board.loaded),
    lit: i.lit && board.loaded
  })))

  return { items }
}
