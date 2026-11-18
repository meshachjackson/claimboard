// Plain-language explanations: what is happening on a card, what the owner can do about it, and what each agent can do.
// Pure functions over rows. The words for states, stages and roles live in types/board.ts. The rules described here come
// from boardOps.ts (the move, assign and cancel checks); change both together.
import type { BoardColumn, GovTask, GovTaskStep, RegistryAgent, Stage, WorkState } from '~/types/board'
import { REQUEST_TYPE_LABELS, ROLE_LABELS, STAGE_LABELS, orchestratorId } from '~/types/board'
import { canWake, takesMessages } from '~/utils/boardOps'
import { heldClasses, laneOf } from '~/utils/agentLane'
import { formatTime } from '~/utils/format'
import { columnRoles, isPool, parseMatch, poolType } from '~/utils/rollup'

// ---------- Agents ----------

/** How work reaches this agent, and so how long to wait for it. '' when the registry row says nothing. */
export function deliveryText(agent: RegistryAgent | undefined): string {
  if (!agent) return ''
  if (agent.switch === 'off') return 'Switched off in Settings, so it gets no messages and cannot claim steps.'
  if (agent.lifecycle_status !== 'active') return `Not in service (${agent.lifecycle_status.replace('_', ' ')}), so it picks up nothing.`
  const lane = laneOf(agent)
  if (lane === 'api') return 'Runs by itself through the API, no session needed. Takes only cards tagged class-general.'
  if (lane === 'harness') return 'Runs in a coding session on your laptop. It picks up work only while a session is open.'
  if (agent.wakes === true && agent.reachability === 'outbound_only') return 'Starts on its own a minute or so after the card is moved to it. It also checks the board on a schedule, in case a wake is missed.'
  if (canWake(agent.agent_id, [agent])) return 'Hosted. "Respond now" wakes it; otherwise it answers on its next sweep.'
  if (agent.reachability === 'unreachable_when_asleep') return 'Works only while your laptop is awake. Otherwise the card waits.'
  if (agent.reachability === 'outbound_only') return 'Cannot be woken. Its build and plan steps start when the dispatcher picks them up (about a minute); messages wait for an open session or its own schedule.'
  if (!agent.agent_type) return 'Not set up for board work: no agent type in the registry, so it cannot claim steps.'
  return ''
}

export interface AgentProfile {
  id: string
  name: string
  summary: string
  /** Column work it can take, e.g. "Build: Builds it". Empty when it is not in any pool. */
  takes: string[]
  /** Why `takes` is empty, or '' when it is not. */
  noPool: string
  /** The kinds of request it answers, in words. */
  does: string[]
  /** Whether it answers a message sent from a card, in words. */
  messages: string
  delivery: string
  classes: string[]
}

/** Which stages an agent can be pooled into follows its agent_type and each column's roles. */
export function agentProfile(agent: RegistryAgent, columns: BoardColumn[]): AgentProfile {
  const type = agent.agent_type ?? ''
  const takes: string[] = []
  if (type) {
    for (const col of columns.filter(c => c.view === 'stages').sort((a, b) => a.position - b.position)) {
      const stage = parseMatch(col.match).value as Stage
      for (const r of columnRoles(col)) {
        if (r.agent_types?.includes(type)) takes.push(`${STAGE_LABELS[stage]}: ${ROLE_LABELS[r.role] ?? r.role}${r.required ? '' : ' (optional)'}`)
      }
    }
  }
  const noPool = takes.length ? '' : type
    ? `No column uses the "${type}" agent type.`
    : 'No agent type in the registry, so it is in no pool. It gets work only when you name it on a card.'
  const requests = (agent.request_types ?? '').split(',').map(r => r.trim()).filter(Boolean)
  return {
    id: agent.agent_id,
    name: agent.name,
    summary: agent.description,
    takes,
    noPool,
    does: requests.map(r => REQUEST_TYPE_LABELS[r] ?? r),
    messages: agent.agent_id === orchestratorId()
      ? 'Answers when the agent on a card cannot.'
      : takesMessages(agent.agent_id, [agent]) ? 'Answers messages on its cards.' : 'Does not take messages. The orchestrator answers instead.',
    delivery: deliveryText(agent),
    classes: heldClasses(agent)
  }
}

// ---------- Cards ----------

/** Whose move the card is lives in one place, utils/whoseMove.ts; this explains it in words. */
export interface Explain {
  /** One line for the card. Blank when the pill already says enough. */
  short: string
  headline: string
  detail: string
  /** What the owner can do, in order of how often it is the right move. */
  options: string[]
}

export interface ExplainInput {
  task: GovTask
  stage: Stage
  workState: WorkState
  primary: GovTaskStep | null
  /** Every step on the card that was not cancelled, and the cancelled ones too: escalation can name either. */
  allSteps: GovTaskStep[]
  /** Set when an approve button already explains the card. */
  needsApproval: boolean
  /** An open message nobody has answered: who and for how many hours. */
  noReply: { agent: string, hours: number } | null
  classWarning: string
}

interface ExplainCtx {
  registry: RegistryAgent[]
  nameOf: (id: string) => string
}

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
const OPEN_STATES = ['awaiting_start', 'awaiting_pull', 'dispatched', 'needs_input']

/** " (builder step, API agent)": an ID always carries its title. */
function stepLabel(id: string, steps: GovTaskStep[], ctx: ExplainCtx): string {
  const s = steps.find(x => x.step_id === id)
  return s ? `${id} (${s.role || 'step'}, ${ctx.nameOf(s.assignee)})` : id
}

/** Restart on the card (boardOps start_task) starts a fresh step. */
const reRun = (who: string) => `Press Restart on the card. That starts a new step for ${who}.`

function explainBlocked(c: ExplainInput, ctx: ExplainCtx): Explain {
  const { task, stage, primary, allSteps } = c
  const agentName = ctx.nameOf(primary?.assignee || task.assignee)
  const next = task.assignee ? ctx.nameOf(task.assignee) : 'the next eligible agent'
  const esc = /^(STP-\d+)\s+(.*)$/.exec(task.escalation ?? '')

  if (primary?.step_state === 'failed') {
    return {
      short: `Stopped: ${agentName} could not finish`,
      headline: `${agentName} stopped and could not finish`,
      detail: `${primary.stop_reason ? `Their reason: "${clip(primary.stop_reason, 220)}". ` : ''}The board retries a failed build step once by itself; this one is past that.`,
      options: [
        'Read the agent\'s note in the thread to see what went wrong.',
        `When the cause is fixed: ${reRun(next)}`,
        'If the work is no longer needed, close the card.'
      ]
    }
  }
  if (esc?.[2] === 'cancelled') {
    return {
      short: 'Stopped: a step was cancelled, nothing is running',
      headline: 'A step was cancelled and nothing is running',
      detail: `${stepLabel(esc[1]!, allSteps, ctx)} was cancelled, so the card turned Blocked. The board does not start a replacement by itself.`,
      options: [reRun(next), 'To drop the work, move the card on or close it.']
    }
  }
  if (esc?.[2] === 'verdict blank') {
    return {
      short: `Stopped: ${agentName} gave no pass or fail`,
      headline: `${agentName} finished but gave no verdict`,
      detail: `${stepLabel(esc[1]!, allSteps, ctx)} is finished, but the agent did not say pass or fail, so the board cannot tell whether the work is good.`,
      options: [
        'Read the result in the thread.',
        'To look it over properly, move the card to Review.',
        `To run it again, reply with what to fix, or press Restart on the card to start a new step for ${next}.`
      ]
    }
  }
  return {
    short: 'Stopped: the board flagged this card',
    headline: 'The board flagged this card',
    detail: task.escalation && task.escalation !== 'none'
      ? `Reason recorded on the card: "${clip(task.escalation, 220)}".`
      : 'No step is running and the card does not say why.',
    options: ['Read the thread for the last note from the agent.', 'Reply, or move the card, to decide what happens next.']
  }
}

function explainNeedsInput(c: ExplainInput, ctx: ExplainCtx): Explain {
  const { primary, noReply } = c
  if (noReply) {
    const who = ctx.nameOf(noReply.agent)
    const agent = ctx.registry.find(a => a.agent_id === noReply.agent)
    const wake = canWake(noReply.agent, ctx.registry)
    return {
      short: `No reply from ${who} for ${noReply.hours} h`,
      headline: `${who} has not answered your message`,
      detail: `Sent ${noReply.hours} hours ago. ${deliveryText(agent)}`.trim(),
      options: wake
        ? ['Press "Respond now" under the reply box to wake them.']
        : ['They cannot be woken from here, so the answer comes when they next check.', 'If you no longer need the answer, close the card.']
    }
  }
  // A needs_input card with no question step (or none with an agent on it) still gets a useful line.
  if (primary?.step_state !== 'needs_input' || !primary.assignee) {
    return {
      short: 'Waiting for your answer',
      headline: 'This card is waiting for your answer',
      detail: 'It is marked as needing you, but no agent has an open question on it. Read the latest notes in the thread to see what is being asked.',
      options: ['Reply in the box at the bottom, or move the card on if the question no longer matters.']
    }
  }
  const who = ctx.nameOf(primary.assignee)
  return {
    short: `${who} is waiting for your answer`,
    headline: `${who} is waiting for your answer`,
    detail: `${who} stopped on ${primary.step_id} to ask you something. The orange Question in the thread says what. They will not continue until you reply.`,
    options: [
      'Type your answer in the box at the bottom and press "Reply · starts a step". That gives them a new step to work on.',
      '"Add note" only records text. It does not wake the agent.'
    ]
  }
}

function explainWaiting(c: ExplainInput, ctx: ExplainCtx): Explain | null {
  const { primary, classWarning } = c
  if (classWarning) {
    return {
      short: 'Will not run: the card is missing a class tag',
      headline: 'This card will not run as it is',
      detail: classWarning,
      options: ['Open Edit and add the class tag the agent needs, or pick an assignee that holds the card\'s class.']
    }
  }
  if (!primary) return null
  if (primary.step_state === 'awaiting_pull' && isPool(primary.assignee)) {
    const type = poolType(primary.assignee)
    const inService = ctx.registry.filter(a => a.lifecycle_status === 'active' && a.agent_type === type)
    // A switched-off agent takes no work (Settings > Agents), so it doesn't count as able to take this.
    const eligible = inService.filter(a => a.switch !== 'off')
    if (!eligible.length) {
      const off = inService.length > 0
      return {
        short: off ? `Open, but every ${type} agent is switched off` : `Open, but no ${type} agent is in service`,
        headline: off ? `Open to any ${type} agent, and every one is switched off` : `Open to any ${type} agent, and none is in service`,
        detail: off ? `${inService.map(a => a.name).join(', ')} ${inService.length === 1 ? 'is' : 'are'} switched off. Nothing will pick this up as it stands.` : 'Nothing will pick this up as it stands.',
        options: [
          ...(off ? ['Turn one back on in Settings > Agents.'] : []),
          'Assign a specific agent, then move the card out and back in.'
        ]
      }
    }
    return {
      short: '',
      headline: `Open to any ${type} agent`,
      detail: `No agent has claimed it yet. ${eligible.map(a => a.name).join(', ')} can; the first to check the board takes it.`,
      options: []
    }
  }
  if (primary.step_state === 'awaiting_pull' || primary.step_state === 'awaiting_start') {
    const who = ctx.nameOf(primary.assignee)
    const agent = ctx.registry.find(a => a.agent_id === primary.assignee)
    return { short: '', headline: `Waiting for ${who} to start`, detail: deliveryText(agent), options: [] }
  }
  return null
}

/** What is going on with a card and what to do about it. Null when the pill and the drawer's other parts already say it. */
export function explainCard(c: ExplainInput, ctx: ExplainCtx): Explain | null {
  // An approve button already explains these two states; blocked and the rest still need words.
  if (c.needsApproval && (c.workState === 'needs_input' || c.workState === 'awaiting_start')) return null
  switch (c.workState) {
    case 'blocked': return explainBlocked(c, ctx)
    case 'needs_input': return explainNeedsInput(c, ctx)
    case 'awaiting_start': return explainWaiting(c, ctx)
    case 'in_progress': {
      const who = ctx.nameOf(c.primary?.assignee ?? '')
      const beat = c.primary?.heartbeat_at
      return {
        short: '',
        headline: `${who} is working on it`,
        detail: `${beat ? `Last update at ${formatTime(beat)}. ` : ''}If an agent goes quiet for 15 minutes its claim lapses and the step opens up again.`,
        options: []
      }
    }
    case 'verifying':
      return {
        short: '',
        headline: 'Ready for your review',
        detail: 'The agent work is finished and passed its check.',
        options: ['Move the card to Done to approve it.', 'Move it back to Build to send it back.']
      }
    default: return null
  }
}

// ---------- Assignee ----------

/**
 * What changing the assignee does on this card right now. The assignee is read only when a move creates a step
 * (boardOps assign: "assignment never starts work"), so on a card with an open step it changes nothing yet.
 */
export function assignHint(c: Pick<ExplainInput, 'task' | 'stage' | 'workState' | 'primary'>, nameOf: (id: string) => string): string {
  if (c.workState === 'done' || c.stage === 'done') return 'Done cards cannot be reassigned.'
  const { primary, stage } = c
  const staged = stage === 'architecture' || stage === 'build'
  if (staged && primary && OPEN_STATES.includes(primary.step_state)) {
    return `Does not change the ${primary.role || 'step'} already open for ${nameOf(primary.assignee)}. To hand it over: cancel that step (Steps list), then move the card out of ${STAGE_LABELS[stage]} and back in.`
  }
  if (staged) return `The new assignee gets the next step. ${reRun('them')}`
  if (stage === 'review') return 'Used if you send the card back to Build.'
  return 'Used when you move the card to Architecture or Build.'
}
