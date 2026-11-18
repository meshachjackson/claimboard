// Which agents' reads may come from the read cache.
// An agent that holds a board:class:* access row is class-scoped: it may read only cards of its classes, and that rule runs in n8n.
// The read cache carries no access rows, so this server cannot tell a scoped agent from an unscoped one. It fails closed:
// an agent is unscoped only when it is named in the `unscopedAgents` setting (NUXT_UNSCOPED_AGENTS). Every other agent's
// get_task and list_claimable go to the gateway's read_task and my_steps, as a sealed (OAuth) caller's do.

/** "agt-a, agt-b" as a list. An empty or missing setting is an empty list, so every agent goes to the gateway. */
export function unscopedAgentList(raw: unknown): string[] {
  return String(raw ?? '').split(',').map(x => x.trim()).filter(Boolean)
}

/** True when the class rule must run for this agent's reads, so they cannot come from the cache. */
export function readsNeedClassRule(agentId: string, unscoped: string[]): boolean {
  return !agentId || !unscoped.includes(agentId)
}
