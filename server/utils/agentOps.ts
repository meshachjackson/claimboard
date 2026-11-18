// The agent contract, shared by REST (/api/agent/:op) and MCP (/mcp) so both behave the same.
// Writes pass the bearer token through to gw.gov-board-write as caller_token. Reads come from the
// read cache; the caller's agent_id comes from the gateway's whoami, cached by the token's SHA-256.
// Both caches are shared by every function instance (runtimeCache.ts).
// vera_brief always asks the gateway's read_brief, for every caller: the class rule runs in n8n.
// list_claimable with a cold cache asks the gateway's my_steps instead: one run, not whoami plus a read.
// Reads for any agent not named in `unscopedAgents` go to the gateway too, so the class rule runs for them (classScope.ts).
// A heartbeat the gateway would refuse as too soon is refused here from the read cache, with no run (heartbeat.ts).
import type { H3Event } from 'h3'
import type { GovTaskStep } from '~~/app/types/board'
import { AGENT_READ_OPS, AGENT_WRITE_OPS, ASK_OPS, boardOwner } from '~~/app/types/board'
import { claimableSteps } from '~~/app/utils/boardOps'
import { buildActivity } from '~~/app/utils/activity'
import { BRIEFING_TOOLS, buildReport } from '~~/app/utils/report'
import { lacksBudget, withClaudeCodeBudget } from './budget'
import { quietHeartbeat } from './heartbeat'
import { agentSwitchedOff, anySwitchedOff } from './switchStore'
import { readsNeedClassRule, unscopedAgentList } from './classScope'
import { agentRefusal, cardIdFor, claimableFor } from '~~/shared/access'
import { readPolicy } from './policy'
import { ASK_TOOLS } from './door'
import { finishRefusal } from '~~/app/utils/dispatch'
import { boardRows, createViaStepStore, runViaStepStore, splitViaStepStore, stepStoreHandles, stepStoreOn } from './stepStore'
import { resolveOp } from '~~/shared/verbs'
import { isOrchestratorOp } from '~~/shared/features'
import { orchestratorOn } from './features'

/** Writes on a step the agent holds: answered normally, with a switch notice when the owner has switched the agent off. */
const SWITCH_NOTICE_OPS: readonly string[] = ['heartbeat', 'update_step', 'complete_step']

export const AGENT_OPS: readonly string[] = [...AGENT_READ_OPS, ...AGENT_WRITE_OPS, ...ASK_OPS]

/** The token from `Authorization: Bearer <token>`, or '' without one. */
export function bearerToken(event: H3Event): string {
  const match = /^Bearer\s+(\S+)$/i.exec(getHeader(event, 'authorization') ?? '')
  return match?.[1] ?? ''
}

// Only the hash is kept, never the token. The map is in the shared Runtime Cache, so one instance's whoami
// serves them all; a cache that forgets it costs one whoami.
// 12 hours, because tokens change only through form.gov-board-token. A revoked token is refused on every write at once,
// but can still read cached rows for up to 12 hours (or until the Runtime Cache forgets it).
const WHOAMI_SECONDS = 12 * 60 * 60

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** The cached agent_id for a token, or '' when it isn't cached (or the entry is too old). */
async function cachedAgent(hash: string): Promise<string> {
  const hit = await cacheGet<{ hash: string, agentId: string }>(`whoami-${hash}`)
  // The stored hash must match: a cache entry for another token must never answer for this one.
  return hit && hit.hash === hash && typeof hit.agentId === 'string' ? hit.agentId : ''
}

function rememberAgent(hash: string, agentId: string): Promise<void> {
  return cacheSet(`whoami-${hash}`, { hash, agentId }, WHOAMI_SECONDS)
}

/** agent_id for a token, or '' when the gateway doesn't know it. */
export async function resolveAgent(token: string): Promise<string> {
  const hash = await tokenHash(token)
  const hit = await cachedAgent(hash)
  if (hit) return hit
  const result = await boardStore().write('whoami', {}, { token })
  if (!result.ok || !result.agent_id) return ''
  await rememberAgent(hash, result.agent_id)
  return result.agent_id
}

/**
 * list_claimable in one gateway run: my_steps resolves the token and lists the caller's
 * claimable steps together. Used only when it would save a run: the token or the board read isn't cached.
 * Returns null when my_steps isn't live, so the caller falls back to whoami plus the read cache.
 */
async function listViaMySteps(token: string): Promise<Record<string, unknown> | null> {
  if (!boardStore().capabilities().liveOps.includes('my_steps')) return null
  const hash = await tokenHash(token)
  if (await cachedAgent(hash) && await boardStore().cacheFresh()) return null
  const result = await boardStore().write('my_steps', {}, { token })
  if (!result.ok) return { ok: false, op: 'list_claimable', reason: result.reason }
  if (!result.agent_id) return { ok: false, op: 'list_claimable', reason: 'unknown token' }
  await rememberAgent(hash, result.agent_id)
  const tasks = result.rows.tasks ?? []
  return { ok: true, op: 'list_claimable', agent_id: result.agent_id, steps: (result.rows.steps ?? []).map(s => withTask(s, tasks)) }
}

/**
 * A sealed (OAuth) caller is class-scoped, and the class rule runs in n8n. So its get_task goes to the
 * gateway's read_task and its list_claimable to my_steps, never to the read cache. Both ops must be live: if one isn't, refuse.
 * A raw-token agent that is not named as unscoped is treated the same way (classScope.ts): Codex's token holds only
 * board:class:general and board:class:personal, and once read a catalyst card from the cache.
 */
async function runViaGateway(op: string, args: Record<string, unknown>, token: string): Promise<Record<string, unknown>> {
  const gatewayOp = op === 'get_task' ? 'read_task' : 'my_steps'
  const result = await boardStore().write(gatewayOp, op === 'get_task' ? { task_id: String(args.task_id ?? '') } : {}, { token })
  if (!result.ok) return { ok: false, op, reason: result.reason }
  if (op === 'get_task') {
    const task = result.rows.tasks?.[0]
    if (!task) return { ok: false, op, reason: `unknown task ${String(args.task_id ?? '')}` }
    return { ok: true, op, task, steps: [...(result.rows.steps ?? [])].sort((a, b) => a.step_no - b.step_no), notes: result.rows.notes ?? [] }
  }
  const tasks = result.rows.tasks ?? []
  return { ok: true, op, agent_id: result.agent_id, steps: (result.rows.steps ?? []).map(s => withTask(s, tasks)) }
}

/**
 * vera_brief: the gateway's read_brief, never the read cache, for a raw token and a sealed one alike. The answer carries
 * a `brief` beside its rows; the rows are empty and left out.
 */
async function runBrief(args: Record<string, unknown>, token: string): Promise<Record<string, unknown>> {
  const result = await boardStore().write('read_brief', args, { token })
  if (!result.ok) return { ok: false, op: 'vera_brief', reason: result.reason }
  return { ok: true, op: 'vera_brief', brief: result.brief }
}

/**
 * board_report: runs the named report tools (app/utils/report.ts) over the cached board. `tools` is a comma list such as
 * "orphans,behind,breakdown:priority"; blank means the briefing. The answer carries the sections and a /report link that
 * draws the same tools, so "show me the board report" is one call and no code.
 */
async function runReport(args: Record<string, unknown>, token: string, sealed: boolean): Promise<Record<string, unknown>> {
  const agentId = sealed ? '' : await resolveAgent(token)
  if (!sealed && !agentId) return { ok: false, op: 'board_report', reason: 'unknown token' }
  if (sealed || readsNeedClassRule(agentId, unscopedAgentList(useRuntimeConfig().unscopedAgents))) {
    return { ok: false, op: 'board_report', reason: 'board_report is not available to class-scoped callers' }
  }
  const spec = String(args.tools ?? '').trim()
  const report = buildReport(await boardRows(), spec || [...BRIEFING_TOOLS])
  return { ok: true, op: 'board_report', ...report, url: `/report${spec ? `?tools=${encodeURIComponent(spec)}` : ''}` }
}

/**
 * board_activity: what changed on the board between `since` and `until` (both ISO timestamps, `until` defaults to now).
 * A blank `since` means the owner's last action on the board, so "what happened overnight" is one call with no arguments.
 * Reads the cached board, so class-scoped callers are refused, as with board_report.
 */
async function runActivity(args: Record<string, unknown>, token: string, sealed: boolean): Promise<Record<string, unknown>> {
  const agentId = sealed ? '' : await resolveAgent(token)
  if (!sealed && !agentId) return { ok: false, op: 'board_activity', reason: 'unknown token' }
  if (sealed || readsNeedClassRule(agentId, unscopedAgentList(useRuntimeConfig().unscopedAgents))) {
    return { ok: false, op: 'board_activity', reason: 'board_activity is not available to class-scoped callers' }
  }
  try {
    const board = await boardRows()
    const activity = buildActivity(board, { since: String(args.since ?? '').trim(), until: String(args.until ?? '').trim(), owner: boardOwner() })
    return { ok: true, op: 'board_activity', ...activity }
  } catch (e) {
    return { ok: false, op: 'board_activity', reason: e instanceof Error ? e.message : 'bad request' }
  }
}

/**
 * board_errors: the faults the board logged in a window (errorLog.ts), grouped so one fault is one line with a count.
 * Blank `since` means the last hour. For "did you see that?" and "look at the error logs and make tickets".
 * Not for class-scoped callers, as with board_activity: a fault message can name any card.
 */
async function runErrors(args: Record<string, unknown>, token: string, sealed: boolean): Promise<Record<string, unknown>> {
  const agentId = sealed ? '' : await resolveAgent(token)
  if (!sealed && !agentId) return { ok: false, op: 'board_errors', reason: 'unknown token' }
  if (sealed || readsNeedClassRule(agentId, unscopedAgentList(useRuntimeConfig().unscopedAgents))) {
    return { ok: false, op: 'board_errors', reason: 'board_errors is not available to class-scoped callers' }
  }
  try {
    const report = await readErrors({ since: String(args.since ?? ''), until: String(args.until ?? ''), limit: Number(args.limit) })
    return { ok: true, op: 'board_errors', ...report }
  } catch (e) {
    return { ok: false, op: 'board_errors', reason: e instanceof Error ? e.message : 'bad request' }
  }
}

/** ask_vera or vera_reply through the gateway: { ok, op, ref, pending } and, once the orchestrator has answered, answer, status, ticket_id. */
async function runAsk(op: string, args: Record<string, unknown>, token: string): Promise<Record<string, unknown>> {
  const result = await boardStore().write(op, args, { token })
  if (!result.ok) return { ok: false, op, reason: result.reason }
  const { ref, pending, answer, status, ticket_id } = result
  return { ok: true, op, ref, pending, ...(answer !== undefined ? { answer, status, ticket_id } : {}) }
}

/** The gateway's "too soon" refusal when the read cache shows it, else ''. Uses only cached rows and a cached whoami. */
async function quietFromCache(token: string, args: Record<string, unknown>): Promise<string> {
  const board = await boardStore().cached()
  if (!board) return ''
  return quietHeartbeat(board.steps, args, await cachedAgent(await tokenHash(token)))
}

/**
 * Group rules for agents (shared/access.ts): an agent is held to the same policy as a person, under its agent id.
 * An op on a card or step it may not touch is refused, create_task and the briefs are checked, and list_claimable drops the work it may not see.
 * With no policy file this returns the op's result unchanged.
 */
export async function runAgentOp(name: string, rawArgs: Record<string, unknown>, token: string, sealed = false): Promise<Record<string, unknown>> {
  // A verb (claim, comment, block...) becomes the wire op it runs; a wire op name passes through, so old callers work.
  // Resolving first means the access rules, finish checks and step store below all see the wire op.
  const resolved = resolveOp(name, rawArgs, 'agent')
  if (!resolved.ok) return { ok: false, op: name, reason: resolved.reason }
  const { op, args } = resolved
  // The ask ops belong to the orchestrator feature (shared/features.ts); with it off they are refused before any lookup.
  if (isOrchestratorOp(op) && !orchestratorOn()) return { ok: false, op, reason: `${op} is not available on this board` }
  const policy = readPolicy()
  if (!policy || !AGENT_OPS.includes(op)) return runAgentOpChecked(op, args, token, sealed)
  const agentId = await resolveAgent(token)
  if (!agentId) return runAgentOpChecked(op, args, token, sealed) // an unknown token gets its usual refusal
  // Steps come from boardRows so a step the Postgres store made is policy-checked too (cutover step 6).
  const board = await boardRows()
  const taskId = cardIdFor(args, board.steps)
  const refusal = agentRefusal(policy, agentId, op, args, board.tasks.find(t => t.task_id === taskId))
  if (refusal) return { ok: false, op, reason: refusal }
  const result = await runAgentOpChecked(op, args, token, sealed)
  if (op === 'list_claimable' && Array.isArray(result.steps)) {
    const seen = claimableFor(policy, agentId, result.steps as GovTaskStep[], board.tasks)
    return { ...result, steps: seen }
  }
  return result
}

/**
 * Runs one agent op. Refusals come back as { ok: false, reason }; an unknown op is a 404.
 * `sealed` marks a caller that signed in with OAuth, whose reads never come from the cache.
 */
async function runAgentOpChecked(op: string, args: Record<string, unknown>, token: string, sealed: boolean): Promise<Record<string, unknown>> {
  if (!AGENT_OPS.includes(op)) throw createError({ statusCode: 404, statusMessage: 'Unknown op' })
  // The owner's off switch (Settings > Agents): a switched-off agent can neither list nor claim work. The token lookup
  // only happens when the switch file names an agent as off, so a board with no switches pays nothing.
  if ((op === 'claim_step' || op === 'list_claimable') && await anySwitchedOff()) {
    if (await agentSwitchedOff(await resolveAgent(token))) {
      return { ok: false, op, reason: 'this agent is switched off on the board' }
    }
  }
  // MCP clients send context as an object; the gateway takes every arg as text.
  if (op === 'create_task' && args.context && typeof args.context === 'object') args = { ...args, context: JSON.stringify(args.context) }
  // A shape check, not a permission check. A served ack needs a verdict; a blocked one needs a reason.
  // Chat steps (the owner's messages) are answered with served and no verdict, so the verdict rule covers work steps only.
  if (op === 'complete_step' || op === 'update_step') {
    const role = (op === 'complete_step' && args.step_state === 'served' && String(args.verdict ?? '').trim() === '')
      ? ((await boardStore().cached())?.steps.find(x => x.step_id === args.step_id)?.role ?? '')
      : ''
    const unfinished = finishRefusal(op, args, role)
    if (unfinished) return { ok: false, op, reason: unfinished }
  }
  // The gateway refuses a served or failed ack with no budget_used; Claude Code's fixed text is filled in here.
  if (op === 'complete_step' && lacksBudget(args)) args = withClaudeCodeBudget(args, await resolveAgent(token))
  // (path B): with NUXT_STEP_STORE=postgres the step ops are answered from Postgres, not n8n. Off by default.
  // Sealed (OAuth) callers stay on the n8n path: they are class-scoped, and the class rule runs there.
  // Placed after the budget fill and before the heartbeat pacing, which reads n8n's cached steps.
  // Cutover step 5: an agent's message_agent makes its chat step here too, and its create_task makes the card in n8n and
  // then the hand-off step here, so no agent write makes a step outside Postgres. A sealed (OAuth) or class-scoped caller is
  // refused before anything is written: the class rule runs in n8n, and a step written there is one the board no longer
  // shows (cutover step 6). Their reads keep the gateway path below, as before.
  if (stepStoreOn() && (stepStoreHandles(op) || op === 'create_task' || op === 'split_task')) {
    const writes = (AGENT_WRITE_OPS as readonly string[]).includes(op)
    if (sealed) {
      if (writes) return { ok: false, op, reason: 'sealed callers are not served by the step store yet' }
    } else {
      const agentId = await resolveAgent(token)
      if (!agentId) return { ok: false, op, reason: 'unknown token' }
      // The store applies the class rule itself for step ops (shared/agentAccess.ts). Filing a card (create_task, split_task) has its own
      // class rules in n8n, so a caller not named as unscoped is still refused those two.
      if ((op === 'create_task' || op === 'split_task') && readsNeedClassRule(agentId, unscopedAgentList(useRuntimeConfig().unscopedAgents))) return { ok: false, op, reason: 'class-scoped callers cannot file cards through the step store yet' }
      // split_task (the architect's fan-out): the children are cards made in n8n with the agent's token; the rules and the note run here.
      const result = op === 'create_task' ? await createViaStepStore(args, token, agentId)
        : op === 'split_task' ? await splitViaStepStore(args, token, agentId)
          : await runViaStepStore(op, args, agentId)
      if (result.ok && SWITCH_NOTICE_OPS.includes(op) && await agentSwitchedOff(agentId)) {
        return { ...result, switch: 'off', notice: 'this agent is switched off on the board: finish or release this step and stop claiming work' }
      }
      return result
    }
  }
  if (op === 'heartbeat') {
    const quiet = await quietFromCache(token, args)
    if (quiet) {
      console.info('[gateway] gw.gov-board-write heartbeat: refused on the board, no run (too soon)')
      return { ok: false, op, reason: quiet }
    }
  }
  if ((AGENT_WRITE_OPS as readonly string[]).includes(op)) {
    const result = await boardStore().write(op, args, { token })
    // A step already held is never cut off mid-write (the owner's Off stops new work, not a clean finish), but the agent is told,
    // so it can stop after this step. Same cost rule as above: no token lookup on a board with no switches.
    if (result.ok && SWITCH_NOTICE_OPS.includes(op) && await anySwitchedOff() && await agentSwitchedOff(await resolveAgent(token))) {
      return { ...result, switch: 'off', notice: 'this agent is switched off on the board: finish or release this step and stop claiming work' }
    }
    return result
  }
  // The orchestrator's own answer, from the gateway. The gateway decides who may ask (the owner's doors and unscoped agents).
  if ((ASK_OPS as readonly string[]).includes(op)) return runAsk(op, args, token)
  if (op === 'vera_brief') return runBrief(args, token)
  // The report reads every card from the read cache, so a class-scoped caller (sealed, or not named as unscoped) is refused:
  // the class rule runs in n8n and the cache has no per-class filter.
  if (op === 'board_report') return runReport(args, token, sealed)
  if (op === 'board_activity') return runActivity(args, token, sealed)
  if (op === 'board_errors') return runErrors(args, token, sealed)
  if (sealed) return runViaGateway(op, args, token)
  if (op === 'list_claimable') {
    const listed = await listViaMySteps(token)
    if (listed) return listed
  }

  const agentId = await resolveAgent(token)
  if (!agentId) return { ok: false, op, reason: 'unknown token' }
  if (readsNeedClassRule(agentId, unscopedAgentList(useRuntimeConfig().unscopedAgents))) return runViaGateway(op, args, token)
  const board = await boardStore().read()

  if (op === 'list_claimable') {
    const steps = claimableSteps(board, agentId)
    return { ok: true, op, agent_id: agentId, steps: steps.map(s => withTask(s, board.tasks)) }
  }
  // get_task
  const taskId = String(args.task_id ?? '')
  const task = board.tasks.find(t => t.task_id === taskId)
  if (!task) return { ok: false, op, reason: `unknown task ${taskId}` }
  return {
    ok: true,
    op,
    task,
    steps: board.steps.filter(s => s.task_id === taskId).sort((a, b) => a.step_no - b.step_no),
    notes: board.notes.filter(n => n.task_id === taskId)
  }
}

/** A claimable step with the card fields an agent needs to decide. */
function withTask(step: GovTaskStep, tasks: { task_id: string, title: string, stage?: string, updated_at: string }[]) {
  const task = tasks.find(t => t.task_id === step.task_id)
  return { ...step, task_title: task?.title ?? '', task_stage: task?.stage ?? '' }
}

// ---------- MCP tool list: one tool per agent op, JSON Schema inputs ----------

/** Server-wide rule for every tool whose text the owner reads on the card (comment, complete, block, request_review), so questions and stop reasons are in plain words. */
const PLAIN = 'Write for the owner, not for engineers: say what happened, what you need from him and what he should do next, in plain words. Give any ticket or step ID a short title, and keep jargon and file paths out of the first two sentences.'

// Every arg is text, and each tool takes exactly these keys (gw.gov-board-write's op table, the ops repo).
const id = (what: string) => ({ type: 'string', description: what })
const updatedAt = id('The row\'s updated_at as last read. A mismatch is refused with reason "stale": re-read and retry.')

/** Sent as the MCP server's instructions, so any Claude account gets the working rules with no skill to install. */
export const VERA_INSTRUCTIONS = [
  'This is the orchestrator, the owner\'s orchestrator, reached through the agent board. The board is its inbox.',
  'If the board seems broken, call board_errors: it lists what the board logged as faults, grouped. File one card per fault with create, not one per occurrence.',
  'At the start of work, call vera_brief to learn what the orchestrator is focused on, what is open and what is stale.',
  'Verbs: create, claim, heartbeat, comment, complete, block, request_review, split, plus the reads list_claimable and get_task. The older names (create_task, claim_step, add_note, message_agent, update_step, complete_step, split_task) still work.',
  'Hand work to the orchestrator with create: a short title, original_request in the requester\'s own words, acceptance_requirements as checkable outcomes, and context (source_surface, account, repo, branch, pr_url, session_id, classification).',
  'Always set classification: personal, catalyst or fj. Never put client data (rate sheets, PII, contracts) in a card or note; describe where it lives instead.',
  'Follow up on a card with comment (no step_id); the orchestrator answers with a note on the card. Read answers with get_task.',
  'Steps assigned to you show in list_claimable. Claim one, heartbeat when your activity changes or every 10 minutes, and finish with complete.',
  'Every turn on a step you hold must end with a finishing call, never silence: complete with a verdict (PASS, or FAIL with the reason); block with a reason that starts with the block kind in brackets; or request_review with a summary saying what to look at. A blocked step stops being yours unless you pass hold:true.',
  'Block kinds: [needs_input] a question only the owner can answer; [dependency] another card or step must finish first; [transient] a rate limit or network error a retry may fix; [capability] you lack a tool, key or access and a different agent is needed. A served step with no verdict is refused.',
  'A turn that ends without a finishing call gets two reminders from the dispatcher, then the step is blocked for the owner.',
  PLAIN,
  'Every write takes the row\'s updated_at as last read. On "stale", call get_task and retry once. Never send secrets; text that looks like one is refused.',
  'To get the orchestrator\'s own answer now, use ask_vera (its state, recall and skills); show what it says as it wrote it.'
].join('\n')

export const AGENT_TOOLS = [
  {
    name: 'vera_brief',
    description: 'What the orchestrator is focused on, what is open and what is stale (focus line, next 3 open loops, watched loops, counts), scoped to your account; read only.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'board_report',
    description: 'Findings the board does not show on its own (orphans, overdue, almost done, behind...), plus a url that draws them as a visual report; not for class-scoped callers.',
    inputSchema: { type: 'object', properties: { tools: id('Comma-separated report tools, blank for the default briefing: orphans (open cards with no project or assignee), batchable (backlog cards of one project and type one agent could take together), almost_done (projects with 1 or 2 cards left), behind (projects with most open cards overdue), overdue (open cards past due or due in 90 days), progress (done, in flight, not started per project), breakdown:<field> (open cards counted by work_state, stage, priority, assignee, project_id or task_type). Example: "overdue,breakdown:priority".') } }
  },
  {
    name: 'board_activity',
    description: 'What changed on the board in a time window (cards, steps, notes; who and when, newest first), for "what did my agents do overnight"; not for class-scoped callers.',
    inputSchema: { type: 'object', properties: { since: id('Start of the window, ISO timestamp such as 2026-11-01T22:00:00-06:00. Blank: the owner\'s last board action. Each card or step shows its latest change once.'), until: id('End of the window, ISO timestamp. Blank: now.') } }
  },
  {
    name: 'board_errors',
    description: 'Errors the board itself logged in a time window, grouped by fault with a count, first and last seen; for "what just went wrong" and "look at the error logs and file tickets"; not for class-scoped callers.',
    inputSchema: { type: 'object', properties: { since: id('Start of the window, ISO timestamp. Blank: the last hour.'), until: id('End of the window, ISO timestamp. Blank: now.'), limit: { type: 'number', description: 'Most rows to read, 1 to 500. Default 200.' } } }
  },
  {
    name: 'create',
    description: 'Hand a task to the orchestrator: files a card and wakes its to triage it; it answers with a note on the card.',
    inputSchema: {
      type: 'object',
      properties: {
        title: id('Short card title, at most 200 characters'),
        original_request: id('What was asked, in the requester\'s words'),
        acceptance_requirements: id('How the orchestrator knows it is done: checkable outcomes'),
        task_type: { type: 'string', enum: ['build', 'operational'] },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        project_id: id('Optional project, for example agent-board'),
        tags: id('Optional comma-separated lowercase slugs'),
        due_at: id('Optional ISO date'),
        context: {
          type: 'object',
          description: 'Where this came from. Text values only.',
          properties: {
            source_surface: id('claude-code, claude-desktop, claude-ai or cursor'),
            account: id('Which Claude account, for example personal or catalyst'),
            repo: id('Repository name, when there is one'),
            branch: id('Git branch'),
            pr_url: id('Pull request URL'),
            session_id: id('This session\'s id'),
            classification: { type: 'string', enum: ['personal', 'catalyst', 'fj'], description: 'Whose data this is. Required by the owner\'s data-segregation rule.' }
          },
          required: ['classification'],
          additionalProperties: false
        }
      },
      required: ['title', 'original_request', 'context']
    }
  },
  {
    name: 'list_claimable',
    description: 'Steps you may claim now: steps assigned to you and pool steps for your agent_type. A step with role "chat" is a message from the owner: read the note named in input_ref (get_task), claim the step, and answer with complete_step (served, the answer in output_summary).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_task',
    description: 'One card with its steps and notes.',
    inputSchema: { type: 'object', properties: { task_id: id('TSK-…') }, required: ['task_id'] }
  },
  {
    name: 'claim',
    description: 'Claim a step for a 900-second lease; refused when another agent won.',
    inputSchema: {
      type: 'object',
      properties: { step_id: id('STP-…'), claim_key: id('The step\'s claim_key, as listed'), updated_at: updatedAt },
      required: ['step_id', 'claim_key', 'updated_at']
    }
  },
  {
    name: 'heartbeat',
    description: 'Say what you are doing (at most 140 characters) and extend the lease; send on a change and every 10 minutes.',
    inputSchema: {
      type: 'object',
      properties: { step_id: id('STP-…'), activity: id('Short status line'), updated_at: updatedAt },
      required: ['step_id', 'activity', 'updated_at']
    }
  },
  {
    name: 'comment',
    description: 'Comment on a card: with step_id, a note on the step you hold; without it, a message to the agent on the card (or the orchestrator).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: id('TSK-…'),
        step_id: id('STP-…, the step you hold the lease on. Leave out to message the card instead.'),
        kind: { type: 'string', enum: ['comment', 'question', 'proposal', 'summary', 'status'], description: 'Note kind, when step_id is given' },
        body: id('The text, at most 2,000 characters')
      },
      required: ['task_id', 'body']
    }
  },
  {
    name: 'complete',
    description: 'Finish a step you hold as served (verdict required: PASS, or FAIL with the reason in stop_reason) or failed.',
    inputSchema: {
      type: 'object',
      properties: {
        step_id: id('STP-…'),
        step_state: { type: 'string', enum: ['served', 'failed'], description: 'Default served' },
        verdict: { type: 'string', description: 'Required when served: PASS, or FAIL with the reason in stop_reason' },
        target_ticket_ref: id('Optional ticket ref'),
        budget_used: id('Required for served and failed (for example "in 120, out 80 tokens"). Claude Code may leave it out: the board writes "not metered".'),
        output_ref: id('Where the output is'),
        output_summary: id('At most 500 characters, cut past that. A chat step\'s answer: at most 2,000.'),
        stop_reason: id('For failed: start with the block kind, such as "[capability] No push access."'),
        updated_at: updatedAt
      },
      required: ['step_id', 'updated_at']
    }
  },
  {
    name: 'block',
    description: 'Stop on a step you hold, with a reason that starts with [needs_input], [dependency], [transient] or [capability].',
    inputSchema: {
      type: 'object',
      properties: {
        step_id: id('STP-…'),
        reason: id('Why, starting with the block kind. For needs_input this is the question the owner answers.'),
        step_state: { type: 'string', enum: ['needs_input', 'failed'], description: 'Default needs_input' },
        hold: { type: 'boolean', description: 'true keeps the step yours and asks nothing of the owner' },
        output_summary: id('Optional extra detail, at most 500 characters'),
        budget_used: id('For failed: tokens used; Claude Code may leave it out'),
        updated_at: updatedAt
      },
      required: ['step_id', 'reason', 'updated_at']
    }
  },
  {
    name: 'request_review',
    description: 'Finish a step and ask the owner to review it; say what to look at in summary.',
    inputSchema: {
      type: 'object',
      properties: {
        step_id: id('STP-…'),
        summary: id('What to look at, at most 500 characters'),
        verdict: { type: 'string', description: 'Default PASS' },
        output_ref: id('Where the output is'),
        budget_used: id('Tokens used; Claude Code may leave it out'),
        updated_at: updatedAt
      },
      required: ['step_id', 'summary', 'updated_at']
    }
  },
  {
    name: 'split',
    description: 'Split the card whose architect step you hold into 1 to 10 Backlog children that wait until it is done. Each child inherits the project, priority and class tags.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: id('TSK-…, the card whose open architect step you hold'),
        children: id('JSON text: a list of { title, acceptance_requirements? } objects, 1 to 10 of them'),
        updated_at: updatedAt
      },
      required: ['task_id', 'children', 'updated_at']
    }
  },
  ...ASK_TOOLS
]
