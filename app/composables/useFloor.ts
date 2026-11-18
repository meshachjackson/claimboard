// The Floor's three zones (direction B): Needs you, On the floor, Shipped. Built from the board store's cards with the
// whose-move rule; nothing here writes. The rail, the phone tabs and the Floor page all read the same numbers.
import type { CardView } from '~/stores/board'
import { whoseMove, type WhoseMove } from '~/utils/whoseMove'

export interface MoveCard { card: CardView, move: WhoseMove }

export interface AgentRow {
  id: string // agent id or pool:<type>
  working: MoveCard[] // a step it holds is dispatched
  queued: MoveCard[] // open steps waiting for it
  owes: MoveCard[] // messages from the owner it has not answered
  lastBeat: string // newest heartbeat_at or step end on any card, '' when none
}

const byOldest = (a: MoveCard, b: MoveCard) => a.move.since.localeCompare(b.move.since)
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

export function useFloor() {
  const board = useBoardStore()

  // Archived cards stay out, except done ones: Done cards are archived after 14 days and still count as shipped.
  const moves = computed<MoveCard[]>(() => board.cards.filter(c => !c.archived || c.workState === 'done').map(card => ({ card, move: whoseMove(card) })))

  // When a card finished: its last step's end. updated_at is no good here, because archiving rewrites it.
  const doneAt = (c: CardView): string => board.stepsFor(c.task.task_id).reduce<string>((t, s) => (s.ended_at || '') > t ? s.ended_at! : t, '') || c.task.updated_at

  /** Cards waiting on the owner, oldest first. Pinned cards keep no special place here: age decides. */
  const mine = computed(() => moves.value.filter(m => m.move.mover === 'you').sort(byOldest))

  const agents = computed<AgentRow[]>(() => {
    const rows = new Map<string, AgentRow>()
    const row = (id: string) => {
      if (!rows.has(id)) rows.set(id, { id, working: [], queued: [], owes: [], lastBeat: '' })
      return rows.get(id)!
    }
    for (const m of moves.value) {
      if (m.move.mover !== 'agent') continue
      const r = row(m.move.agent)
      if (m.card.chat && m.card.chat.assignee === m.move.agent) r.owes.push(m)
      else if (m.card.workState === 'in_progress') r.working.push(m)
      else r.queued.push(m)
    }
    // Last sign of life per agent, from every step it ever held.
    for (const s of board.steps) {
      const id = s.lease_owner || s.assignee
      const r = rows.get(id)
      const t = s.heartbeat_at || s.ended_at || ''
      if (r && t > r.lastBeat) r.lastBeat = t
    }
    // Busiest first: working, then owing answers, then queue length.
    return [...rows.values()].sort((a, b) => b.working.length - a.working.length || b.owes.length - a.owes.length || b.queued.length - a.queued.length)
  })

  const working = computed(() => agents.value.reduce((n, r) => n + r.working.length, 0))
  const queued = computed(() => agents.value.reduce((n, r) => n + r.queued.length, 0))

  /** Done cards, newest first. `today` counts the ones logged since midnight local time. */
  const shipped = computed(() => moves.value
    .filter(m => m.move.mover === 'done')
    .map(m => ({ ...m, move: { ...m.move, since: doneAt(m.card) } }))
    .sort((a, b) => b.move.since.localeCompare(a.move.since)))
  const shippedToday = computed(() => shipped.value.filter(m => Date.parse(m.move.since) >= startOfToday()))

  return { moves, mine, agents, working, queued, shipped, shippedToday }
}
