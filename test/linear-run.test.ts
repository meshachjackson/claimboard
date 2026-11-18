// The Linear runner. Fake Linear API (an injected fetch), fake agent,
// fake verifier, fake git and gh. No live call, no real claude, no money spent. Test names say which rule they check.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let r: any
before(async () => { r = await import('../scripts/linear-run.mjs') })

const TOKEN = 'test-token-not-real'
// A fixture, not the authority file: it may name no early-dev repo and Meshach may edit it at any time.
const AUTHORITY = {
  default_tier: 'live',
  tiers: {
    'early-dev': { push_branch: true, open_pr: true, merge: true, deploy: true, merge_requires: ['checks_pass', 'verifier_pass'] },
    'live': { push_branch: true, open_pr: true, merge: false, deploy: false, merge_requires: [] },
    'client': { push_branch: false, open_pr: false, merge: false, deploy: false, merge_requires: [] }
  },
  repos: { 'sandbox': 'early-dev', 'agent-board': 'live', 'catalyst-n8n': 'client' },
  limits: { per_run_usd: 2, per_day_usd: 10, max_retries: 2 }
}
const issue = (labels: string[], extra = {}) => ({
  id: 'iss-1', identifier: 'ENG-1', title: 'Fix the footer', description: 'The footer is wrong.\n\nDone when:\n- `src/footer.ts` shows the year\n- `pnpm test` passes',
  priority: 2, createdAt: '2026-11-12T10:00:00.000Z', url: 'https://linear.test/ENG-1', team: { id: 'team-1' }, state: { id: 'st-todo', name: 'Todo', type: 'unstarted' },
  labels: { nodes: labels.map(name => ({ name })) }, ...extra
})
const STATES = [
  { id: 'st-todo', name: 'Todo', type: 'unstarted', position: 1 }, { id: 'st-prog', name: 'In Progress', type: 'started', position: 2 },
  { id: 'st-review', name: 'In Review', type: 'started', position: 3 }, { id: 'st-done', name: 'Done', type: 'completed', position: 4 }
]

type Call = { url: string, op: string, query: string, variables: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any

/** A Linear API that answers every query the runner sends and records each request. Nothing leaves the process. */
function fakeLinear(issues: unknown[]) {
  const calls: Call[] = []
  const fetch = async (url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body)
    const op = /^(?:query|mutation)\s+(\w+)/.exec(query)![1]!
    calls.push({ url: String(url), op, query, variables })
    const data = {
      Me: { viewer: { id: 'app-runner', name: 'Builder' } },
      Delegated: { issues: { nodes: issues } },
      Sessions: { agentSessions: { nodes: [] } },
      TeamStates: { team: { states: { nodes: STATES } } },
      FindUser: { users: { nodes: [{ id: 'app-architect', name: 'Architect' }] } },
      AgentSessionCreateOnIssue: { agentSessionCreateOnIssue: { success: true, agentSession: { id: 'ses-1' } } },
      AgentActivityCreate: { agentActivityCreate: { success: true } },
      IssueUpdate: { issueUpdate: { success: true } },
      CommentCreate: { commentCreate: { success: true } }
    }[op]
    return { ok: true, status: 200, json: async () => ({ data }) }
  }
  return {
    fetch, calls,
    mutations: () => calls.filter(c => c.query.startsWith('mutation')),
    activities: () => calls.filter(c => c.op === 'AgentActivityCreate').map(c => c.variables.input.content as { type: string, body: string }),
    updates: () => calls.filter(c => c.op === 'IssueUpdate').map(c => c.variables.input as Record<string, unknown>)
  }
}

/** Everything main() would otherwise reach outside the process, faked. `replies` are the builder's turns, in order. */
function world(issues: unknown[], replies: string[], opts: { verdicts?: string[], authority?: unknown, env?: Record<string, string>, gh?: (a: string[]) => number, ghErr?: (a: string[]) => string, ghOut?: (a: string[]) => string | undefined } = {}) {
  const linear = fakeLinear(issues)
  const launches: { prompt: string, resume?: string, lists: { allow: string[], deny: string[] } }[] = []
  const git: string[][] = [], gh: string[][] = [], logs: string[] = []
  const verdicts = [...(opts.verdicts ?? ['PASS'])]
  let verifies = 0
  const confDir = mkdtempSync(join(tmpdir(), 'linear-run-test-'))
  const deps = {
    fetch: linear.fetch, token: TOKEN, confDir, codeDir: '/code', env: opts.env ?? {},
    authority: () => opts.authority ?? AUTHORITY,
    isRepo: (p: string) => ['/code/sandbox', '/code/agent-board', '/code/catalyst-n8n'].includes(p),
    prepare: (repo: string, id: string) => ({ path: `${repo}-${id.toLowerCase()}`, branch: `linear/${id.toLowerCase()}-run` }),
    launch: async (a: { prompt: string, resume?: string, lists: { allow: string[], deny: string[] } }) => {
      launches.push(a)
      return { ok: true, summary: replies[launches.length - 1] ?? 'COMPLETE: done', usd: 0.25, sessionId: 'claude-1' }
    },
    verify: async () => { verifies++; const verdict = verdicts.shift() ?? 'PASS'; return { verdict, summary: `verifier says ${verdict}`, detail: `VERDICT: ${verdict}`, usd: 0.1 } },
    finish: () => ({ ahead: 1, summary: '1 commit(s).' }),
    git: (a: string[]) => { git.push(a); return { status: 0, stdout: '', stderr: '' } },
    sleep: async () => {},
    gh: (a: string[]) => { gh.push(a); return { status: opts.gh?.(a) ?? 0, stdout: opts.ghOut?.(a) ?? (a[1] === 'create' ? 'https://github.test/pr/7\n' : ''), stderr: opts.ghErr?.(a) ?? '' } },
    pause: async () => {}, log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m)
  }
  return { linear, launches, git, gh, logs, confDir, deps, verifies: () => verifies, run: (args = ['--once']) => r.main(args, deps) }
}
const ghCommands = (w: ReturnType<typeof world>) => w.gh.map(a => a.slice(0, 2).join(' '))

test('no `repo:` label asks instead of guessing', async () => {
  const w = world([issue(['bug'])], [])
  assert.equal(await w.run(), 0)
  assert.equal(w.launches.length, 0)
  const [asked] = w.linear.activities()
  assert.equal(asked!.type, 'elicitation')
  assert.match(asked!.body, /no `repo:<folder>` label/)
  assert.deepEqual(w.linear.updates(), [{ delegateId: null }]) // off the runner's queue until a person answers
})

test('a repo label that is not a plain folder, names no repo, or comes twice is a question too', () => {
  const at = { codeDir: '/code', isRepo: (p: string) => p === '/code/sandbox' }
  const ask = (labels: string[]) => r.resolveRepo({ identifier: 'ENG-1', labels }, at)
  assert.deepEqual(ask(['repo:sandbox']), { ok: true, name: 'sandbox', repo: '/code/sandbox' })
  for (const bad of ['repo:../sandbox', 'repo:_archived', 'repo:a/b', 'repo:', 'repo:.git', 'repo:nowhere']) assert.equal(ask([bad]).ok, false, bad)
  assert.match(ask(['repo:sandbox', 'repo:agent-board']).ask, /2 repo labels/)
})

test('the real repo check needs the exact folder name and a main checkout, so a label cannot slip past a client tier', () => {
  const code = mkdtempSync(join(tmpdir(), 'linear-run-code-'))
  mkdirSync(join(code, 'Internal-Repo', '.git'), { recursive: true })
  mkdirSync(join(code, 'Internal-Repo-eng-1'))
  writeFileSync(join(code, 'Internal-Repo-eng-1', '.git'), 'gitdir: elsewhere') // a worktree: .git is a file
  assert.equal(r.isRepoDir(join(code, 'Internal-Repo')), true)
  assert.equal(r.isRepoDir(join(code, 'internal-repo')), false) // the Mac would open this folder; the runner must not
  assert.equal(r.isRepoDir(join(code, 'Internal-Repo-eng-1')), false)
  assert.equal(r.isRepoDir(join(code, 'nowhere')), false)
  assert.equal(r.resolveRepo({ identifier: 'ENG-1', labels: ['repo:internal-repo'] }, { codeDir: code, isRepo: r.isRepoDir }).ok, false)
})

test('a turn with no finishing line is nudged twice then errors', async () => {
  const w = world([issue(['repo:sandbox'])], ['I think that is finished.', 'Still nothing to add.', 'All good.'])
  await w.run()
  assert.equal(w.launches.length, 3) // the first turn and two nudges
  assert.match(w.launches[1]!.prompt, /Reminder 1 of 2/)
  assert.match(w.launches[2]!.prompt, /Reminder 2 of 2/)
  assert.equal(w.launches[1]!.resume, 'claude-1') // a nudge resumes the same session
  assert.equal(w.verifies(), 0)
  const last = w.linear.activities().at(-1)!
  assert.equal(last.type, 'error')
  assert.match(last.body, /3 turns without a finishing line/)
  assert.deepEqual(w.gh, [])
})

test('COMPLETE + PASS in an `early-dev` repo pushes, opens a pull request and merges', async () => {
  const w = world([issue(['repo:sandbox'])], ['Changed the footer.\nCOMPLETE: footer shows the year'])
  await w.run()
  assert.deepEqual(w.git, [['-C', '/code/sandbox-eng-1', 'push', '-u', 'origin', 'linear/eng-1-run']])
  assert.deepEqual(ghCommands(w), ['pr create', 'pr update-branch', 'pr checks', 'pr merge'])
  assert.equal(w.linear.activities().at(-1)!.type, 'response')
  assert.match(w.linear.activities().at(-1)!.body, /merged it/)
  assert.match(w.linear.activities().at(-1)!.body, /Merged, not deployed/)
  // Started when work began, then Done with the delegate cleared.
  assert.deepEqual(w.linear.updates(), [{ stateId: 'st-prog' }, { stateId: 'st-done', delegateId: null }])
  assert.match(w.logs.join('\n'), /ENG-1: merged https:\/\/github\.test\/pr\/7/)
})

test('COMPLETE + PASS in a `live` repo opens a pull request and does not merge', async () => {
  const w = world([issue(['repo:agent-board'])], ['COMPLETE: footer shows the year'])
  await w.run()
  assert.equal(w.git.length, 1)
  assert.deepEqual(ghCommands(w), ['pr create'])
  assert.match(w.linear.activities().at(-1)!.body, /ready for your review/)
  assert.deepEqual(w.linear.updates().at(-1), { stateId: 'st-review', delegateId: null })
})

test('checks that GitHub has not registered yet are retried, then the merge goes ahead', async () => {
  let tries = 0
  const w = world([issue(['repo:sandbox'])], ['COMPLETE: done'], { gh: a => a[1] === 'checks' && ++tries < 3 ? 1 : 0, ghErr: a => a[1] === 'checks' && tries < 3 ? 'no checks reported on the branch' : '' })
  await w.run()
  assert.deepEqual(ghCommands(w), ['pr create', 'pr update-branch', 'pr checks', 'pr checks', 'pr checks', 'pr merge'])
})

// A fine-grained token cannot read check runs, so the runner reads the workflow runs on the head commit instead.
const NO_CHECKS_ACCESS = (a: string[]) => a[1] === 'checks' ? 'GraphQL: Resource not accessible by personal access token' : ''
const runsOut = (...runs: { status: string, conclusion: string }[]) => (a: string[]) => a[1] === 'view' ? 'abc123\n' : a[1] === 'list' ? JSON.stringify(runs) : undefined

test('when the token cannot read checks, green workflow runs on the head commit let the merge go ahead', async () => {
  const w = world([issue(['repo:sandbox'])], ['COMPLETE: done'], { gh: a => a[1] === 'checks' ? 1 : 0, ghErr: NO_CHECKS_ACCESS, ghOut: runsOut({ status: 'completed', conclusion: 'success' }) })
  await w.run()
  assert.deepEqual(ghCommands(w), ['pr create', 'pr update-branch', 'pr checks', 'pr view', 'run list', 'pr merge'])
  assert.deepEqual(w.gh.find(a => a[1] === 'list'), ['run', 'list', '--commit', 'abc123', '--json', 'status,conclusion'])
})

test('when the token cannot read checks, a failed or missing workflow run holds the merge', async () => {
  const red = world([issue(['repo:sandbox'])], ['COMPLETE: done'], { gh: a => a[1] === 'checks' ? 1 : 0, ghErr: NO_CHECKS_ACCESS, ghOut: runsOut({ status: 'completed', conclusion: 'failure' }) })
  await red.run()
  assert.ok(!ghCommands(red).includes('pr merge'))
  assert.match(red.linear.activities().at(-1)!.body, /Not merged: checks_pass not met/)
  const none = world([issue(['repo:sandbox'])], ['COMPLETE: done'], { gh: a => a[1] === 'checks' ? 1 : 0, ghErr: NO_CHECKS_ACCESS, ghOut: runsOut() })
  await none.run()
  assert.ok(!ghCommands(none).includes('pr merge'))
})

test('merge follows the authority file: one changed line refuses it, and a failed check holds it', async () => {
  const noMerge = structuredClone(AUTHORITY); noMerge.tiers['early-dev'].merge = false
  const a = world([issue(['repo:sandbox'])], ['COMPLETE: done'], { authority: noMerge })
  await a.run()
  assert.deepEqual(ghCommands(a), ['pr create'])
  const b = world([issue(['repo:sandbox'])], ['COMPLETE: done'], { gh: args => args[1] === 'checks' ? 1 : 0 })
  await b.run()
  assert.deepEqual(ghCommands(b), ['pr create', 'pr update-branch', 'pr checks'])
  assert.match(b.linear.activities().at(-1)!.body, /Not merged: checks_pass not met/)
  assert.deepEqual(b.linear.updates().at(-1), { stateId: 'st-review', delegateId: null })
  // A requirement the runner does not know counts as unmet.
  const odd = structuredClone(AUTHORITY); odd.tiers['early-dev'].merge_requires = ['verifier_pass', 'meshach_smiles']
  const c = world([issue(['repo:sandbox'])], ['COMPLETE: done'], { authority: odd })
  await c.run()
  assert.deepEqual(ghCommands(c), ['pr create', 'pr update-branch'])
  // REVIEW means a person should look: pull request, no merge.
  const d = world([issue(['repo:sandbox'])], ['REVIEW: check the wording'])
  await d.run()
  assert.deepEqual(ghCommands(d), ['pr create'])
})

test('a `client` repo is refused before any agent starts', async () => {
  const w = world([issue(['repo:catalyst-n8n'])], [])
  await w.run()
  assert.equal(w.launches.length, 0)
  assert.equal(w.verifies(), 0)
  assert.deepEqual([w.git, w.gh], [[], []])
  assert.equal(w.linear.activities().at(-1)!.type, 'error')
  assert.match(w.linear.activities().at(-1)!.body, /client repo/)
  assert.deepEqual(w.linear.updates(), [{ delegateId: null }])
})

test('verifier FAIL retries up to `max_retries`, then errors', async () => {
  const w = world([issue(['repo:sandbox'])], ['COMPLETE: try 1', 'COMPLETE: try 2', 'COMPLETE: try 3', 'COMPLETE: try 4'], { verdicts: ['FAIL', 'FAIL', 'FAIL', 'FAIL'] })
  await w.run()
  assert.equal(w.launches.length, 1 + AUTHORITY.limits.max_retries) // the first build and max_retries more
  assert.equal(w.verifies(), 3)
  assert.match(w.launches[1]!.prompt, /A verifier failed your last attempt/)
  assert.equal(w.linear.activities().at(-1)!.type, 'error')
  assert.deepEqual([w.git, w.gh], [[], []]) // nothing is pushed on a FAIL
})

test('verifier FAIL then PASS goes back to the builder once and then publishes', async () => {
  const w = world([issue(['repo:agent-board'])], ['COMPLETE: try 1', 'COMPLETE: try 2'], { verdicts: ['FAIL', 'PASS'] })
  await w.run()
  assert.equal(w.launches.length, 2)
  assert.deepEqual(ghCommands(w), ['pr create'])
})

test('BLOCKED sets the delegate to the architect', async () => {
  const w = world([issue(['repo:sandbox'])], ['BLOCKED capability: I have no access to the design files'], { env: { LINEAR_ARCHITECT: 'Architect' } })
  await w.run()
  assert.equal(w.linear.calls.find(c => c.op === 'FindUser')!.variables.name, 'Architect')
  const last = w.linear.activities().at(-1)!
  assert.equal(last.type, 'elicitation')
  assert.match(last.body, /^\*\*Blocked \(capability\):\*\* I have no access to the design files\n\*\*Tried:\*\* /)
  assert.match(last.body, /\n\*\*Need:\*\* Architect to rule/)
  assert.match(last.body, /\n\*\*Then:\*\* delegate this issue to /)
  assert.deepEqual(w.linear.updates().at(-1), { delegateId: 'app-architect' })
  assert.equal(w.verifies(), 0)
})

test('a `needs_input` block reaches Meshach, not the architect', async () => {
  const w = world([issue(['repo:sandbox'])], ['BLOCKED needs_input: which year format do you want?'], { env: { LINEAR_ARCHITECT: 'Architect' } })
  await w.run()
  assert.equal(w.linear.calls.some(c => c.op === 'FindUser'), false)
  const last = w.linear.activities().at(-1)!
  assert.equal(last.type, 'elicitation')
  assert.match(last.body, /I need an answer from Meshach \(needs_input\): which year format/)
  assert.deepEqual(w.linear.updates().at(-1), { delegateId: null })
})

test('the daily dollar cap stops new runs', async () => {
  const w = world([issue(['repo:sandbox'])], ['COMPLETE: done'])
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  writeFileSync(join(w.confDir, 'linear-run.json'), JSON.stringify({ date: today, usd: 10 }))
  assert.equal(await w.run(), 0)
  assert.equal(w.launches.length, 0)
  assert.equal(w.linear.calls.length, 0)
  assert.match(w.logs.join('\n'), /daily cap reached: \$10\.00 of \$10/)
  // A cap of 0 is a real setting: nothing starts.
  const zero = structuredClone(AUTHORITY); zero.limits.per_day_usd = 0
  const z = world([issue(['repo:sandbox'])], ['COMPLETE: done'], { authority: zero })
  await z.run()
  assert.deepEqual([z.launches.length, z.linear.calls.length], [0, 0])
  // Spend is recorded as runs happen: a run under the cap adds the builder's and the verifier's cost.
  const fresh = world([issue(['repo:agent-board'])], ['COMPLETE: done'])
  await fresh.run()
  assert.equal(r.gate({ dir: fresh.confDir, dailyUsd: 0.35, today }), 'daily cap reached: $0.35 of $0.35 spent today')
})

test('the kill switch file stops new runs', async () => {
  const w = world([issue(['repo:sandbox'])], ['COMPLETE: done'])
  writeFileSync(join(w.confDir, 'linear-run.off'), '')
  assert.equal(await w.run(), 0)
  assert.equal(w.launches.length, 0)
  assert.equal(w.linear.calls.length, 0)
  assert.match(w.logs.join('\n'), /not starting work: off:/)
})

test('tool lists: the exact allow and deny arrays for an `early-dev` repo and a `live` repo come from may()', () => {
  const allow = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash(git *)', 'Bash(python3 *)', 'Bash(pytest *)', 'Bash(npm test*)', 'Bash(npm run *)',
    'Bash(pnpm test*)', 'Bash(pnpm run *)', 'Bash(pnpm typecheck*)', 'Bash(pnpm -C * test*)', 'Bash(pnpm -C * typecheck*)', 'Bash(pnpm -C * run *)',
    'Bash(pnpm install --frozen-lockfile*)', 'Bash(npm ci*)', 'Bash(.venv/bin/python3 *)', 'Bash(.venv/bin/pytest *)', 'Bash(env -u * pytest *)', 'Bash(env -u * .venv/bin/pytest *)', 'Bash(node *)', 'Bash(ls *)', 'Bash(mkdir *)', 'Bash(grep *)', 'Bash(sort *)']
  const always = ['Bash(vercel*)', 'Bash(rm -rf*)', 'Bash(npm publish*)', 'Bash(pnpm publish*)', 'Bash(pnpm -C * publish*)',
    'Bash(pnpm * dlx*)', 'Bash(pnpm dlx*)', 'Bash(pnpm * add *)', 'Bash(pnpm add *)', 'Bash(git push*--force*)', 'Bash(git push* main*)', 'Bash(git push* master*)']
  // early-dev and live both allow push and pull requests. Neither builder may merge: early-dev merges have requirements the runner checks.
  const open = { allow: [...allow, 'Bash(gh pr create*)'], deny: [...always, 'Bash(gh pr merge*)'] }
  assert.deepEqual(r.toolLists(AUTHORITY, 'sandbox'), open)
  assert.deepEqual(r.toolLists(AUTHORITY, 'agent-board'), open)
  // A tier with no push gets the old full ban; a tier that may merge with no requirements gets gh pr merge.
  assert.deepEqual(r.toolLists(AUTHORITY, 'catalyst-n8n'), { allow, deny: [...always, 'Bash(git push*)', 'Bash(gh *)', 'Bash(gh pr merge*)'] })
  const free = structuredClone(AUTHORITY); free.tiers['early-dev'].merge_requires = []
  assert.deepEqual(r.toolLists(free, 'sandbox'), { allow: [...allow, 'Bash(gh pr create*)', 'Bash(gh pr merge*)'], deny: always })
  // The lists reach the claude command line, and the builder is never told to do what they deny.
  const cmd = r.agentCommand({ worktree: '/wt', maxUsd: 2, lists: open })
  assert.deepEqual(cmd.slice(cmd.indexOf('--disallowedTools') + 1), open.deny)
  assert.match(r.buildPrompt(issue([]), []), /Do not push, open pull requests, merge or deploy/)
})

test('--dry-run lists what it would start and makes zero mutation calls', async () => {
  const w = world([issue(['repo:sandbox']), issue(['repo:catalyst-n8n'], { id: 'iss-2', identifier: 'ENG-2' }), issue([], { id: 'iss-3', identifier: 'ENG-3' })], [])
  writeFileSync(join(w.confDir, 'linear-run.off'), '') // a dry run still lists with the kill switch on
  assert.equal(await w.run(['--dry-run']), 0)
  assert.equal(w.linear.mutations().length, 0)
  assert.deepEqual(w.linear.calls.map(c => c.op), ['Me', 'Delegated'])
  assert.deepEqual([w.launches.length, w.verifies(), w.git.length, w.gh.length], [0, 0, 0, 0])
  assert.match(w.logs[0]!, /would start ENG-1 "Fix the footer" in sandbox \(early-dev\): push yes, pull request yes, merge yes/)
  assert.match(w.logs[1]!, /would refuse ENG-2: catalyst-n8n is a client repo/)
  assert.match(w.logs[2]!, /would ask about ENG-3/)
})

test('every request goes to the injected fetch with the token in the header only, and no token means no run', async () => {
  const w = world([issue(['repo:agent-board'])], ['COMPLETE: done'])
  await w.run()
  assert.ok(w.linear.calls.length > 0)
  assert.ok(w.linear.calls.every(c => c.url === 'https://api.linear.app/graphql')) // the address is only ever handed to the fake
  assert.equal(JSON.stringify([w.logs, w.linear.calls]).includes(TOKEN), false) // never logged, never in a request body
  const none = world([], [])
  const saved = process.env.LINEAR_RUN_TOKEN
  delete process.env.LINEAR_RUN_TOKEN
  try { assert.equal(await r.main(['--once'], { ...none.deps, token: undefined }), 2) } finally { if (saved !== undefined) process.env.LINEAR_RUN_TOKEN = saved }
  assert.equal(none.linear.calls.length, 0)
})

test('an existing Linear session for the issue is reused, and a failed Linear write does not loop', async () => {
  // Already In Progress, so the only issue write is the last one (In Review, delegate cleared), and that one fails here.
  const w = world([issue(['repo:agent-board'], { state: { id: 'st-prog', name: 'In Progress', type: 'started' } })], ['COMPLETE: done'])
  const inner = w.deps.fetch
  w.deps.fetch = async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    if (body.query.startsWith('query Sessions')) return { ok: true, status: 200, json: async () => ({ data: { agentSessions: { nodes: [{ id: 'ses-bridge', status: 'pending', issue: { id: 'iss-1' }, appUser: { id: 'app-runner' } }] } } }) }
    if (body.query.startsWith('mutation IssueUpdate')) return { ok: false, status: 500, json: async () => ({ errors: [{ message: 'boom' }] }) }
    return inner(url, init)
  }
  await w.run()
  assert.equal(w.linear.calls.some(c => c.op === 'AgentSessionCreateOnIssue'), false)
  assert.equal(w.linear.calls.find(c => c.op === 'AgentActivityCreate')!.variables.input.agentSessionId, 'ses-bridge')
  assert.match(w.logs.join('\n'), /ENG-1: Linear answered 500: boom \(left alone until the runner restarts\)/)
})

test('doneWhen ignores "Done when" in the header and the Rules block', () => {
  const body = '## Summary\n\n* **Goal:** ship it\n* Done when lines: 2 below\n\n## Done when\n\n* [ ] A holds\n* [ ] B holds\n\n## Rules\n\n* Done when every line holds, stop.\n* Not a check'
  assert.deepEqual(r.doneWhen(body), ['A holds', 'B holds'])
  assert.deepEqual(r.doneWhen('* **Checks:** 4 Done when lines\n\n## Done when\n\n* A holds'), ['A holds'])
  // No heading and no colon: the words alone start nothing.
  assert.deepEqual(r.doneWhen('Done when lines are listed below\n* not a check'), [])
})

test('doneWhen reads every template body in docs/linear-templates the same way', () => {
  const dir = join(process.cwd(), 'docs/linear-templates')
  for (const f of readdirSync(dir).filter(n => n.endsWith('.md') && !n.startsWith('comment-') && n !== 'README.md')) {
    for (const [, body] of readFileSync(join(dir, f), 'utf8').matchAll(/```md\n([\s\S]*?)\n```/g)) {
      const want = [...body.matchAll(/^\* \[ \] (.+)$/gm)].map(m => m[1].trim())
      assert.ok(want.length > 0, `${f}: no checkbox lines found`)
      assert.deepEqual(r.doneWhen(body), want, f)
    }
  }
})

test('doneWhen reads the bullet lines under "Done when" and stops at the next paragraph', () => {
  assert.deepEqual(r.doneWhen('Intro\n\n## Done when\n- [ ] A holds\n- B holds\n1. C holds\n\nNotes\n- not a check'), ['A holds', 'B holds', 'C holds'])
  assert.deepEqual(r.doneWhen('**Done when:** the page loads'), ['the page loads'])
  assert.deepEqual(r.doneWhen('no checks here'), [])
  assert.match(r.buildPrompt(issue([]), r.doneWhen(issue([]).description)), /- `src\/footer.ts` shows the year\n- `pnpm test` passes/)
})

test('base branch: a repo whose default branch is `master` is cut from master, not main', () => {
  const calls: string[][] = []
  const git = (a: string[]) => {
    calls.push(a)
    if (a.includes('symbolic-ref')) return { status: 0, stdout: 'origin/master\n', stderr: '' }
    if (a.includes('merge-base')) return { status: 0, stdout: '', stderr: '' }
    return { status: 1, stdout: '', stderr: 'unexpected' }
  }
  assert.equal(r.baseFor('/code/JamSync', git), 'master')
  const behind = (a: string[]) => a.includes('symbolic-ref') ? { status: 0, stdout: 'origin/master\n', stderr: '' } : { status: 1, stdout: '', stderr: '' }
  assert.equal(r.baseFor('/code/JamSync', behind), 'origin/master')
})

test('builder prompt: comments on the issue (an architect decision) reach the builder as data', () => {
  const p = r.buildPrompt({ identifier: 'ENG-1', title: 'Fix the footer', description: 'x', notes: ['**Architect decision (approach):** Use the server year.'] }, [])
  assert.ok(p.includes('**Architect decision (approach):** Use the server year.'))
  assert.ok(!r.buildPrompt({ identifier: 'ENG-1', title: 'Fix the footer', description: 'x' }, []).includes('Comments on the issue'))
})

test('verifier tools: it may run `npm run typecheck` and a repo-local Python environment, and still cannot push', () => {
  const args = r.verifierArgs({ worktree: '/w', maxUsd: 1, extraDirs: [] })
  const allow = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'))
  for (const tool of ['Bash(npm run *)', 'Bash(.venv/bin/pytest *)', 'Bash(env -u * pytest *)', 'Read']) assert.ok(allow.includes(tool), tool)
  assert.ok(!allow.includes('Edit') && !allow.includes('Write'))
  assert.ok(args.slice(args.indexOf('--disallowedTools') + 1).includes('Bash(git push*)'))
})

// ---------- Builder backends ----------

const NOUS = { enabled: true, may_merge: false, base_url: 'http://127.0.0.1:1/v1', model: 'free/model:free', key_env: 'LINEAR_NOUS_API_KEY', max_turns: 5, price_in: 0, price_out: 0 }
const withBackends = (nous: Record<string, unknown> = {}) => ({ ...AUTHORITY, backends: { default: 'claude', nous: { ...NOUS, ...nous } } })

test('backend: the label, then env, then the authority default, then claude', () => {
  const pick = (labels: string[], a: unknown = withBackends(), env = {}) => r.pickBackend({ identifier: 'ENG-1', labels }, a, env)
  assert.deepEqual(pick([]), { ok: true, name: 'claude' })
  assert.deepEqual(pick([], AUTHORITY), { ok: true, name: 'claude' }) // no backends section at all
  assert.equal(pick(['agent:nous']).name, 'nous')
  assert.equal(pick(['Agent:Nous']).name, 'nous')
  assert.equal(pick([], withBackends(), { LINEAR_RUN_BACKEND: 'nous' }).name, 'nous')
  assert.equal(pick(['agent:claude'], withBackends(), { LINEAR_RUN_BACKEND: 'nous' }).name, 'claude') // the label wins
  assert.equal(pick([], { ...withBackends(), backends: { ...withBackends().backends, default: 'nous' } }).name, 'nous')
})

test('backend: other children of the agent label group are not builder requests', () => {
  const pick = (labels: string[]) => r.pickBackend({ identifier: 'ENG-1', labels }, withBackends(), {})
  assert.deepEqual(pick(['agent:claude-code']), { ok: true, name: 'claude' })
  assert.deepEqual(pick(['agent:codex', 'agent:orchestrator']), { ok: true, name: 'claude' })
  assert.equal(pick(['agent:claude-code', 'agent:nous']).name, 'nous') // the group is multi-select; one known builder still wins
  assert.equal(pick(['agent:default']).name, 'claude')
})

test('backend: a child of the agent label group reaches the runner as agent:<name>', async () => {
  const labelled = issue([], { labels: { nodes: [{ name: 'repo:sandbox' }, { name: 'nous', parent: { name: 'agent' } }, { name: 'nous', parent: { name: 'other' } }] } })
  const w = world([labelled], [], { authority: withBackends({ enabled: false }) })
  await w.run()
  assert.match(w.linear.activities().at(-1)!.body, /switched off/) // so the group child was seen as agent:nous, and the unrelated parent was not
})

test('backend: a switched-off, unset or doubled backend asks and starts nothing', async () => {
  for (const [labels, auth, want] of [[['agent:nous'], withBackends({ enabled: false }), /switched off/], [[], { ...withBackends(), backends: { ...withBackends().backends, default: 'gpt' } }, /not set up/],
    [['agent:nous', 'agent:claude'], withBackends(), /2 builder labels/]] as [string[], unknown, RegExp][]) {
    const w = world([issue(['repo:sandbox', ...labels])], [], { authority: auth })
    await w.run()
    assert.equal(w.launches.length, 0, labels.join())
    assert.equal(w.verifies(), 0)
    assert.match(w.linear.activities().at(-1)!.body, want)
    assert.deepEqual(w.linear.updates(), [{ delegateId: null }])
  }
})

test('backend: no agent label still uses the Claude launch, even with a nous backend configured', async () => {
  const w = world([issue(['repo:sandbox'])], ['COMPLETE: done'], { authority: withBackends() })
  await w.run()
  assert.equal(w.launches.length, 1)
})

/** A fake Nous chat completions API that replies with `text` and records each request. */
async function fakeNous(text: string) {
  const requests: { auth: string, body: any }[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', d => { raw += d })
    req.on('end', () => { requests.push({ auth: String(req.headers.authorization), body: JSON.parse(raw) }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })) })
  })
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  return { requests, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, close: () => server.close() }
}

test('backend: agent:nous runs the Nous tool loop end to end, the Claude launch is never called, and it stops at a pull request', async () => {
  const api = await fakeNous('COMPLETE: footer fixed')
  try {
    const w = world([issue(['repo:sandbox', 'agent:nous'])], [], { authority: withBackends({ base_url: api.url }), env: { PATH: process.env.PATH ?? '', LINEAR_NOUS_API_KEY: 'fixture-key-not-real' } })
    await w.run()
    assert.equal(w.launches.length, 0) // the Claude launch
    assert.equal(api.requests.length, 1)
    assert.equal(api.requests[0]!.auth, 'Bearer fixture-key-not-real')
    assert.match(api.requests[0]!.body.messages[1].content, /Fix the footer/) // the same prompt the Claude builder gets
    assert.equal(w.verifies(), 1) // the verifier still grades it
    assert.match(w.linear.activities().map(a => a.body).join('\n'), /builder nous \(free\/model:free\)/)
    // sandbox is early-dev, where Claude would merge; this backend may not (may_merge false), so it ends at a pull request.
    assert.deepEqual(ghCommands(w).filter(c => c === 'pr merge'), [])
    assert.ok(ghCommands(w).includes('pr create'))
    assert.deepEqual(w.linear.updates().at(-1), { stateId: 'st-review', delegateId: null })
  } finally { api.close() }
})

test('backend: may_merge true lets a Nous run merge by the same tier rules', async () => {
  const api = await fakeNous('COMPLETE: footer fixed')
  try {
    const w = world([issue(['repo:sandbox', 'agent:nous'])], [], { authority: withBackends({ base_url: api.url, may_merge: true }), env: { PATH: process.env.PATH ?? '', LINEAR_NOUS_API_KEY: 'fixture-key-not-real' } })
    await w.run()
    assert.ok(ghCommands(w).includes('pr merge'))
  } finally { api.close() }
})

test('backend: a missing key stops the Nous run with a plain reason and no key text', async () => {
  const w = world([issue(['repo:sandbox', 'agent:nous'])], [], { authority: withBackends(), env: { PATH: process.env.PATH ?? '' } })
  await w.run()
  assert.match(w.linear.activities().at(-1)!.body, /No Nous Portal key is set \(env name LINEAR_NOUS_API_KEY\)/)
})

test('a claude that is not logged in starts no work, logs one line and comments once on the issue', async () => {
  const w = world([issue(['repo:sandbox'])], [])
  const deps = { ...w.deps, checkLogin: () => ({ ok: false, reason: 'the claude program is not logged in' }) }
  assert.equal(await r.main(['--once'], deps), 0)
  assert.equal(w.launches.length, 0)
  assert.equal(w.logs.filter(l => /not picking up work/.test(l)).length, 1)
  const comments = w.linear.calls.filter(c => c.op === 'CommentCreate')
  assert.equal(comments.length, 1)
  assert.equal(w.linear.updates().length, 0) // the delegate stays set
})

test('a claude that is not logged in with nothing delegated still logs the one line', async () => {
  const w = world([], [])
  await r.main(['--once'], { ...w.deps, checkLogin: () => ({ ok: false, reason: 'the claude program is not logged in' }) })
  assert.equal(w.logs.filter(l => /not picking up work/.test(l)).length, 1)
})

test('a 401 on the first launch stops the queue: the second issue is not started and is told once', async () => {
  const w = world([issue(['repo:sandbox']), issue(['repo:sandbox'], { id: 'iss-2', identifier: 'ENG-2' })], [])
  const deps = { ...w.deps, launch: async () => ({ ok: false, summary: 'Failed to authenticate. API Error: 401 Invalid bearer token', usd: 0 }) }
  await r.main(['--once'], deps)
  assert.equal(w.linear.calls.filter(c => c.op === 'CommentCreate').length, 1)
  assert.equal(w.logs.filter(l => /not picking up work/.test(l)).length, 1)
})

test('the blocked activity and the issue comment share the standard format and stay under 700 characters', async () => {
  const w = world([issue(['repo:sandbox'])], [`BLOCKED capability: ${'y'.repeat(3000)}`], { env: { LINEAR_ARCHITECT: 'Architect' } })
  await w.run()
  const activity = w.linear.activities().at(-1)!.body
  assert.ok(activity.startsWith('**Blocked (capability):** '))
  assert.ok(activity.length <= 700, `activity is ${activity.length}`)
  const comment = String(w.linear.calls.find(c => c.op === 'CommentCreate')?.variables?.input?.body ?? '')
  assert.ok(comment.startsWith('**Blocked (capability):** '), comment)
  assert.ok(comment.length <= 700, `comment is ${comment.length}`)
})
