// Checks the `brief` that gw.gov-board-write's read_brief answers. Pure, so node --test can import it.
// The gateway is trusted to enforce the class rule, not to send a well-formed body: unknown keys are dropped, strings are
// capped, lists are bounded, and anything off-shape fails the whole answer (null) rather than passing through.
import type { Brief, BriefGithub, BriefLinear, BriefLoop } from '../../app/types/board.ts'

const SHORT = 64 // ids, buckets, dates
const TEXT = 500 // a loop or focus line
const NOTE = 300
const HEADLINE = 500 // the plain-language opening line
const AGE_LINE = 200
const LINEAR_TEXT = 4000 // the whole brief is held to 4,000 characters
const GITHUB_TEXT = 1200 // the gateway holds the digest text to 1,200 characters; so do we
const MAX_LOOPS = 50
const MAX_NOTES = 10
const MAX_BUCKETS = 10

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, cap: number): string | null => (typeof v === 'string' ? v.slice(0, cap) : null)
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)
const list = (v: unknown, max: number): unknown[] | null => (Array.isArray(v) ? v.slice(0, max) : null)

function cleanLoop(v: unknown): BriefLoop | null {
  if (!isObj(v)) return null
  const loop_id = text(v.loop_id, SHORT)
  const bucket = text(v.bucket, SHORT)
  const loop = text(v.loop, TEXT)
  const owner = text(v.owner, SHORT)
  const opened = text(v.opened, SHORT)
  if (loop_id === null || bucket === null || loop === null || owner === null || opened === null) return null
  const rank = v.rank === null ? null : count(v.rank)
  if (v.rank !== null && rank === null) return null
  return { loop_id, bucket, loop, owner, rank, watch: v.watch === true, stale: v.stale === true, opened }
}

function cleanLoops(v: unknown): BriefLoop[] | null {
  const items = list(v, MAX_LOOPS)
  if (!items) return null
  const loops = items.map(cleanLoop)
  return loops.every(l => l !== null) ? loops as BriefLoop[] : null
}

function cleanStrings(v: unknown, max: number, cap: number): string[] | null {
  const items = list(v, max)
  if (!items) return null
  const out = items.map(x => text(x, cap))
  return out.every(x => x !== null) ? out as string[] : null
}

const flag = (v: unknown): boolean | null | undefined => (v === undefined || v === null || typeof v === 'boolean' ? v : undefined)

/** The github block (step 4). Only the keys the gateway sends are kept; a withheld block has no never_synced, stale, source_ok, built_at or row_count. */
function cleanGithub(v: unknown): BriefGithub | null {
  if (!isObj(v) || typeof v.withheld !== 'boolean') return null
  const age_line = text(v.age_line, AGE_LINE)
  const body = text(v.text, GITHUB_TEXT)
  const notes = cleanStrings(v.notes, MAX_NOTES, NOTE)
  if (age_line === null || body === null || !notes) return null
  const out: BriefGithub = { withheld: v.withheld, age_line, notes, text: body }
  if (v.never_synced !== undefined) {
    if (typeof v.never_synced !== 'boolean') return null
    out.never_synced = v.never_synced
  }
  for (const k of ['stale', 'source_ok'] as const) {
    if (v[k] === undefined) continue
    const f = flag(v[k])
    if (f === undefined) return null
    out[k] = f
  }
  if (v.built_at !== undefined) {
    const built_at = text(v.built_at, SHORT)
    if (built_at === null) return null
    out.built_at = built_at
  }
  if (v.row_count !== undefined) {
    const row_count = count(v.row_count)
    if (row_count === null) return null
    out.row_count = row_count
  }
  return out
}

/** The linear block (step 4): text, stale, needs_input. */
function cleanLinear(v: unknown): BriefLinear | null {
  if (!isObj(v)) return null
  const body = text(v.text, LINEAR_TEXT)
  if (body === null || typeof v.stale !== 'boolean' || typeof v.needs_input !== 'boolean') return null
  return { text: body, stale: v.stale, needs_input: v.needs_input }
}

/** The brief with only the contract's keys, or null when it is missing or off-shape. */
export function cleanBrief(raw: unknown): Brief | null {
  if (!isObj(raw)) return null
  const as_of = text(raw.as_of, SHORT)
  const scope = raw.scope
  if (as_of === null || !isObj(scope) || (scope.kind !== 'all' && scope.kind !== 'class')) return null
  const buckets = cleanStrings(scope.buckets, MAX_BUCKETS, SHORT)
  const classes = scope.classes === undefined ? undefined : cleanStrings(scope.classes, MAX_BUCKETS, SHORT)
  if (!buckets || classes === null) return null

  let focus: Brief['focus'] = null
  if (raw.focus !== null) {
    const f = raw.focus
    if (!isObj(f)) return null
    const now_id = text(f.now_id, SHORT)
    const line = text(f.focus, TEXT)
    const session_date = text(f.session_date, SHORT)
    if (now_id === null || line === null || session_date === null) return null
    focus = { now_id, focus: line, session_date, stale: f.stale === true }
  }

  const next_up = cleanLoops(raw.next_up)
  const watch = cleanLoops(raw.watch)
  const notes = cleanStrings(raw.notes, MAX_NOTES, NOTE)
  const c = raw.counts
  if (!next_up || !watch || !notes || !isObj(c)) return null
  const open = count(c.open)
  const stale_open = count(c.stale_open)
  if (open === null || stale_open === null || !isObj(c.by_bucket)) return null
  const by_bucket: Record<string, number> = {}
  for (const [bucket, n] of Object.entries(c.by_bucket).slice(0, MAX_BUCKETS)) {
    const k = count(n)
    if (k === null) return null
    by_bucket[bucket.slice(0, SHORT)] = k
  }
  // Optional: a gateway that predates or 0043 sends none. One that sends a malformed block fails the whole answer, like every other part.
  const github = raw.github === undefined ? undefined : cleanGithub(raw.github)
  const linear = raw.linear === undefined ? undefined : cleanLinear(raw.linear)
  if (github === null || linear === null) return null
  // Optional and cosmetic: a gateway that predates sends none, and a non-string is dropped rather than failing the brief.
  const headline = typeof raw.headline === 'string' && raw.headline.trim() ? raw.headline.slice(0, HEADLINE) : undefined
  return {
    ...(headline ? { headline } : {}),
    as_of,
    scope: { kind: scope.kind, ...(classes ? { classes } : {}), buckets },
    focus, next_up, watch, counts: { open, stale_open, by_bucket }, ...(github ? { github } : {}), ...(linear ? { linear } : {}), notes
  }
}
