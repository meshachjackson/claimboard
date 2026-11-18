// Hands one card to the orchestrator (ManagerChat.vue) as a question: the panel opens with the text in its box, and
// The owner sends it or edits it first. Used for cards no agent can take, so the orchestrator can help decide what to do.
import type { CardView } from '~/stores/board'

export function useAskManager() {
  const open = useManagerOpen()
  const draft = useState('ab-manager-draft', () => '')
  const mode = useState<'orchestrator' | 'helper'>('ab-manager-mode', () => 'orchestrator')
  // One card, or a group stuck for the same reason (the Floor folds those into one row).
  return (cards: CardView[]) => {
    const one = cards.length === 1 ? cards[0]! : null
    const what = one ? `${one.task.task_id} - ${one.task.title}` : `these ${cards.length} cards (${cards.map(c => c.task.task_id).join(', ')})`
    draft.value = `What should I do with ${what}? No agent can take ${one ? 'it' : 'them'}: ${cards[0]?.stranded}. `
      + 'Give me two or three options (reassign, change tags, turn an agent back on, take it myself, close it) and say which you would pick.'
    mode.value = 'orchestrator' // a stuck card goes to the orchestrator, who answers and routes
    open.value = true
  }
}
