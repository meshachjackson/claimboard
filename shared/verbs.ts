// The verb set: one small vocabulary that people and agents share, mapped onto today's wire ops.
// The gateway only knows the wire ops, so verbs exist at the Nuxt edge: `resolveOp` turns a verb into the op that runs, and
// any name that is already a wire op passes through unchanged. That pass-through is the alias guarantee: no running agent breaks.
// Pure, no Nuxt imports, tested with `node --test` (test/verb-set.test.ts).

export type Caller = 'owner' | 'agent'

/** The ten shared verbs, in the order Hermes uses them, plus split ('s fan-out: Hermes decomposes a card the same way). */
export const VERBS = ['create', 'assign', 'claim', 'heartbeat', 'comment', 'complete', 'block', 'request_review', 'request_changes', 'archive', 'split'] as const
/** Owner-only verbs. Agents are refused here, and the wire ops behind them stay gated on the gateway and in the access rules. */
export const GATED_VERBS = ['approve', 'publish', 'switch'] as const
export type Verb = typeof VERBS[number]
export type GatedVerb = typeof GATED_VERBS[number]

/** One row of the table: the wire op(s) a verb runs for each caller. An empty list means that caller may not use the verb. */
interface Row { owner: readonly string[], agent: readonly string[], note: string }

/** The single table. Each verb maps to today's op(s); the note says how the op is picked when there are several. */
export const VERB_TABLE: Record<Verb | GatedVerb, Row> = {
  create: { owner: ['create_task'], agent: ['create_task'], note: 'File a card.' },
  assign: { owner: ['assign'], agent: [], note: 'Give a card or step to an agent.' },
  claim: { owner: [], agent: ['claim_step'], note: 'Take a step for 900 seconds.' },
  heartbeat: { owner: [], agent: ['heartbeat'], note: 'Say what you are doing and extend the lease.' },
  comment: { owner: ['add_note', 'reply', 'message_agent'], agent: ['add_note', 'message_agent'], note: 'With step_id: add_note (owner reply:true: reply to a needs_input step). Without step_id: message_agent.' },
  complete: { owner: ['done_no_steps'], agent: ['complete_step'], note: 'Agent: ack a step served. Owner: finish a card that has no steps.' },
  block: { owner: [], agent: ['complete_step', 'update_step'], note: 'complete_step needs_input (default) or failed. hold:true keeps the step yours: update_step.' },
  request_review: { owner: [], agent: ['complete_step'], note: 'complete_step served; summary becomes output_summary, verdict defaults to PASS.' },
  request_changes: { owner: ['send_back'], agent: [], note: 'Send a Review card back to Build with the owner\'s line.' },
  archive: { owner: ['archive_task'], agent: [], note: 'Archive a Done card.' },
  split: { owner: ['split_task'], agent: ['split_task'], note: 'Split a card into 1 to 10 Backlog children that wait on it. Agent: only while holding the card\'s open architect step.' },
  approve: { owner: ['approve_plan', 'approve_task'], agent: [], note: 'Owner only. of:"task" runs approve_task, otherwise approve_plan.' },
  publish: { owner: ['publish_task'], agent: [], note: 'Owner only. Push the branch and open the draft pull request.' },
  switch: { owner: ['set_switch'], agent: [], note: 'Owner only. Turn an agent on or off.' }
}

/** Wire ops that no verb covers. They stay callable by name (card editing and housekeeping), and the handoff lists them. */
export const KEPT_OWNER_OPS = ['move_task', 'update_task', 'nudge', 'cancel_step', 'pin_task', 'unpin_task', 'start_task', 'reopen_task'] as const

export type Resolved = { ok: true, op: string, args: Record<string, unknown> } | { ok: false, reason: string }

const isVerb = (name: string): name is Verb | GatedVerb => Object.prototype.hasOwnProperty.call(VERB_TABLE, name)
const given = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== ''
const truthy = (v: unknown): boolean => v === true || String(v).toLowerCase() === 'true'

/**
 * A verb or a wire op in, the wire op to run out. A name that is not a verb is returned as it is, so legacy callers are untouched
 * and the existing op checks (unknown op, access rules, gateway) still decide. A verb is refused when the caller has no op behind it.
 */
export function resolveOp(name: string, args: Record<string, unknown>, caller: Caller): Resolved {
  if (!isVerb(name)) return { ok: true, op: name, args }
  const ops = VERB_TABLE[name][caller]
  if (ops.length === 0) {
    const gated = (GATED_VERBS as readonly string[]).includes(name)
    return { ok: false, reason: gated ? `${name} is for the board owner only` : `${name} is not open to ${caller === 'agent' ? 'agents' : 'the owner'}` }
  }
  const out = { ...args }
  if (name === 'comment') {
    if (caller === 'owner' && truthy(args.reply)) { delete out.reply; return { ok: true, op: 'reply', args: out } }
    return { ok: true, op: given(args.step_id) ? 'add_note' : 'message_agent', args: out }
  }
  if (name === 'approve') {
    const task = args.of === 'task'
    delete out.of
    return { ok: true, op: task ? 'approve_task' : 'approve_plan', args: out }
  }
  if (name === 'block') {
    if (!given(out.stop_reason) && given(out.reason)) out.stop_reason = out.reason
    delete out.reason
    if (truthy(out.hold)) {
      delete out.hold
      return { ok: true, op: 'update_step', args: { ...out, step_state: out.step_state ?? 'needs_input' } }
    }
    delete out.hold
    return { ok: true, op: 'complete_step', args: { ...out, step_state: out.step_state ?? 'needs_input' } }
  }
  if (name === 'request_review') {
    if (!given(out.output_summary) && given(out.summary)) out.output_summary = out.summary
    delete out.summary
    return { ok: true, op: 'complete_step', args: { ...out, step_state: 'served', verdict: given(out.verdict) ? out.verdict : 'PASS' } }
  }
  if (name === 'complete' && caller === 'agent') return { ok: true, op: 'complete_step', args: { ...out, step_state: out.step_state ?? 'served' } }
  return { ok: true, op: ops[0]!, args: out }
}
