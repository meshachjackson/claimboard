// Agent-op permission checks that run in Nuxt for the Postgres step store.
// Until now gw.gov-board-write checked these against gov_access in n8n. With step state in Postgres the check runs here,
// against gov_access rows the server already caches (n8n still owns the table and its change forms). Pure functions with no
// Nitro auto-imports, so the server and the tests share them. A row that is rejected or superseded never grants anything.
import type { AccessRow } from '~/types/registry'

/** Ops an agent-door (agt-door-*) may call: ask, read and message only (the ops repo check_op.js DOOR_OPS). */
export const DOOR_OPS = ['ask_vera', 'vera_reply', 'read_brief', 'read_task', 'my_steps', 'message_agent'] as const
/**
 * The agent ops the Postgres store answers. Everything else stays on the n8n gateway. message_agent (an agent's message
 * makes a chat step) and handoff_step (the note and chat step after an agent's create_task made its card in n8n) joined
 * at cutover step 5, so no agent write makes a step outside Postgres.
 */
export const STORE_OPS = ['claim_step', 'heartbeat', 'update_step', 'complete_step', 'add_note', 'list_claimable', 'get_task', 'message_agent', 'handoff_step'] as const

/**
 * Owner ops that create, cancel or retarget steps, or write notes. With the step store on, boardOps.ts runs them against
 * Postgres steps. create_task is not here: it inserts a card, and gov_tasks stays in n8n. split_task is: its
 * children are made through the gateway one by one and its note is written here (stepStore.ts, cutover step 5).
 */
export const CARD_OPS = ['move_task', 'start_task', 'send_back', 'publish_task', 'reopen_task', 'assign', 'approve_plan', 'reply', 'cancel_step', 'nudge', 'message_agent', 'done_no_steps', 'archive_task', 'add_note', 'split_task'] as const

const current = (row: AccessRow) => String(row.grade) !== 'rejected' && !(row as { superseded_by?: string }).superseded_by

/** The role slugs an agent holds through `board:role:<role>` rows. */
export function rolesOf(access: readonly AccessRow[], agentId: string): string[] {
  return access
    .filter(r => r.agent_id === agentId && current(r) && r.resource.startsWith('board:role:'))
    .map(r => r.resource.slice('board:role:'.length))
}

/** True when the agent holds a board:class:* row, so the class rule (which runs in n8n) must answer its reads. */
export function classScoped(access: readonly AccessRow[], agentId: string): boolean {
  return access.some(r => r.agent_id === agentId && current(r) && r.resource.startsWith('board:class:'))
}

const CLASS_SET = ['personal', 'catalyst', 'fj', 'general']

/** The classes an agent may work, from its current board:class:<x> rows (sorted, known classes only). Empty means unscoped. */
export function classesOf(access: readonly AccessRow[], agentId: string): string[] {
  const own = access
    .filter(r => r.agent_id === agentId && current(r) && r.resource.startsWith('board:class:'))
    .map(r => r.resource.slice('board:class:'.length))
    .filter(x => CLASS_SET.includes(x))
  return [...new Set(own)].sort()
}

/** The class slugs on a card's `class-<x>` tags. */
export function cardClasses(tags: string | null | undefined): string[] {
  return String(tags ?? '').split(',').map(x => x.trim().toLowerCase()).filter(x => x.startsWith('class-')).map(x => x.slice('class-'.length))
}

/**
 * The class rule, ported from the ops repo plan_board.js. A scoped agent works only
 * cards tagged with one of its classes. A card tagged only `general` is open to any scoped agent. A card with no class tag is
 * refused (fails closed). On a card with another class tag, `general` earns nothing: the card is as private as its most private class.
 */
export function classOk(classes: readonly string[], tags: string | null | undefined): boolean {
  if (classes.length === 0) return true
  const k = cardClasses(tags)
  if (k.length > 0 && k.every(x => x === 'general')) return true
  return k.filter(x => x !== 'general').some(x => classes.includes(x))
}

/** n8n's refusal text for a card outside the agent's classes. */
export function classRefusal(agentId: string, classes: readonly string[], taskId: string, tags: string | null | undefined): string {
  const k = cardClasses(tags)
  return `${agentId} may read or write only ${classes.join(', ')} cards; ${taskId}${k.length ? ` is ${k.join(', ')}` : ' has no class tag'}`
}

export interface StepFacts { assignee: string, role?: string }

/**
 * Why this agent may not run this op on the Postgres step store, or null. Mirrors the n8n checks:
 * the agent is active in gov_registry; a door only asks, reads and messages; a pool claim needs a board:role:<role> row.
 * Lease ownership and card policy are checked elsewhere (the op rules and shared/access.ts).
 */
export function storeRefusal(
  registry: readonly { agent_id: string, lifecycle_status: string }[],
  access: readonly AccessRow[],
  agentId: string,
  op: string,
  step?: StepFacts | null
): string | null {
  const agent = registry.find(r => r.agent_id === agentId)
  if (!agent) return `${agentId} is not in gov_registry`
  if (agent.lifecycle_status !== 'active') return `${agentId} is not active`
  if (/^agt-door-/.test(agentId) && !(DOOR_OPS as readonly string[]).includes(op)) return `${op} is not open to a door (ask, read and message only)`
  if (op === 'claim_step' && step && step.assignee.startsWith('pool:')) {
    const role = step.role ?? ''
    if (!role || !rolesOf(access, agentId).includes(role)) return `${agentId} has no board:role:${role} access row`
  }
  return null
}
