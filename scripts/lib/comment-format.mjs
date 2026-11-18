// The two standard agent comments: docs/linear-templates/comment-blocked-report.md and comment-handoff.md.
// Both lead with the ruling or the question and stay under 700 characters (MAX), so the next builder, who reads only the last
// 10 comments, sees the point. The longest free-text field is cut to fit; the fixed lines are never cut.
export const MAX = 700

const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim()

/** Lays out `lines` (the last one flexible: `free` is the text of line `at`, cut so the whole stays under MAX). */
function fit(build, free) {
  const text = oneLine(free)
  const full = build(text)
  if (full.length <= MAX) return full
  const over = full.length - MAX
  const keep = Math.max(20, text.length - over - 1)
  return build(`${text.slice(0, keep).trimEnd()}…`)
}

/** `**Blocked (kind):** question`, then Tried, Need and Then. `reason` is the long part. */
export function blockedReport({ kind, reason, tried, need, then }) {
  return fit(r => [
    `**Blocked (${kind}):** ${r || 'no reason given'}`,
    `**Tried:** ${oneLine(tried) || 'nothing recorded'}`,
    `**Need:** ${oneLine(need) || 'a decision'}`,
    `**Then:** ${oneLine(then)}`
  ].join('\n'), reason)
}

/** `**Handoff:** from to to`, then Ruling or result, Evidence, Left to do and Do not. `result` is the long part. */
export function handoff({ from, to, result, evidence, left, doNot }) {
  return fit(r => [
    `**Handoff:** ${from} to ${to}`,
    `**Ruling or result:** ${r || 'none'}`,
    `**Evidence:** ${oneLine(evidence) || 'none'}`,
    `**Left to do:** ${oneLine(left) || 'none'}`,
    `**Do not:** ${oneLine(doNot) || 'nothing'}`
  ].join('\n'), result)
}
