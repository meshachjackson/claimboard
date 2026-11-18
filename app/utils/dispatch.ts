// Rules for the one dispatcher (scripts/board-run.mjs) and for the finishing call every agent turn must end with
// Pure functions with no Nitro auto-imports, so the runner, the server and the tests share them.
//
// A turn ends in exactly one of three ways: complete, block(kind) or review. A turn that ends without one gets MAX_NUDGES
// nudges, then the step blocks. The block kind rides in stop_reason as "[kind] reason" until tables.json 1.10 adds a column.

import { jsonObject } from './jsonConfig.ts'
import { MAX_TRANSIENT } from '../../scripts/lib/finish-rules.mjs'
import type { BlockKind, End } from '../../scripts/lib/finish-rules.mjs'

// The finishing-line code lives in scripts/lib/finish-rules.mjs, so the Linear runner can use it without board code. Re-exported here.
export { MAX_NUDGES, MAX_TRANSIENT, BLOCK_KINDS, FINISH_RULES, parseEnd, nudgeText, isTransient } from '../../scripts/lib/finish-rules.mjs'
export type { BlockKind, End }
export type Target = 'laptop' | 'cloud' | 'actions'

/**
 * Where a step runs, from its assignee. The laptop target is board-run itself. Cloud and Actions targets are woken by board-run
 * and then claim under their own identity (one token hash per agent, docs/cloud-builder.md). '' is an assignee nobody dispatches for.
 */
export const AGENT_TARGETS: Record<string, Target> = {}

/** Replace the map. Values are laptop, cloud or actions; anything else throws so a typo in the env fails loudly. */
export function setAgentTargets(map: Record<string, unknown>): void {
  for (const k of Object.keys(AGENT_TARGETS)) delete AGENT_TARGETS[k]
  for (const [id, t] of Object.entries(map)) {
    if (t !== 'laptop' && t !== 'cloud' && t !== 'actions') throw new Error(`AGENT_TARGETS ${id} must be laptop, cloud or actions`)
    AGENT_TARGETS[id] = t
  }
}
// The dispatcher script (scripts/board-run.mjs) runs outside Nuxt, so no plugin sets the map there: it reads the same env var.
// NUXT_PUBLIC_AGENT_TARGETS is JSON, e.g. {"agt-my-laptop":"laptop","agt-my-cloud":"cloud"}.
const nodeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process // no Node types in the app build
const fromEnv = nodeProcess?.env?.NUXT_PUBLIC_AGENT_TARGETS
if (fromEnv) setAgentTargets(jsonObject('NUXT_PUBLIC_AGENT_TARGETS', fromEnv) ?? {})

export function targetOf(step: { assignee?: string }): Target | '' {
  const who = String(step.assignee ?? '')
  if (who.startsWith('pool:')) return 'laptop' // pool steps are taken by the laptop agent
  return AGENT_TARGETS[who] ?? ''
}

/** What the dispatcher does for each block kind. Only transient may write `failed`, because the board retries failed steps once on its own. */
export interface BlockRoute {
  step_state: 'needs_input' | 'failed'
  /** The dispatcher runs the same step again, for free, after a pause. */
  retryFree: boolean
  /** The owner should see it under Needs you. A dependency waits quietly. */
  attention: boolean
  /** Another agent is needed: the note says so. */
  reroute: boolean
}

/** `tries` is how many free retries a transient block has used so far. */
export function routeBlock(kind: BlockKind, tries = 0): BlockRoute {
  switch (kind) {
    case 'needs_input': return { step_state: 'needs_input', retryFree: false, attention: true, reroute: false }
    case 'dependency': return { step_state: 'needs_input', retryFree: false, attention: false, reroute: false }
    case 'transient': return tries < MAX_TRANSIENT
      ? { step_state: 'failed', retryFree: true, attention: false, reroute: false }
      : { step_state: 'failed', retryFree: false, attention: true, reroute: false }
    case 'capability': return { step_state: 'needs_input', retryFree: false, attention: true, reroute: true }
  }
}

/** stop_reason with its kind: "[capability] No push access." */
export function encodeStop(kind: BlockKind, reason: string): string {
  return `[${kind}] ${reason}`.trim()
}

export function parseStop(text: string): { kind: BlockKind | '', reason: string } {
  const m = /^\s*\[(needs_input|dependency|transient|capability)\]\s*([\s\S]*)$/i.exec(String(text ?? ''))
  return m ? { kind: m[1]!.toLowerCase() as BlockKind, reason: m[2]!.trim() } : { kind: '', reason: String(text ?? '').trim() }
}

/**
 * A shape check on a finishing write (not a permission check): a served ack needs a verdict, and a needs_input or failed ack
 * needs a reason. A served chat step (the owner's message, answered with text) needs no verdict: pass its `role`. Returns the refusal text, or '' when the write is fine. A blank verdict counts as missing.
 */
export function finishRefusal(op: string, args: Record<string, unknown>, role = 'builder'): string {
  const blank = (v: unknown) => String(v ?? '').trim() === ''
  if (op === 'complete_step') {
    const state = String(args.step_state ?? '')
    if (state === 'served' && blank(args.verdict) && (role === 'builder' || role === 'architect')) return 'A served step needs a verdict (PASS, or FAIL with the reason). Send verdict with complete_step.'
    if ((state === 'needs_input' || state === 'failed') && blank(args.stop_reason) && blank(args.output_summary)) {
      return `A ${state} step needs a reason. Send stop_reason, starting with its kind in brackets, such as "[needs_input] ...".`
    }
  }
  if (op === 'update_step' && blank(args.stop_reason)) return 'A blocked step needs a stop_reason, starting with its kind in brackets: [needs_input], [dependency], [transient] or [capability].'
  return ''
}

/**
 * Whether the dispatcher should wake the cloud target: it has open steps, a wake address is set, and the last wake was
 * long enough ago. Each wake starts a cloud session that spends tokens, so the cooldown is the rate limit.
 */
export function cloudWakeDue(o: { open: number, url: string, lastWakeMs: number, nowMs: number, cooldownMs: number }): { wake: boolean, why: string } {
  if (o.open < 1) return { wake: false, why: 'no open cloud steps' }
  if (!o.url) return { wake: false, why: 'BOARD_RUN_CLOUD_WAKE_URL is not set' }
  if (o.nowMs - o.lastWakeMs < o.cooldownMs) return { wake: false, why: 'woke the cloud target recently' }
  return { wake: true, why: `${o.open} open cloud step(s)` }
}

const OPEN_STATES = ['awaiting_pull', 'awaiting_start']

/** The dispatcher's poll sleeps this long while a read shows no open steps. Work wakes it by the nudge stamp within this time. */
export const DISPATCH_POLL_ACTIVE_MS = 5000
export const DISPATCH_POLL_IDLE_MS = 15000

/** How long the dispatcher sleeps before its next /api/agent/dispatch read: short while steps are open, longer when none are (fewer database reads). */
export function dispatchPollMs(d: { ok?: boolean, targets?: Partial<Record<Target, number>> } | null | undefined): number {
  if (!d?.ok || !d.targets) return DISPATCH_POLL_ACTIVE_MS // an unreadable answer keeps the fast poll, so a hiccup never delays work
  const open = (d.targets.laptop ?? 0) + (d.targets.cloud ?? 0) + (d.targets.actions ?? 0)
  return open > 0 ? DISPATCH_POLL_ACTIVE_MS : DISPATCH_POLL_IDLE_MS
}

/** Open builder and architect steps per target: what is waiting to be picked up. Cancelled, acked and unknown-assignee steps are left out. */
export function openByTarget(steps: { assignee?: string, role?: string, step_state?: string, cancelled?: boolean, acked_at?: string | null }[]): Record<Target, number> {
  const out: Record<Target, number> = { laptop: 0, cloud: 0, actions: 0 }
  for (const s of steps) {
    const t = targetOf(s)
    if (t && (s.role === 'builder' || s.role === 'architect') && s.cancelled !== true && !s.acked_at && OPEN_STATES.includes(String(s.step_state))) out[t]++
  }
  return out
}
