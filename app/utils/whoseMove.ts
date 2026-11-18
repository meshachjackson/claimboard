// Whose move a card is (redesign , docs/design/redesign/decision.md): the owner's, an agent's, nobody's yet, or
// finished. Display only: it reads the rows the board already has and writes nothing. The Floor's three zones use it.
import type { GovTask, GovTaskStep, RegistryAgent, WorkState } from '~/types/board'
import { isPool, poolType } from '~/utils/rollup'

export type Mover = 'you' | 'agent' | 'nobody' | 'done'

export interface WhoseMove {
  mover: Mover
  agent: string // agent id, pool:<type> or '' when the move is not an agent's
  since: string // ISO time the move became theirs, '' when unknown
}

/** The fields of a board card this rule needs (CardView carries them all). */
export interface MoveInput {
  task: GovTask
  workState: WorkState
  primary: GovTaskStep | null
  chat: GovTaskStep | null
  approvalPending: boolean
  /** Why no agent can take the card's open step (noTaker), else '' or absent. */
  stranded?: string
}

const OPEN: GovTaskStep['step_state'][] = ['awaiting_start', 'awaiting_pull', 'dispatched']

export function whoseMove(card: MoveInput): WhoseMove {
  const { task, workState, primary, chat } = card
  if (workState === 'done') return { mover: 'done', agent: '', since: task.updated_at }

  // An open message to an agent wins: the owner asked and is waiting, so the card is not his to act on.
  if (chat && OPEN.includes(chat.step_state)) return { mover: 'agent', agent: chat.assignee, since: chat.created_at }

  // No agent can take the open step, so waiting gets nowhere: deciding what to do with it is the owner's move.
  if (card.stranded) return { mover: 'you', agent: '', since: primary?.created_at || task.updated_at }

  if (workState === 'blocked' || workState === 'needs_input' || workState === 'verifying' || card.approvalPending) {
    const since = primary?.ended_at || primary?.updated_at || task.updated_at
    return { mover: 'you', agent: '', since }
  }

  if (workState === 'backlog') return { mover: 'nobody', agent: '', since: task.created_at }

  // awaiting_start or in_progress: the open step's holder has the move, a pool when nobody claimed it yet.
  if (primary && OPEN.includes(primary.step_state)) {
    return { mover: 'agent', agent: primary.lease_owner || primary.assignee, since: primary.heartbeat_at || primary.created_at }
  }
  // Out of Backlog with no open step: no agent will pick it up, so starting it is the owner's move.
  return { mover: 'you', agent: '', since: task.updated_at }
}

/** A card that is the owner's move only because no agent holds it: out of Backlog, not stopped or asking, no open step. */
export function unheld(card: MoveInput): boolean {
  return (card.workState === 'awaiting_start' || card.workState === 'in_progress') && !card.approvalPending && !card.stranded && whoseMove(card).mover === 'you'
}

/**
 * Why no agent can take this card, or '' when one can. Three cases: the card's class tags rule its assignee out (the
 * classWarning text), an unclaimed pool step whose agent type has nobody in service and switched on, or an unclaimed
 * step for a named agent that is retired or switched off. Display only; the board and the Floor mark these cards.
 */
export function noTaker(
  card: { workState: WorkState, stage: string, archived: boolean, primary: GovTaskStep | null, classWarning: string },
  registry: RegistryAgent[]
): string {
  if (card.archived || card.workState === 'done' || card.stage === 'backlog' || card.stage === 'done') return ''
  if (card.classWarning) return card.classWarning
  const p = card.primary
  if (!p || !['awaiting_pull', 'awaiting_start'].includes(p.step_state)) return ''
  const working = (a: RegistryAgent) => a.lifecycle_status === 'active' && a.switch !== 'off'
  if (isPool(p.assignee)) {
    const type = poolType(p.assignee)
    if (registry.some(a => a.agent_type === type && working(a))) return ''
    // Say which: agents of the type exist but are all switched off (a switch away), or there are none in service.
    return registry.some(a => a.agent_type === type && a.lifecycle_status === 'active') ? `Every ${type} agent is switched off` : `No ${type} agent is in service`
  }
  const a = registry.find(x => x.agent_id === p.assignee)
  if (!a || working(a)) return '' // a person, or an agent the registry does not list: the board can't tell
  return `${a.name || a.agent_id} is ${a.switch === 'off' ? 'switched off' : 'not in service'}`
}

/**
 * The Start button a card offers (start_task): Start in Backlog, Restart in Build once nothing is running. Matches the
 * gateway's own check, which refuses only while the last builder step is still open. A stopped card counts even when its
 * last step finished with a FAIL verdict, as do a failed step and no step.
 * A card waiting on an answer (needs_input) offers neither: the answer is the move. A card already working
 * (in_progress) never offers Start; Restart stays for one in Build with no open step.
 */
export function startLabel(card: MoveInput & { stage: string, archived: boolean }): '' | 'Start' | 'Restart' {
  if (card.workState === 'done' || card.archived) return ''
  if (card.workState === 'needs_input') return ''
  if (card.stage === 'backlog') return card.workState === 'in_progress' ? '' : 'Start'
  if (card.stage !== 'build') return ''
  const p = card.primary
  const stopped = card.workState === 'blocked' || !p || p.step_state === 'failed'
  return stopped ? 'Restart' : ''
}

/** Whole hours from an ISO time to now, for "Waiting 19 h". */
export function hoursSince(iso: string, now = Date.now()): number {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 3_600_000))
}

/** "19 h", "1 day", "3 days". Under an hour reads "just now". */
export function waitLabel(iso: string, now = Date.now()): string {
  const h = hoursSince(iso, now)
  if (h < 1) return 'just now'
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? '1 day' : `${d} days`
}
