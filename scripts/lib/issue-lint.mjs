// Checks a Linear issue before the runner starts it.
// An error means "do not start": the runner comments once and clears the delegate. A warning means "start, but say so".
// It never edits the issue. Node built-ins only.
import { createHash } from 'node:crypto'
import { doneWhen } from '../linear-run.mjs'

/** A Done when line is checkable when it holds a backticked command, a URL, or something that looks like a file path. */
const checkable = line => /`[^`]+`|https?:\/\/\S+|[\w.-]+\/[\w.-]+|\b[\w-]+\.(?:mjs|js|ts|vue|json|md|py|ya?ml|sh|css)\b/i.test(line)

/** The text after `**Label:**` in the issue header, whatever the bullet character. '' when the line is absent. */
const headerLine = (description, label) => {
  const m = new RegExp(`^\\s*(?:[-*+]\\s+)?\\*\\*${label}:\\*\\*\\s*(.+)$`, 'im').exec(String(description ?? ''))
  return m ? m[1].trim() : ''
}
const labelValue = (issue, prefix) => (issue.labels ?? []).filter(l => l.toLowerCase().startsWith(prefix)).map(l => l.slice(prefix.length).trim())

/** The hidden marker that makes a lint comment post once: it names the problems, so new problems get a new comment. */
export function lintMarker(kind, messages) {
  return `<!-- issue-lint:${kind}:${createHash('sha1').update(messages.join('\n')).digest('hex').slice(0, 12)} -->`
}

/**
 * Lints one issue. `authority` is the parsed the authority file. `deps.issueState(identifier)` resolves to the state type
 * of another issue ('completed', 'started', ...) or null when it does not exist; it is only used for `Depends on:` lines.
 * Returns { errors, warnings, holds }. A hold is "not yet": the issue depends on one that is not Done, so the runner
 * comments once and leaves the delegate set, and a later poll starts it after the dependency is Done.
 */
export async function lintIssue(issue, authority, deps = {}) {
  const errors = [], warnings = [], holds = []
  const text = String(issue.description ?? '')
  const checks = doneWhen(text)

  if (checks.length === 0) errors.push('There is no "Done when" list, so nothing could be checked. Add a `## Done when` heading with one bullet per check.')
  // Only a bare placeholder counts; an issue may quote one inside a code fence or backticks.
  const outsideCode = text.replace(/^[ \t]*(```|~~~)[\s\S]*?(?:^[ \t]*\1[^\n]*$|(?![\s\S]))/gm, '').replace(/`[^`\n]*`/g, '')
  if (outsideCode.includes('{{')) errors.push('The description still has a `{{` template placeholder. Fill it in or remove it.')
  for (const c of checks) if (!checkable(c)) warnings.push(`This Done when line names no command, file or URL: "${c.slice(0, 80)}"`)

  // A decision is Meshach's to make, so an agent never works one.
  if ((issue.labels ?? []).some(l => l.toLowerCase() === 'decision')) errors.push('This issue has the `Decision` label, and a decision is Meshach\'s. Take the delegate off it.')

  // Dependencies: every issue named on a `Depends on` line must be Done.
  const depends = new Set()
  for (const m of text.matchAll(/depends on:?[^\n]*/gi)) for (const id of m[0].match(/\b[A-Z][A-Z0-9]*-\d+\b/g) ?? []) if (id !== issue.identifier) depends.add(id)
  for (const id of depends) {
    let type
    try { type = await deps.issueState?.(id) } catch { warnings.push(`I could not look up ${id}, which this issue depends on.`); continue }
    if (type === null) errors.push(`It depends on ${id}, which does not exist.`)
    else if (type !== undefined && type !== 'completed') holds.push(`It depends on ${id}, which is not Done yet. The runner starts it on the first poll after ${id} is Done.`)
  }

  // The labels win over the header; two sources of truth drift.
  const [repoLabel] = labelValue(issue, 'repo:'), [tierLabel] = labelValue(issue, 'tier:'), [agentLabel] = labelValue(issue, 'agent:')
  const [headRepo, headTier] = headerLine(text, 'Repo and tier').split('/').map(s => s.trim())
  if (headRepo && repoLabel && headRepo !== repoLabel) errors.push(`The header says repo "${headRepo}" but the label is \`repo:${repoLabel}\`. The label wins; fix the header.`)
  if (headTier && tierLabel && headTier !== tierLabel) errors.push(`The header says tier "${headTier}" but the label is \`tier:${tierLabel}\`. The label wins; fix the header.`)
  const headAgent = /\bbuilder\s+([a-z0-9-]+)/i.exec(headerLine(text, 'Owner agent'))?.[1]?.toLowerCase()
  if (headAgent && headAgent !== (agentLabel?.toLowerCase() ?? 'claude')) errors.push(`The header names builder "${headAgent}" but ${agentLabel ? `the label is \`agent:${agentLabel}\`` : 'there is no `agent:` label'}. The label wins; fix the header.`)

  // The authority file is the truth for the tier; the label is information.
  const fileTier = repoLabel ? (authority?.repos?.[repoLabel] ?? authority?.default_tier ?? 'live') : ''
  if (tierLabel && fileTier && tierLabel !== fileTier) warnings.push(`The label says \`tier:${tierLabel}\` but the authority file puts ${repoLabel} at ${fileTier}. The file is used.`)

  return { errors, warnings, holds }
}

/** The comment the runner posts: the problems, then the marker. */
export function lintComment(kind, messages, again) {
  const head = kind === 'error' ? '**Not started.** This issue is not ready for the runner:' : kind === 'hold' ? '**Waiting.** This issue is held until what it depends on is Done:' : '**Started, with a warning:**'
  return [head, ...messages.map(m => `* ${m}`), ...(again ? ['', again] : []), '', lintMarker(kind, messages)].join('\n')
}
