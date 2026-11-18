// Whether the ⌘K command palette is open, shared by the rail, the phone header and the keyboard.
export const useCommandPalette = () => ({ open: useState('ab-palette-open', () => false) })

/**
 * The board tools that draw only a dialog (triage, duplicates, CSV). BoardToolsHost mounts them once in the layout and
 * registers how to start each here, so the palette can run them from any page.
 */
export interface BoardTools { triage?: () => void, dupes?: () => void, exportCsv?: () => void, importCsv?: () => void }
export const useBoardTools = () => useState<BoardTools>('ab-board-tools', () => ({}))
