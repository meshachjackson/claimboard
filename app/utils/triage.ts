// The board triage rules pass (plan): fixed checks over plain rows, no model, no I/O.
// It only reads. Applying a finding is the caller's job, through the store's single-card write paths.
import type { GovTask, GovTaskNote, GovTaskStep, RegistryAgent, TriageAction, TriageFinding, TriageRule } from '~/types/board'
import { ARCHIVE_AFTER_DAYS, boardOwner, POOL_PREFIX, TRIAGE_ACTIONS, TRIAGE_CARD_TAG, TRIAGE_REPLY_HOURS, TRIAGE_STALE_DAYS } from '~/types/board'
import { holdsCardOut } from '~/utils/boardOps'
import { formatDate, splitList } from '~/utils/format'

export interface TriageRows {
  tasks: GovTask[]
  steps: GovTaskStep[]
  notes: GovTaskNote[]
  registry: RegistryAgent[]
}

export interface TriageOptions {
  now?: number // ms; the tests pass a fixed clock
  staleDays?: number
  replyHours?: number
}

/** What one rule says about one card. The pass merges the hits for a card into one finding. */
interface Hit { task_id: string, rule: TriageRule, action: TriageAction, reason: string, evidence: string }

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const DUPLICATE_OVERLAP = 0.8 // share of title words two cards must have in common
const DUPLICATE_MIN_WORDS = 3 // shorter titles only match when they are identical

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
const waiting = (x: GovTaskStep) => x.cancelled !== true && !x.acked_at && ['awaiting_start', 'awaiting_pull'].includes(x.step_state)

const words = (title: string) => new Set(title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean))
function similar(a: string, b: string): boolean {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return false
  const shared = [...x].filter(w => y.has(w)).length
  const identical = x.size === y.size && shared === x.size
  return identical || (Math.min(x.size, y.size) >= DUPLICATE_MIN_WORDS && shared / new Set([...x, ...y]).size >= DUPLICATE_OVERLAP)
}

export function triageBoard(rows: TriageRows, options: TriageOptions = {}): TriageFinding[] {
  const now = options.now ?? Date.now()
  const staleDays = options.staleDays ?? TRIAGE_STALE_DAYS
  const replyHours = options.replyHours ?? TRIAGE_REPLY_HOURS
  const days = (iso: string) => Math.floor((now - ms(iso)) / DAY_MS)

  const live = rows.tasks.filter(t => !t.archived_at)
  const open = live.filter(t => t.work_state !== 'done')
  const done = live.filter(t => t.work_state === 'done')
  const stepsOf = (id: string) => rows.steps.filter(x => x.task_id === id)
  const notesOf = (id: string) => rows.notes.filter(n => n.task_id === id)
  const hits: Hit[] = []
  const hit = (t: GovTask, rule: TriageRule, action: TriageAction, reason: string, evidence: string) =>
    hits.push({ task_id: t.task_id, rule, action, reason, evidence })

  for (const t of open) {
    // stale: the newest of the card's own update, its steps (and their heartbeats) and its notes.
    const times = [ms(t.updated_at), ...stepsOf(t.task_id).flatMap(x => [ms(x.updated_at), ms(x.heartbeat_at)]), ...notesOf(t.task_id).map(n => ms(n.created_at))]
    const last = Math.max(...times.filter(n => !Number.isNaN(n)))
    if (Number.isFinite(last) && now - last >= staleDays * DAY_MS) {
      const held = stepsOf(t.task_id).some(holdsCardOut)
      hit(t, 'stale', held ? 'keep' : 'close', `No activity for ${Math.floor((now - last) / DAY_MS)} days`,
        `last activity ${formatDate(new Date(last).toISOString())}${held ? ', has an open step' : ''}`)
    }

    // no_criteria
    if (!t.acceptance_requirements?.trim()) hit(t, 'no_criteria', 'rewrite', 'No acceptance criteria', 'acceptance_requirements is blank')

    // no_reply: The owner's latest comment, with nothing from anyone else after it.
    const talk = notesOf(t.task_id).filter(n => n.kind !== 'system')
    const lastComment = talk.filter(n => n.author_id === boardOwner() && n.kind === 'comment').sort((a, b) => ms(b.created_at) - ms(a.created_at))[0]
    const answered = lastComment && talk.some(n => n.author_id !== boardOwner() && ms(n.created_at) > ms(lastComment.created_at))
    if (lastComment && !answered && now - ms(lastComment.created_at) >= replyHours * HOUR_MS) {
      const h = Math.floor((now - ms(lastComment.created_at)) / HOUR_MS)
      hit(t, 'no_reply', 'keep', `Your comment has had no reply for ${h} hours`, `${lastComment.note_id} on ${formatDate(lastComment.created_at)}`)
    }

    // unreachable_step: a step waiting for an agent that is missing or not active, or a pool with no active member.
    for (const x of stepsOf(t.task_id).filter(waiting)) {
      const pool = x.assignee.startsWith(POOL_PREFIX)
      if (!pool && !x.assignee.startsWith('agt-')) continue // a person or a blank assignee is not an agent
      const active = rows.registry.some(a => a.lifecycle_status === 'active' && (pool ? a.agent_type === x.assignee.slice(POOL_PREFIX.length) : a.agent_id === x.assignee))
      if (!active) {
        hit(t, 'unreachable_step', 'keep', `Step ${x.step_id} waits for ${x.assignee}, which cannot pick it up`,
          `${x.step_id} ${x.step_state}, ${x.assignee} is ${pool ? 'a pool with no active agent' : 'not an active agent'}`)
      }
    }
  }

  // duplicate: a card is a likely copy of an earlier-created open card.
  const byAge = [...open].sort((a, b) => ms(a.created_at) - ms(b.created_at))
  byAge.forEach((t, i) => {
    const first = byAge.slice(0, i).find(o => similar(o.title, t.title))
    if (first) hit(t, 'duplicate', 'fold', `Likely a duplicate of ${first.task_id}`, `title "${t.title}" matches "${first.title}"`)
  })

  for (const t of live) {
    // test_card: tagged test, or a title that starts with "Test".
    const tagged = splitList(t.tags).some(g => g.toLowerCase() === 'test')
    if (tagged || /^\W*test\b/i.test(t.title)) {
      hit(t, 'test_card', t.work_state === 'done' ? 'archive' : 'close', 'Looks like a test card', tagged ? 'tag test' : `title "${t.title}"`)
    }
  }

  for (const t of done) {
    const stuck = stepsOf(t.task_id).filter(holdsCardOut)
    if (stuck.length) {
      hit(t, 'done_open_steps', 'keep', `Done, but ${stuck.length} step${stuck.length === 1 ? ' is' : 's are'} still open`, stuck.map(x => `${x.step_id} ${x.step_state}`).join(', '))
    } else if (days(t.updated_at) > ARCHIVE_AFTER_DAYS) {
      hit(t, 'done_old', 'archive', `Done ${days(t.updated_at)} days ago`, `updated ${formatDate(t.updated_at)}`)
    }
  }

  // One finding per card. The strongest action wins; pinned cards never get close, archive or fold.
  const pinned = new Set(live.filter(t => t.pinned_at).map(t => t.task_id))
  const kept = hits.filter(h => !(pinned.has(h.task_id) && ['close', 'archive', 'fold'].includes(h.action)))
  const rank = (a: TriageAction) => TRIAGE_ACTIONS.indexOf(a)
  const out: TriageFinding[] = []
  for (const id of new Set(kept.map(h => h.task_id))) {
    const mine = kept.filter(h => h.task_id === id).sort((a, b) => rank(a.action) - rank(b.action))
    out.push({
      task_id: id,
      action: mine[0]!.action,
      reason: mine.map(h => h.reason).join('; '),
      evidence: mine.map(h => h.evidence).join('; '),
      rules: mine.map(h => h.rule),
      source: 'rules'
    })
  }
  return out.sort((a, b) => rank(a.action) - rank(b.action) || a.task_id.localeCompare(b.task_id))
}

// The fixed line grammar from the plan: "TSK-... · action · reason · evidence". A later n8n step stores
// these lines on the triage card, so a separator inside a field is replaced and the lines parse back exactly.
const SEP = ' · '
const clean = (v: string) => v.split(SEP).join(', ').replace(/\s*\n\s*/g, ' ')

type Line = Pick<TriageFinding, 'task_id' | 'action' | 'reason' | 'evidence'>

export function formatFindingLine(f: Line): string {
  return [f.task_id, f.action, clean(f.reason), clean(f.evidence)].join(SEP)
}

export function parseFindingLine(line: string): Line | null {
  const [task_id, action, reason, evidence, ...rest] = line.split(SEP)
  const known = (TRIAGE_ACTIONS as readonly string[]).includes(action ?? '')
  if (!task_id || !/^TSK-\d+$/.test(task_id) || !known || reason === undefined || evidence === undefined || rest.length) return null
  return { task_id, action: action as TriageAction, reason, evidence }
}

// The triage card ("File as card"): the plan goes on the board as one card a day, so it can be reviewed like any other.
// Title "Triage <date>" carries the day, the finding lines are its acceptance text, and the tag marks it.

/** "Triage 10/30/2026": one title per day, so a second filing the same day is easy to spot. */
export function triageCardTitle(now = Date.now()): string {
  return `Triage ${formatDate(new Date(now).toISOString())}`
}

/** The create_task fields for a plan. Each finding is one fixed line, so the n8n side can parse the card back. */
export function triageCardFields(findings: TriageFinding[], now = Date.now()) {
  const n = findings.length
  return {
    title: triageCardTitle(now),
    tags: TRIAGE_CARD_TAG,
    original_request: `Board triage plan: ${n} card${n === 1 ? '' : 's'} flagged by the rules pass. Open Triage board, check the lines you approve, and press Apply.`,
    acceptance_requirements: findings.map(formatFindingLine).join('\n')
  }
}

/** The card already filed under `title` and not archived, if any. The title holds the date, so same title means same day. */
export function existingTriageCard(tasks: GovTask[], title: string): GovTask | undefined {
  return tasks.find(t => !t.archived_at && (t.title ?? '').trim() === title)
}
