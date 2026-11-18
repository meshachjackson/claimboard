// Optional features, each behind one flag that is off by default. Pure helpers, shared by the app and the server,
// tested in test/feature-orchestrator.test.ts.
//
// The orchestrator flag (NUXT_PUBLIC_FEATURE_ORCHESTRATOR) turns on everything that assumes a single orchestrator agent
// and a Claude connector: the /orchestrator page, the OAuth connector routes (/oauth/*, /api/oauth/*, /.well-known/oauth-*),
// door sign-ins on /mcp and the ask tools (ask_vera, vera_reply). With it off, /mcp still serves the generic agent contract.
import { ASK_OPS } from '../app/types/board.ts'

/** A flag value from runtime config. Nuxt turns env text into booleans and numbers, so accept both shapes. */
export function featureOn(value: unknown): boolean {
  if (value === true || value === 1) return true
  return typeof value === 'string' && ['true', '1', 'on', 'yes'].includes(value.trim().toLowerCase())
}

/** True for an op that only works with the orchestrator feature (the ask ops). */
export function isOrchestratorOp(op: string): boolean {
  return (ASK_OPS as readonly string[]).includes(op)
}

/** The MCP tool list for a board: every tool with the feature on, the list without the ask tools with it off. */
export function agentToolsFor<T extends { name: string }>(all: readonly T[], orchestrator: boolean): T[] {
  return orchestrator ? [...all] : all.filter(t => !isOrchestratorOp(t.name))
}

/** Server instructions for /mcp: lines that name an ask tool are dropped with the feature off. */
export function agentInstructionsFor(lines: readonly string[], orchestrator: boolean): string {
  return (orchestrator ? lines : lines.filter(l => !ASK_OPS.some(op => l.includes(op)))).join('\n')
}

// The connector's server routes: the OAuth endpoints Claude calls and the page it sends the owner to.
const CONNECTOR_PREFIXES = ['/oauth/', '/api/oauth/', '/.well-known/oauth-']

/** True for a request path that belongs to the Claude connector (OAuth). These answer 404 with the feature off. */
export function isConnectorPath(path: string): boolean {
  return CONNECTOR_PREFIXES.some(p => path.startsWith(p))
}
