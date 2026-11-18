// Download cards as a CSV file. Used by the ⋯ menu (cards shown), the bulk bar (cards picked) and Settings (all cards).
import type { CardView } from '~/stores/board'

export function useCsvExport() {
  const toast = useToast()
  return function exportCards(cards: CardView[], description: string) {
    const csv = cardsToCsv(cards)
    // The BOM tells Excel the file is UTF-8; the reader skips it.
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `agent-board-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    toast.add({ title: `Exported ${cards.length} card${cards.length === 1 ? '' : 's'}`, description, color: 'neutral' })
  }
}
