// Doors: the owner himself, signed in through one Claude account. A door is a gov_registry row
// with agent_type door whose id starts agt-door- (the registry repo schema 1.7). The gateway resolves its token to that id and
// limits it to asking, reading and messaging; its notes are authored as the board owner, with the door named. Here the door gets
// its own tool list and server instructions: relay the owner's words to the orchestrator word for word, and show its answer as it wrote it.
// Pure helpers, tested with `node --test` (test/door.test.ts).

export const DOOR_PREFIX = 'agt-door-'

/** True for a door's id. The gateway and the task-write workflow check the registry row too; this only picks the tool list. */
export function isDoorId(id: unknown): boolean {
  return typeof id === 'string' && /^agt-door-[a-z0-9-]+$/.test(id)
}

/** The MCP tools a door sees: ask_vera, vera_reply, vera_brief, get_task and `comment` (a comment with no step_id is message_agent). */
export const DOOR_TOOL_NAMES = ['ask_vera', 'vera_reply', 'vera_brief', 'get_task', 'comment'] as const
/** The wire ops a door may run, the gateway's DOOR_OPS. A call is checked after verbs and old names are resolved, so an alias cannot widen it. */
export const DOOR_OPS = ['ask_vera', 'vera_reply', 'vera_brief', 'get_task', 'message_agent'] as const

/** Sent as the MCP server's instructions to a door. The app's Claude relays; the orchestrator answers. */
export const DOOR_INSTRUCTIONS = [
  'You are a door to the orchestrator, the owner\'s orchestrator. The owner is the one typing. The orchestrator answers him; you do not.',
  'Send every message the owner writes to ask_vera, word for word: do not rephrase, summarize, translate or add to it.',
  'Show the orchestrator\'s answer word for word, as it wrote it. Do not answer for its, add your own view, or soften or shorten what it said.',
  'Pick one conversation_id for this chat (letters, digits, - and _, for example chat-20261102-1) and send it with every ask_vera here, so the orchestrator sees the earlier exchanges.',
  'To ask about one card, pass its task_id; the exchange then lives on the card.',
  'If ask_vera answers pending: true, tell the owner the orchestrator is still working on it, then call vera_reply with the ref it gave. Repeat when he asks.',
  'If a tool refuses, show the reason as given. Never put secrets or client data in a message.'
].join('\n')

const id = (what: string) => ({ type: 'string', description: what })

/** ask_vera and vera_reply as MCP tools. Every arg is text (the gateway's rule). */
export const ASK_TOOLS = [
  {
    name: 'ask_vera',
    description: 'Ask the orchestrator, the owner\'s orchestrator, and get its own answer: its state, open loops, recall and skills, from the real the orchestrator on the droplet. Send the owner\'s words exactly as he wrote them and show its answer exactly as it wrote it. Without task_id it changes nothing on the board; with task_id the question and answer land on that card. Can take up to about 100 seconds; if it answers pending: true, fetch the answer later with vera_reply.',
    inputSchema: {
      type: 'object',
      properties: {
        message: id('The owner\'s message, word for word. 1 to 4,000 characters; at most 2,000 with task_id.'),
        task_id: id('Optional TSK-… card to ask on.'),
        conversation_id: id('Optional id for this chat (1 to 64 letters, digits, - or _). Send the same one with every ask in the chat.')
      },
      required: ['message']
    }
  },
  {
    name: 'vera_reply',
    description: 'The orchestrator\'s answer to an ask_vera that came back pending: true. Pass its ref. Answers pending: true again while it is still working.',
    inputSchema: { type: 'object', properties: { ref: id('The ref ask_vera returned: ask-1234 or STP-NNNNNN') }, required: ['ref'] }
  }
] as const

/** The tools a door sees, in the order of DOOR_TOOL_NAMES, from the full list. */
export function doorTools<T extends { name: string }>(all: readonly T[]): T[] {
  return DOOR_TOOL_NAMES.map(name => all.find(t => t.name === name)).filter((t): t is T => !!t)
}

/** The fields an ask_vera or vera_reply answer adds beside ok and op, kept only when they have the gateway's shape. */
export function askFields(a: Record<string, unknown>): { ref?: string, pending?: boolean, answer?: string, status?: string, ticket_id?: string } {
  const out: { ref?: string, pending?: boolean, answer?: string, status?: string, ticket_id?: string } = {}
  if (typeof a.ref === 'string') out.ref = a.ref
  if (typeof a.pending === 'boolean') out.pending = a.pending
  if (typeof a.answer === 'string') out.answer = a.answer
  if (typeof a.status === 'string') out.status = a.status
  if (typeof a.ticket_id === 'string') out.ticket_id = a.ticket_id
  return out
}

type RegistryRow = { agent_id: string, name?: string | null, lifecycle_status?: string | null, agent_type?: string | null }
type AccessRow = { agent_id: string, resource: string, grade?: unknown }
export type ConnectorIdentity = { agent_id: string, name: string, classes: string[], kind: 'door' | 'agent' }

/**
 * The identities a connector may sign in as (active, with a board:class:* row that is not rejected),
 * each marked door or agent. Doors come first. A row whose type and id prefix disagree is left out,
 * as the gateway would refuse it. Whether a door already has an active token is not known here (board_tokens is never
 * read by agent-board); a second sign-in files a second hash, and each can be revoked on its own.
 */
export function connectorIdentities(registry: readonly RegistryRow[], access: readonly AccessRow[]): ConnectorIdentity[] {
  const classes = new Map<string, string[]>()
  for (const row of access) {
    if (!row.resource.startsWith('board:class:') || String(row.grade) === 'rejected') continue
    classes.set(row.agent_id, [...classes.get(row.agent_id) ?? [], row.resource.slice('board:class:'.length)])
  }
  const list = registry
    .filter(r => r.lifecycle_status === 'active' && classes.has(r.agent_id) && (r.agent_type === 'door') === isDoorId(r.agent_id))
    .map(r => ({ agent_id: r.agent_id, name: r.name ?? '', classes: classes.get(r.agent_id) ?? [], kind: isDoorId(r.agent_id) ? 'door' as const : 'agent' as const }))
  return [...list.filter(i => i.kind === 'door'), ...list.filter(i => i.kind === 'agent')]
}
