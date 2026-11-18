// Board activity: what changed on the board in a time window ("what happened while I slept"). Pure, one pass over each
// table, so node --test can import it. It reads timestamps the rows already carry; it is a log of the last change per row
// plus every note, not a full history (a card edited twice shows once, at its latest update).
import type { GovTask, GovTaskNote, GovTaskStep } from '../types/board.ts'

export interface ActivityRows { tasks: GovTask[], steps: GovTaskStep[], notes: GovTaskNote[] }

export interface ActivityEvent {
  at: string
  kind: 'card' | 'step' | 'note'
  task_id: string
  /** Who did it: the row's updated_by, the step's lease owner, or the note's author. */
  who: string
  /** One plain line, e.g. "Card created", "Step builder ended: served (PASS)", "question: Which branch?" */
  what: string
}

export interface Activity {
  since: string
  until: string
  /** `given` when the caller named the start; `last_owner_action` when it defaulted to the owner's last action. */
  since_source: 'given' | 'last_owner_action' | 'none'
  events: ActivityEvent[]
  /** True count before the cap. */
  total: number
  /** Counts by kind, for a one-line summary. */
  counts: { cards: number, steps: number, notes: number }
}

const CAP = 100
const SNIPPET = 140
const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN)
const snip = (s: string) => (s.length > SNIPPET ? `${s.slice(0, SNIPPET - 1)}…` : s)

/** The latest moment `owner` acted: a card they last updated, or a note they wrote. NaN when there is none. */
export function lastActionBy(rows: ActivityRows, owner: string): number {
  const times = [
    ...rows.tasks.filter(t => t.updated_by === owner).map(t => ms(t.updated_at)),
    ...rows.notes.filter(n => n.author_id === owner).map(n => ms(n.created_at))
  ].filter(Number.isFinite)
  return times.length ? Math.max(...times) : NaN
}

/** What a step's latest change was, in a few words. */
function stepLine(s: GovTaskStep): string {
  const role = s.role || 'step'
  if (s.step_state === 'served') return `Step ${role} served${s.verdict ? ` (${s.verdict})` : ''}${s.output_summary ? `: ${snip(s.output_summary)}` : ''}`
  if (s.step_state === 'failed') return `Step ${role} failed${s.stop_reason ? `: ${snip(s.stop_reason)}` : ''}`
  if (s.cancelled) return `Step ${role} cancelled`
  return `Step ${role} ${s.step_state.replace('_', ' ')}${s.activity ? `: ${snip(s.activity)}` : ''}`
}

/**
 * Events between `since` and `until`, newest first. `since` may be blank: it then defaults to the owner's last action,
 * and to nothing (the whole board) when the owner has no recorded action. Throws on a date it cannot read.
 */
export function buildActivity(rows: ActivityRows, opts: { since?: string, until?: string, owner: string, now?: number }): Activity {
  const until = opts.until ? ms(opts.until) : (opts.now ?? Date.now())
  if (!Number.isFinite(until)) throw new Error('until is not a date')
  let sinceMs = opts.since ? ms(opts.since) : NaN
  let source: Activity['since_source'] = 'given'
  if (opts.since && !Number.isFinite(sinceMs)) throw new Error('since is not a date')
  if (!opts.since) {
    sinceMs = lastActionBy(rows, opts.owner)
    source = Number.isFinite(sinceMs) ? 'last_owner_action' : 'none'
  }
  const from = Number.isFinite(sinceMs) ? sinceMs : 0
  const inWindow = (iso: string | null | undefined) => { const t = ms(iso); return Number.isFinite(t) && t > from && t <= until }

  const events: ActivityEvent[] = []
  for (const t of rows.tasks) {
    if (!inWindow(t.updated_at)) continue
    const created = inWindow(t.created_at) && t.created_at === t.updated_at
    events.push({ at: t.updated_at, kind: 'card', task_id: t.task_id, who: t.updated_by,
      what: created ? `Card created: ${snip(t.title)}` : `Card now ${t.work_state}${t.stage ? ` in ${t.stage}` : ''}: ${snip(t.title)}` })
  }
  for (const s of rows.steps) {
    if (inWindow(s.updated_at)) events.push({ at: s.updated_at, kind: 'step', task_id: s.task_id, who: s.lease_owner || s.assignee, what: stepLine(s) })
  }
  for (const n of rows.notes) {
    if (inWindow(n.created_at)) events.push({ at: n.created_at, kind: 'note', task_id: n.task_id, who: n.author_id, what: `${n.kind}: ${snip(n.body)}` })
  }
  events.sort((a, b) => ms(b.at) - ms(a.at))

  return {
    since: from ? new Date(from).toISOString() : '',
    until: new Date(until).toISOString(),
    since_source: source,
    events: events.slice(0, CAP),
    total: events.length,
    counts: {
      cards: events.filter(e => e.kind === 'card').length,
      steps: events.filter(e => e.kind === 'step').length,
      notes: events.filter(e => e.kind === 'note').length
    }
  }
}
