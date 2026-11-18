// Page shortcuts (Board v4): / search, F filters, 1 2 views, X select the focused card, Esc and ? the shortcuts
// dialog. Each page passes the handlers it has; Registry passes only / and F. The app-wide keys (⌘K, G chords, N and ",")
// live in layouts/default.vue; the ticket keys (J K R M A) in TicketPanel.
// The guards are the same for every key: no modifier keys, not while typing, and not while a dialog or drawer is open.
import { onBeforeUnmount, onMounted } from 'vue'
import { keyGuard } from '~/utils/keyGuard'

export interface BoardKeyHandlers {
  search?: () => void
  filters?: () => void
  newTicket?: () => void
  view?: (n: 1 | 2) => void
  selectFocused?: () => void
  /** Closes the filter panel if it is open, otherwise clears the selection. */
  escape?: () => void
  settings?: () => void
  shortcuts?: () => void
}

/** Whether the shortcuts dialog is open; shared so the ⋯ menu and the `?` key open the same one. */
export const useShortcutsOpen = () => useState('ab-shortcuts', () => false)

export function useBoardKeys(handlers: BoardKeyHandlers, blocked: () => boolean) {
  function onKey(e: KeyboardEvent) {
    // Esc is left alone when a popover or dialog already took it.
    if (e.key === 'Escape' && e.defaultPrevented) return
    // Esc also works from inside a text field (it closes the filter panel you are typing in); every other key stands down there.
    const guarded = e.key === 'Escape' ? { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: null } : e
    if (!keyGuard(guarded, blocked())) return
    const k = e.key.toLowerCase()
    const act: Record<string, (() => void) | undefined> = {
      '/': handlers.search,
      'f': handlers.filters,
      'n': handlers.newTicket,
      '1': handlers.view && (() => handlers.view!(1)),
      '2': handlers.view && (() => handlers.view!(2)),
      'x': handlers.selectFocused,
      'escape': handlers.escape,
      ',': handlers.settings,
      '?': handlers.shortcuts
    }
    const run = act[k]
    if (!run) return
    e.preventDefault()
    run()
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}
