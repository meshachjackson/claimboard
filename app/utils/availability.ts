// Agent on/off switches (Settings > Agents). Pure functions, so tests need no server.
//   on   the agent takes work and messages as its registry row says.
//   off  the board stops sending it messages (they go to the orchestrator) and refuses its claim_step and list_claimable.
//   auto like on, plus the board shows whether the agent has been seen lately. Auto never blocks: an agent that is
//        idle has to be able to claim, or it could never show activity again.
import type { GovTaskNote, GovTaskStep } from '~/types/board'

export const SWITCH_MODES = ['on', 'auto', 'off'] as const
export type SwitchMode = typeof SWITCH_MODES[number]

/** "Active" means board activity from the agent in the last 30 minutes. */
export const ACTIVE_WINDOW_MS = 30 * 60_000

export const SWITCH_LABELS: Record<SwitchMode, string> = { on: 'On', auto: 'Auto', off: 'Off' }

export const isSwitchMode = (v: unknown): v is SwitchMode => (SWITCH_MODES as readonly unknown[]).includes(v)

const time = (v: string | null | undefined) => (v ? new Date(v).getTime() : Number.NaN)

/** The newest sign of life from an agent: a heartbeat, claim or ack on its steps, or a note it wrote. NaN if none. */
export function lastSeen(agentId: string, steps: GovTaskStep[], notes: GovTaskNote[]): number {
  const stamps = [
    ...steps.filter(s => s.assignee === agentId).flatMap(s => [s.heartbeat_at, s.dispatched_at, s.acked_at]),
    ...notes.filter(n => n.author_id === agentId).map(n => n.created_at)
  ].map(time).filter(Number.isFinite)
  return stamps.length ? Math.max(...stamps) : Number.NaN
}

export interface Presence {
  active: boolean
  /** "active now", "last seen 2 hours ago" or "no activity yet". */
  text: string
}

export function presence(seen: number, now = Date.now()): Presence {
  if (!Number.isFinite(seen)) return { active: false, text: 'no activity yet' }
  const ago = Math.max(0, now - seen)
  if (ago <= ACTIVE_WINDOW_MS) return { active: true, text: 'active now' }
  const minutes = Math.round(ago / 60_000)
  if (minutes < 60) return { active: false, text: `last seen ${minutes} minutes ago` }
  const hours = Math.round(minutes / 60)
  if (hours < 48) return { active: false, text: `last seen ${hours} hour${hours === 1 ? '' : 's'} ago` }
  return { active: false, text: `last seen ${Math.round(hours / 24)} days ago` }
}

/** What each mode means for the owner, in plain words. */
export const SWITCH_HELP: Record<SwitchMode, string> = {
  on: 'Takes work and messages as usual.',
  auto: 'Takes work as usual. The board shows whether it has been seen in the last 30 minutes.',
  off: 'Gets no messages (the orchestrator answers instead) and cannot claim steps.'
}

/**
 * The registry with one agent's switch set. `on` is the default, so it clears the field. Returns a new array and
 * leaves the input alone, so the store can keep the old rows to roll back to.
 */
export function applySwitch<T extends { agent_id: string, switch?: SwitchMode }>(registry: T[], agentId: string, mode: SwitchMode): T[] {
  return registry.map(a => (a.agent_id === agentId ? { ...a, switch: mode } : a))
}

/** Lays the switches the owner clicked but the server has not confirmed over a registry that just came from a read. */
export function overlayPending<T extends { agent_id: string, switch?: SwitchMode }>(registry: T[], pending: ReadonlyMap<string, SwitchMode>): T[] {
  return pending.size ? registry.map(a => (pending.has(a.agent_id) ? { ...a, switch: pending.get(a.agent_id) } : a)) : registry
}
