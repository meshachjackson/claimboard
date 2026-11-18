// Which cards are checked. One list shared by the board, the table and the bulk bar; it lives in memory only,
// so a reload starts clean. The logic is in utils/bulk.ts.
import { ref } from 'vue'
import { pruneSelection, selectRange, selectionState, toggleAll, toggleId } from '~/utils/bulk'

const selected = ref<string[]>([])
// Phone: "Select cards" shows every card's checkbox until the selection is cleared. Desktop cards show theirs on hover.
const reveal = ref(false)
let lastClicked = ''

export function useBulkSelection() {
  function toggle(id: string, visible: string[] = [], shift = false) {
    selected.value = shift && lastClicked ? selectRange(selected.value, visible, lastClicked, id) : toggleId(selected.value, id)
    lastClicked = id
  }
  const clear = () => { selected.value = []; reveal.value = false; lastClicked = '' }
  return {
    selected,
    reveal,
    toggle,
    clear,
    toggleAll: (visible: string[]) => { selected.value = toggleAll(selected.value, visible) },
    prune: (visible: string[]) => { selected.value = pruneSelection(selected.value, visible) },
    stateFor: (visible: string[]) => selectionState(selected.value, visible),
    has: (id: string) => selected.value.includes(id)
  }
}
