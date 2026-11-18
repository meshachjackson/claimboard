// build order step 4: gw.gov-board-write refuses a served or failed complete_step without budget_used.
// Claude Code runs on a subscription and cannot read its own token use, so for its agent id the server fills the
// one fixed text below when the call leaves the field out. Any other agent must send its own number.
import { AGENT_TARGETS } from '../../app/utils/dispatch.ts'

/** The agents Claude Code runs as: the ones NUXT_PUBLIC_AGENT_TARGETS sends to the laptop dispatcher. */
export const claudeCodeAgents = (): string[] => Object.entries(AGENT_TARGETS).filter(([, t]) => t === 'laptop').map(([id]) => id)
export const NOT_METERED = 'attempts 1, tokens 0 (not metered: Claude Code subscription)'

/** True when the ack is served or failed and says nothing about its budget. */
export function lacksBudget(args: Record<string, unknown>): boolean {
  return ['served', 'failed'].includes(String(args.step_state ?? '')) && !String(args.budget_used ?? '').trim()
}

/** The args with Claude Code's fixed budget text added when it is missing; every other agent's args come back unchanged. */
export function withClaudeCodeBudget(args: Record<string, unknown>, agentId: string): Record<string, unknown> {
  return lacksBudget(args) && claudeCodeAgents().includes(agentId) ? { ...args, budget_used: NOT_METERED } : args
}
