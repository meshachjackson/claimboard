// The builder flow both Linear entry points share: scripts/linear-run.mjs (the laptop runner, one process works the queue) and
// scripts/linear-job.mjs (the cloud worker, one GitHub Actions job per role). Moved here from linear-run.mjs unchanged, except
// that publish is split in two halves (pushAndOpen and mergeWhenMet), because in the cloud the builder pushes and the verifier
// merges, in separate jobs. Node built-ins only. Every outside call goes through `deps` so tests can fake it.
import { readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { deployNote, may, mergeRequires } from './authority.mjs'
import { blockedReport } from './comment-format.mjs'
import { MAX_NUDGES, MAX_TRANSIENT, parseEnd, nudgeText, isTransient } from './finish-rules.mjs'

export const clip = (text, n) => String(text ?? '').slice(0, n)
export const AGAIN = 'Delegate the issue to me again when that is done.'
/** A number from `limits` in the authority file. 0 is a real setting (it stops spending); only a missing or non-number value gets the fallback. */
export const limit = (authority, name, fallback) => { const v = authority.limits?.[name]; return typeof v === 'number' && Number.isFinite(v) ? v : fallback }

/**
 * The repo for an issue, from its one `repo:<folder>` label. No label, two labels, an unsafe name or no git repo at
 * <codeDir>/<folder> all return a question for a person. The runner never guesses a repo.
 */
export function resolveRepo(issue, { codeDir, isRepo }) {
  const names = repoNames(issue)
  if (names.length === 0) return { ok: false, ask: `${issue.identifier} has no \`repo:<folder>\` label, so I do not know which repo to work in. Which repo is it? Add the label.` }
  if (names.length > 1) return { ok: false, ask: `${issue.identifier} has ${names.length} repo labels (${names.join(', ')}). Which one is it? Keep one label.` }
  const name = names[0]
  // A folder name only: no path parts, and no folder that starts with "_" or "." (~/Code/_archived is out of scope).
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..')) return { ok: false, ask: `The label \`repo:${name}\` is not a plain folder name. Which repo is it? Fix the label.` }
  const repo = join(codeDir, name)
  if (!isRepo(repo)) return { ok: false, ask: `There is no git repo named ${name} in the code folder. Which repo is it? Fix the label.` }
  return { ok: true, name, repo }
}

/** The folder names from the issue's `repo:<folder>` labels. */
const repoNames = issue => (issue.labels ?? []).filter(l => /^repo:/i.test(l)).map(l => l.slice(5).trim())

/** The folder name from the issue's one `repo:<folder>` label, or '' when there is not exactly one. */
export function repoLabel(issue) {
  const names = repoNames(issue)
  return names.length === 1 ? names[0] : ''
}

/** The branch every attempt on an issue uses, on the laptop and in the cloud, so either can pick up the other's work. */
export const branchFor = identifier => `linear/${String(identifier).toLowerCase()}-run`

/** The repos the cloud agents work (`cloud_repos` in the authority file). The laptop Architect skips these; the cloud refuses the rest. */
export const cloudRepos = authority => Array.isArray(authority.cloud_repos) ? authority.cloud_repos.filter(r => typeof r === 'string') : []

/**
 * True when `path` is a main git checkout whose folder name matches exactly. The Mac's file system ignores case, and the
 * authority file does not: `repo:the internal repo` must not find the internal repo and then miss its `client` tier.
 * `.git` must be a folder, so a worktree of some repo (where `.git` is a file) never counts as a repo of its own.
 */
export function isRepoDir(path) {
  try { return readdirSync(dirname(path)).includes(basename(path)) && statSync(join(path, '.git')).isDirectory() } catch { return false }
}

/**
 * One builder attempt: the first turn, free retries for a rate limit or network drop, and up to two nudges when a turn has no
 * finishing line (the loop from runStep in scripts/board-run.mjs). Returns parseEnd's result, or { kind: 'failed', reason },
 * or { kind: 'silent', turns, last } when the nudges ran out. Nudges share the attempt's dollar cap.
 */
export async function build({ prompt, cwd, lists, maxUsd, launch, onSpend, pause }) {
  let spent = 0
  const turn = async (text, resume) => {
    let r
    try { r = await launch({ prompt: text, cwd, lists, resume, budgetUsd: Math.max(0.01, maxUsd - spent) }) } catch (err) { r = { ok: false, summary: String(err?.message ?? err) } }
    r = r ?? { ok: false, summary: '' }
    if (r.usd) { spent += r.usd; onSpend(r.usd) }
    return r
  }
  let done = await turn(prompt), nudges = 0, retries = 0
  for (;;) {
    const end = done.ok ? parseEnd(done.summary) : null
    const transient = end ? end.kind === 'block' && end.block === 'transient' : isTransient(done.summary)
    if (transient && retries < MAX_TRANSIENT) { retries++; await pause(retries); done = await turn(prompt); continue }
    if (!end) return { kind: 'failed', reason: done.summary || 'no reason given' }
    if (end.kind !== 'none') return end
    if (nudges >= MAX_NUDGES) return { kind: 'silent', turns: nudges + 1, last: done.summary }
    nudges++
    done = await turn(nudgeText(nudges), done.sessionId)
  }
}

/**
 * A BLOCKED finishing line. needs_input is a question only Meshach can answer, so it goes to him. Other kinds go to the
 * architect app user (env LINEAR_ARCHITECT) by setting the delegate; with no architect to find, they go to Meshach too.
 * A transient block gets here only after its free retries ran out. `stop(state, type, body)` is the caller's "to Meshach":
 * the cloud worker's version also sets the Blocked status.
 */
export async function handBlock({ linear, me, issue, end, say, stop, env }) {
  const reason = end.reason || 'no reason given'
  if (end.block === 'transient') return stop('error', 'error', `A rate limit or network error kept coming back: ${reason} ${AGAIN}`)
  let architect = null
  if (end.block !== 'needs_input' && env.LINEAR_ARCHITECT) architect = await linear.findUser(env.LINEAR_ARCHITECT).catch(() => null)
  if (!architect || architect.id === me.id) return stop('asked', 'elicitation', `I need an answer from Meshach (${end.block}): ${reason} ${AGAIN}`)
  // Standard blocked report (docs/linear-templates/comment-blocked-report.md), under 700 characters.
  const report = blockedReport({
    kind: end.block, reason, tried: 'built until the agent ended its turn BLOCKED.',
    need: `${architect.name} to rule, or to pass the question to Meshach.`, then: `delegate this issue to ${me?.name ?? 'the builder'} again.`
  })
  await say('elicitation', report)
  // The architect reads the reason from a comment: one agent cannot read another agent's session.
  await linear.note(issue.id, report)
  await linear.setDelegate(issue.id, architect.id)
  return { state: 'handed_off', to: architect.name }
}

/**
 * Waits for the pull request's checks. GitHub takes a few seconds to register them after the pull request opens, and until then
 * `gh pr checks` says "no checks reported" and exits non-zero. Retry on that message only (up to 6 tries, 10 s apart); a real
 * failure or a repo that truly has no checks still ends as unmet.
 * A fine-grained token cannot read check runs ("Resource not accessible by personal access token"), because GitHub offers
 * the Checks permission to apps only. For that one message, read the workflow runs on the head commit instead (the Actions
 * permission, which the token has). Same bar: at least one run, all finished, all green.
 */
export async function checksPass(deps, pr, cwd) {
  const sleep = deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  for (let i = 0; i < 6; i++) {
    const r = deps.gh(['pr', 'checks', pr, '--watch'], cwd)
    if (r.status === 0) return true
    const said = `${r?.stdout ?? ''}${r?.stderr ?? ''}`
    if (/not accessible by personal access token/i.test(said)) return workflowRunsPass(deps, pr, cwd, sleep)
    if (!/no checks reported/i.test(said)) return false
    await sleep(10000)
  }
  return false
}

/** The Actions-permission route for checksPass: wait up to 6 minutes for every workflow run on the head commit to finish green. */
export async function workflowRunsPass(deps, pr, cwd, sleep) {
  const head = deps.gh(['pr', 'view', pr, '--json', 'headRefOid', '--jq', '.headRefOid'], cwd)
  const sha = String(head?.stdout ?? '').trim()
  if (head.status !== 0 || !sha) return false
  const good = new Set(['success', 'skipped', 'neutral'])
  for (let i = 0; i < 36; i++) {
    const r = deps.gh(['run', 'list', '--commit', sha, '--json', 'status,conclusion'], cwd)
    if (r.status !== 0) return false
    let runs
    try { runs = JSON.parse(r.stdout) } catch { return false }
    if (runs.some(x => x.status === 'completed' && !good.has(x.conclusion))) return false
    if (runs.length && runs.every(x => x.status === 'completed')) return true
    await sleep(10000)
  }
  return false
}

/**
 * The first half of publishing: push the branch and open a pull request, each only when may() allows it. `out.ahead` is the
 * commit count; `body` is the pull request text. Returns { pr, did, note }: `pr` is the pull request URL or '', `did` the steps
 * done (for the comment), `note` why it stopped early.
 */
export function pushAndOpen({ issue, authority, name, wt, out, body, deps }) {
  const ok = r => r.status === 0, did = []
  let pr = '', note = ''
  if (!out.ahead) note = 'The branch has no commits, so there was nothing to push.'
  else if (!may(authority, name, 'push_branch')) note = `Pushing is not allowed in ${name}, so the work is on local branch ${wt.branch}.`
  else {
    const pushed = deps.git(['-C', wt.path, 'push', '-u', 'origin', wt.branch])
    if (!ok(pushed)) note = `The push failed: ${clip(pushed.stderr, 200)}`
    else {
      did.push(`pushed ${wt.branch}`)
      if (may(authority, name, 'open_pr')) {
        const made = deps.gh(['pr', 'create', '--head', wt.branch, '--title', `${issue.identifier}: ${issue.title}`, '--body', body], wt.path)
        if (ok(made)) { pr = made.stdout.trim().split('\n').at(-1); did.push(`opened ${pr}`) } else note = `Opening the pull request failed: ${clip(made.stderr, 200)}`
      }
    }
  }
  return { pr, did, note }
}

/**
 * The second half: merge `pr` when the authority file allows a merge in this repo and every merge_requires item is met (an item
 * this code does not know counts as unmet). `verified` is true when a verifier passed the work. `headSha`, when given, makes the
 * merge refuse a pull request whose head moved after the verifier looked (gh's --match-head-commit).
 * Returns { merged, note }. Callers check may(..., 'merge') themselves; this checks it again so it can never merge without it.
 */
export async function mergeWhenMet({ authority, name, pr, verified, cwd, headSha, deps }) {
  if (!may(authority, name, 'merge')) return { merged: false, note: `Merging is not allowed in ${name}.` }
  // checks_pass waits for the pull request's checks; a repo with no checks counts as unmet, so it stays with Meshach.
  // A pull request that is behind the base cannot merge in a repo that requires up-to-date branches. Bring it up to date
  // first, so the checks we wait for are the ones that count. A failure here (already up to date, a conflict) is not fatal: the checks and merge decide.
  // With headSha set, the update is skipped: it would add a commit the verifier never saw, and the merge below would refuse it anyway.
  if (!headSha) deps.gh(['pr', 'update-branch', pr], cwd)
  const met = { verifier_pass: () => verified === true, checks_pass: async () => checksPass(deps, pr, cwd) }
  const unmet = []
  for (const req of mergeRequires(authority, name)) if (!(await met[req]?.())) unmet.push(req)
  if (unmet.length) return { merged: false, note: `Not merged: ${unmet.join(', ')} not met.` }
  const merged = deps.gh(['pr', 'merge', pr, '--squash', ...(headSha ? ['--match-head-commit', headSha] : [])], cwd).status === 0
  return { merged, note: merged ? '' : 'The merge command failed.' }
}

/**
 * The laptop runner's publish: COMPLETE or REVIEW plus verifier PASS, acted on by authority. Push, open a pull request and merge,
 * each only when allowed. A merge also needs a COMPLETE line, not REVIEW. A merged issue moves to its done status; anything else
 * moves to In Review. Then the delegate is cleared.
 */
export async function publish({ linear, issue, authority, name, wt, out, end, graded, say, deps }) {
  const body = `Linear issue ${issue.identifier}: ${issue.url ?? ''}\n\n${end.summary}\n\nVerifier: PASS. ${graded.summary ?? ''}`
  const opened = pushAndOpen({ issue, authority, name, wt, out, body, deps })
  const { pr, did } = opened
  let { note } = opened, merged = false
  if (pr && end.kind === 'review') note = `The builder asked for a person to look before merging: ${end.summary}`
  else if (pr && may(authority, name, 'merge')) {
    const m = await mergeWhenMet({ authority, name, pr, verified: graded.verdict === 'PASS', cwd: wt.path, deps })
    merged = m.merged
    if (merged) did.push('merged it'); else note = m.note
  }
  await say('response', [`Done, and the verifier passed it. ${did.length ? `I ${did.join(', ')}.` : ''}`, note, merged ? deployNote(authority, name) : 'It is ready for your review.', `Summary: ${clip(end.summary, 600)}`].filter(Boolean).join(' '))
  await linear.moveIssue(issue, merged ? { type: 'completed' } : { type: 'started', name: 'In Review' }, { delegateId: null })
  return { state: merged ? 'merged' : 'in_review', pr }
}
