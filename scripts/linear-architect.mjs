#!/usr/bin/env node
// The Architect. It works Linear issues delegated to the Architect app user: issues a builder handed over because it was blocked,
// and issues labeled `needs:design`, which get a design pass before any builder starts (scripts/lib/architect-design.mjs).
// It reads the issue, the block reason (a comment the builder left) and the repo, read-only, and rules from docs/architect-policy.md
// and docs/architect-stack.md (Meshach's preferred platforms; it may fetch the docs sites linked there, and no other site).
// A decision it is allowed to make goes back to the builder as a comment and the issue is delegated to the builder again.
// Anything else becomes one question for Meshach. It never edits a file and never merges.
//
//   node scripts/linear-architect.mjs [--once] [--poll 60] [--dry-run]
//
// Env: LINEAR_ARCHITECT_TOKEN (the Architect app's token, required), LINEAR_BUILDER (the builder app user's name, default
// "Builder (laptop)"), LINEAR_RUN_CODE and BOARD_RUN_CONF_DIR as in scripts/linear-run.mjs. Spend, the daily cap and the kill switch are
// shared with the runner (linear-run.json and linear-run.off). docs/linear-runner.md has the rest.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadAuthority } from './lib/authority.mjs'
import { makeLinear } from './lib/linear-api.mjs'
import { confDir as resolveConfDir } from './lib/paths.mjs'
import { loginGate, watchLogin } from './lib/claude-login.mjs'
import { isRepoDir, gate, recordSpend, launchClaude, clip } from './linear-run.mjs'
import { cloudRepos, limit, repoLabel } from './lib/linear-flow.mjs'
// The rulings and the design pass live in scripts/lib/architect-rule.mjs (shared with the cloud worker); re-exported here for older importers.
import { READ_ONLY, docHosts, architectTools, stackSection, rulingPrompt, parseRuling, ruleIssue, POLICY_PATH, STACK_PATH, readText } from './lib/architect-rule.mjs'
export { READ_ONLY, docHosts, architectTools, stackSection, rulingPrompt, parseRuling, ruleIssue, POLICY_PATH, STACK_PATH }

const USAGE = 'usage: node scripts/linear-architect.mjs [--once] [--poll <seconds>] [--dry-run]'
const option = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** `deps` lets a test swap every outside call. */
export async function main(args, deps = {}) {
  const log = deps.log ?? console.log, warn = deps.warn ?? console.error
  if (args.includes('--help') || args.includes('-h')) { log(USAGE); return 0 }
  const env = deps.env ?? process.env
  const dryRun = args.includes('--dry-run'), once = args.includes('--once') || dryRun
  const poll = Number(option(args, '--poll') ?? 60)
  if (!(poll >= 1)) { warn(USAGE); return 2 }
  const confDir = deps.confDir ?? resolveConfDir(env)
  const readAuthority = deps.authority ?? loadAuthority
  let linear
  try { linear = deps.linear ?? makeLinear({ fetch: deps.fetch, token: deps.token ?? env.LINEAR_ARCHITECT_TOKEN ?? '' }) } catch { warn('No Linear token is set for the Architect (LINEAR_ARCHITECT_TOKEN).'); return 2 }
  const login = {} // claude login state (scripts/lib/claude-login.mjs)
  const work = {
    codeDir: deps.codeDir ?? env.LINEAR_RUN_CODE ?? join(homedir(), 'Code'), isRepo: deps.isRepo ?? isRepoDir,
    launch: watchLogin(deps.launch ?? launchClaude, login), onSpend: usd => recordSpend(confDir, usd, localDay()),
    builderName: env.LINEAR_BUILDER ?? 'Builder (laptop)'
  }
  // The policy and the stack file are read again every cycle, so a pulled edit takes effect without a restart (the services run --poll for days).
  const stuck = new Set()
  let me
  for (;;) {
    const closed = () => dryRun ? '' : gate({ dir: confDir, dailyUsd: limit(readAuthority(), 'per_day_usd', 10), today: localDay() })
    try {
      if (closed()) warn(`not starting work: ${closed()}`)
      else {
        work.policy = deps.policy ?? readText(POLICY_PATH)
        work.stack = deps.stack ?? readText(STACK_PATH)
        me = me ?? await linear.viewer()
        const queue = (await linear.delegatedIssues(me.id)).filter(i => !stuck.has(i.id))
        if (!queue.length) log('nothing delegated to me')
        const loggedIn = dryRun || await loginGate({ check: deps.checkLogin ?? (deps.launch && (() => ({ ok: true }))), linear, queue, name: 'architect', warn, state: login })
        for (const [n, issue] of (loggedIn ? queue : []).entries()) {
          // An issue in a cloud repo belongs to the cloud Architect job (scripts/linear-job.mjs), which uses this same app user.
          if (cloudRepos(readAuthority()).includes(repoLabel(issue))) { log(`${issue.identifier}: skipped, ${repoLabel(issue)} is on cloud_repos`); continue }
          if (dryRun) { log(`would rule on ${issue.identifier} "${issue.title}"`); continue }
          if (closed()) { warn(`not starting ${issue.identifier}: ${closed()}`); break }
          if (!await loginGate({ check: deps.checkLogin ?? (deps.launch && (() => ({ ok: true }))), linear, queue: queue.slice(n), name: 'architect', warn, state: login })) break
          try {
            const r = await ruleIssue({ linear, me, issue, authority: readAuthority(), deps: work })
            log(`${issue.identifier}: ${r.state}${r.kind ? ` (${r.kind})` : ''}${r.to ? ` to ${r.to}` : ''}`)
          } catch (err) { stuck.add(issue.id); warn(`${issue.identifier}: ${clip(err?.message ?? err, 300)} (left alone until the Architect restarts)`) }
        }
      }
    } catch (err) { warn(`cycle failed: ${clip(err?.message ?? err, 300)}`) }
    if (once) return 0
    await new Promise(r => setTimeout(r, poll * 1000))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2))
