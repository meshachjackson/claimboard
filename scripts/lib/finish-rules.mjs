// The finishing-line rules every agent turn follows: end with COMPLETE:, REVIEW: or BLOCKED <kind>:. Plain JS with no imports, so the Linear
// runner (scripts/linear-run.mjs), the board dispatcher and app/utils/dispatch.ts (which re-exports these) share one copy.
// A turn that ends without a finishing line gets MAX_NUDGES nudges, then the step blocks.

export const MAX_NUDGES = 2
/** Free retries for a transient block (rate limit, network). They do not count as attempts; the same step runs again. */
export const MAX_TRANSIENT = 2

export const BLOCK_KINDS = ['needs_input', 'dependency', 'transient', 'capability']

const BLOCK_RE = new RegExp(`^\\s*BLOCKED\\s+(${BLOCK_KINDS.join('|')})\\s*:\\s*(.*)$`, 'i')
const DONE_RE = /^\s*(COMPLETE|REVIEW)\s*:\s*(.*)$/i

/**
 * The last finishing line of a reply: "COMPLETE: <summary>", "REVIEW: <what to look at>" or "BLOCKED <kind>: <reason>".
 * The old "CANNOT PLAN: ..." line counts as a needs_input block. Anything else is `none`.
 */
export function parseEnd(reply) {
  const lines = String(reply ?? '').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const body = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').trim()
    const b = BLOCK_RE.exec(lines[i])
    if (b) return { kind: 'block', block: b[1].toLowerCase(), reason: b[2].trim(), body }
    const d = DONE_RE.exec(lines[i])
    if (d) return { kind: d[1].toLowerCase(), summary: d[2].trim(), body }
    const c = /^\s*CANNOT PLAN\s*:\s*(.*)$/i.exec(lines[i])
    if (c) return { kind: 'block', block: 'needs_input', reason: c[1].trim(), body }
  }
  return { kind: 'none', body: String(reply ?? '').trim() }
}

/** The finishing-line rules, appended to every prompt the dispatcher sends. */
export const FINISH_RULES = [
  'You must end every turn with exactly one finishing line, as the last line of your reply:',
  '- `COMPLETE: <one-line summary of what you did and where the result is>`',
  '- `REVIEW: <what Meshach should look at>` when you are done but want a person to check a judgment call',
  '- `BLOCKED <kind>: <reason in plain words>` when you cannot go on. kind is one of:',
  '  needs_input (a question only Meshach can answer), dependency (another card or step must finish first),',
  '  transient (a rate limit or network error that a retry may fix), capability (this agent lacks a tool, key or access; a different agent is needed).',
  'A reply with no finishing line is sent back to you; after two reminders the step is blocked.'
]

/** What a nudge says. `n` is 1 or 2. */
export function nudgeText(n) {
  return [
    `Reminder ${n} of ${MAX_NUDGES}: your last reply had no finishing line.`,
    'Reply now with a one-line status and end with exactly one of: `COMPLETE: <summary>`, `REVIEW: <what to look at>`, or `BLOCKED <needs_input|dependency|transient|capability>: <reason>`.',
    'Do not redo finished work.'
  ].join('\n')
}

/** True when an error looks like a rate limit, overload or network drop that a retry can fix. */
export function isTransient(text) {
  return /\b(429|503|529|rate.?limit|overloaded|too many requests|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network error|fetch failed)\b/i.test(String(text ?? ''))
}
