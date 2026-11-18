// Heartbeat pacing on the board server. gw.gov-board-write refuses a heartbeat whose activity is unchanged when the
// step's last heartbeat is under 5 minutes old (boardOps.ts mirrors that rule), but the refusal still costs an n8n run.
// The board refuses that case here first, from the read cache, so it costs nothing.
// It refuses only what the gateway would refuse: the cached step must be this agent's, leased, with the same activity and
// a heartbeat under 5 minutes old. Anything else (no cached step, another assignee, an expired lease) goes to the gateway.
import type { GovTaskStep } from '~~/app/types/board'

export const QUIET_HEARTBEAT_MS = 300_000 // the same 5 minutes as boardOps.ts and the gateway
export const QUIET_REASON = 'activity unchanged and the last heartbeat is under 5 minutes old'

type StepFields = Pick<GovTaskStep, 'step_id' | 'assignee' | 'activity' | 'heartbeat_at' | 'lease_expires_at'>

const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : Number.NaN)

/** The gateway's refusal text when the cached step shows this heartbeat would be refused, else ''. */
export function quietHeartbeat(steps: StepFields[], args: Record<string, unknown>, agentId: string, nowMs = Date.now()): string {
  if (!agentId) return ''
  const step = steps.find(s => s.step_id === String(args.step_id ?? ''))
  if (!step || step.assignee !== agentId) return ''
  if (!(time(step.lease_expires_at) > nowMs)) return ''
  if (String(args.activity ?? '') !== String(step.activity ?? '')) return ''
  const last = time(step.heartbeat_at)
  return nowMs - last < QUIET_HEARTBEAT_MS ? QUIET_REASON : ''
}
