// The cloud worker (scripts/linear-job.mjs): one role, one phase, one issue per run. A fake Linear object, fake git, gh and
// GitHub Actions API, and a fake agent. No live call, no real claude, nothing leaves the process. All rows are synthetic.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let job: any, oauth: any, architect: any
before(async () => {
  job = await import('../scripts/linear-job.mjs')
  oauth = await import('../scripts/lib/linear-oauth.mjs')
  architect = await import('../scripts/linear-architect.mjs')
})

// A fixture, not the authority file. `sandbox` is the one cloud repo; `other` is early-dev but not on cloud_repos.
const AUTHORITY = {
  default_tier: 'live',
  tiers: {
    'early-dev': { push_branch: true, open_pr: true, merge: true, deploy: true, merge_requires: ['checks_pass', 'verifier_pass'] },
    'live': { push_branch: true, open_pr: true, merge: false, deploy: false, merge_requires: [] },
    'client': { push_branch: false, open_pr: false, merge: false, deploy: false, merge_requires: [] }
  },
  repos: { sandbox: 'early-dev', other: 'early-dev', 'catalyst-n8n': 'client' },
  cloud_repos: ['sandbox'],
  deploy_on_merge: { sandbox: { ships: 'a test deploy.', watch: 'the Vercel status', status_context: 'Vercel' } },
  architect_may_decide: ['scope', 'approach', 'naming'],
  always_owner: ['new_spend_or_vendor'],
  limits: { per_run_usd: 2, max_retries: 2, runs_per_day: 40 },
  backends: { default: 'claude', nous: { enabled: true, may_merge: false, model: 'test-model' } }
}
const USERS: Record<string, { id: string, name: string }> = {
  architect: { id: 'u-arch', name: 'Architect' }, builder: { id: 'u-build', name: 'Builder (cloud)' }, verifier: { id: 'u-ver', name: 'Verifier' }
}
const BY_NAME = Object.fromEntries(Object.values(USERS).map(u => [u.name, u]))
const SHA = 'a'.repeat(40), MERGE_SHA = 'b'.repeat(40)
const issue = (role: string, extra: Record<string, unknown> = {}) => ({
  id: 'iss-1', identifier: 'ENG-1', title: 'Add a footer line', url: 'https://linear.test/ENG-1', team: { id: 'team-1' },
  description: 'Show the build date.\n\n## Done when\n- `src/footer.ts` shows the build date\n- `pnpm test` passes',
  state: { id: 'st-todo', name: 'Todo', type: 'unstarted' }, delegate: USERS[role], labels: ['repo:sandbox'], notes: [] as string[], ...extra
})

type Write = [string, ...unknown[]]
/** A Linear client for one app user that records every write, in order. */
function fakeLinear(me: { id: string, name: string }, theIssue: unknown) {
  const writes: Write[] = []
  return {
    writes,
    viewer: async () => me,
    issue: async () => theIssue,
    delegatedIssues: async () => [theIssue],
    sessionFor: async () => 'sess-1',
    activity: async (_s: string, c: { type: string, body: string }) => { writes.push(['activity', c.type, c.body]) },
    note: async (_id: string, body: string) => { writes.push(['note', body]) },
    setDelegate: async (_id: string, user: string | null) => { writes.push(['delegate', user]) },
    moveIssue: async (_i: unknown, stage: { name?: string, type: string }, extra: { delegateId?: string | null } = {}) => {
      writes.push(['move', stage.name ?? stage.type, 'delegateId' in extra ? extra.delegateId : 'kept'])
      return stage.name ?? ''
    },
    findUser: async (name: string) => BY_NAME[name] ?? null
  }
}

type Opts = {
  env?: Record<string, string>, replies?: string[], verdict?: string, launchThrows?: boolean, gitThrows?: boolean,
  pr?: Record<string, unknown> | null, statuses?: unknown[][], runsToday?: number, authority?: unknown, branchExists?: boolean, ahead?: string
}
/** Everything main() reaches outside the process, faked, for one role's app user and one issue. */
function world(role: string, theIssue: ReturnType<typeof issue>, o: Opts = {}) {
  const linear = fakeLinear(USERS[role]!, theIssue)
  const git: string[][] = [], gh: string[][] = [], launches: { prompt: string, lists: { allow: string[], deny: string[] } }[] = [], outputs: Record<string, string>[] = []
  const logs: string[] = [], dispatched: unknown[] = []
  let pr = o.pr === undefined ? null : o.pr
  const statuses = [...(o.statuses ?? [])]
  const deps = {
    linearFor: () => linear,
    env: { AGENT_LOOP_ENABLED: 'true', ...o.env },
    authority: () => o.authority ?? AUTHORITY,
    checkout: '/work/sandbox',
    output: (v: Record<string, string>) => outputs.push(v),
    log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m),
    sleep: async () => {}, pause: async () => {},
    deployWait: { timeoutMs: 40, everyMs: 20 },
    policy: 'POLICY', stack: '',
    github: { runsSince: async () => o.runsToday ?? 1, activeTitles: async () => ['builder ENG-9'], dispatch: async (inputs: unknown) => { dispatched.push(inputs) } },
    launch: async (a: { prompt: string, lists: { allow: string[], deny: string[] } }) => {
      launches.push(a)
      if (o.launchThrows) throw new Error('boom')
      return { ok: true, summary: o.replies?.[launches.length - 1] ?? 'Changed the footer.\nCOMPLETE: footer shows the build date', usd: 0 }
    },
    verify: async () => ({ verdict: o.verdict ?? 'PASS', summary: `verifier says ${o.verdict ?? 'PASS'}`, detail: o.verdict === 'FAIL' ? 'The footer shows no date.\nVERDICT: FAIL' : 'VERDICT: PASS' }),
    git: (a: string[]) => {
      if (o.gitThrows) throw new Error('git exploded')
      git.push(a)
      const cmd = a.slice(2).join(' ')
      if (cmd === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'main\n', stderr: '' }
      if (cmd.startsWith('rev-parse --verify --quiet')) return { status: o.branchExists ? 0 : 1, stdout: '', stderr: '' }
      if (cmd.startsWith('rev-list --count')) return { status: 0, stdout: `${o.ahead ?? '1'}\n`, stderr: '' }
      if (cmd === 'rev-parse HEAD') return { status: 0, stdout: `${SHA}\n`, stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    },
    gh: (a: string[]) => {
      gh.push(a)
      const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' })
      if (a[0] === 'pr' && a[1] === 'view') return pr ? ok(JSON.stringify(pr)) : { status: 1, stdout: '', stderr: 'no pull requests found' }
      if (a[0] === 'pr' && a[1] === 'create') { pr = { url: 'https://github.test/pr/7', state: 'OPEN', headRefOid: SHA }; return ok('https://github.test/pr/7\n') }
      if (a[0] === 'pr' && a[1] === 'merge') { pr = { ...pr, state: 'MERGED', mergeCommit: { oid: MERGE_SHA } }; return ok() }
      if (a[0] === 'api') return ok(JSON.stringify({ statuses: statuses.shift() ?? [] }))
      return ok()
    }
  }
  const run = (args: string[]) => job.main(args, deps)
  return { linear, git, gh, launches, outputs, logs, dispatched, deps, run, writes: linear.writes }
}
const args = (role: string, phase = 'work', extra: string[] = []) => ['--role', role, '--issue', 'ENG-1', '--session', 'sess-1', '--repo', 'sandbox', '--phase', phase, ...extra]
const activities = (w: ReturnType<typeof world>) => w.writes.filter(x => x[0] === 'activity')
const moves = (w: ReturnType<typeof world>) => w.writes.filter(x => x[0] === 'move')

const PASSED = [`**Verifier: PASS** on ${SHA.slice(0, 7)}. verifier says PASS`]
const DESIGN = 'Approach: add the date to the footer.\nFiles: src/footer.ts\nRisks: none\nDecisions: none\nREADY: start with src/footer.ts'

test('architect: designs a new issue (no needs:design label), then delegates to Builder (cloud) and sets Building', async () => {
  const w = world('architect', issue('architect'), { replies: [DESIGN] })
  assert.equal(await w.run(args('architect')), 0)
  assert.deepEqual(moves(w)[0], ['move', 'Architecting', 'kept'])
  assert.ok(w.writes.some(x => x[0] === 'note' && String(x[1]).startsWith('**Design:**')))
  assert.deepEqual(moves(w).at(-1), ['move', 'Building', 'u-build'])
  assert.ok(w.launches[0]!.lists.deny.includes('Edit')) // read-only
})

test('architect: a --prompt (a comment reply) is answered as a response activity before the design', async () => {
  const w = world('architect', issue('architect'), { replies: ['The date comes from the build step.', DESIGN] })
  await w.run(args('architect', 'work', ['--prompt', 'Where does the date come from?']))
  assert.match(w.launches[0]!.prompt, /Where does the date come from\?/)
  assert.deepEqual(activities(w)[0], ['activity', 'response', 'The date comes from the build step.'])
  assert.deepEqual(moves(w).at(-1), ['move', 'Building', 'u-build'])
  // The workflow passes the comment as env LINEAR_JOB_PROMPT; text that looks like a flag stays text.
  const e = world('architect', issue('architect'), { replies: ['Noted.', DESIGN], env: { LINEAR_JOB_PROMPT: '--sweep please' } })
  await e.run(args('architect'))
  assert.match(e.launches[0]!.prompt, /--sweep please/)
  assert.equal(e.dispatched.length, 0)
})

test('builder work: builds on branch linear/<id>-run, model may not push, and passes the result to the publish step', async () => {
  const w = world('builder', issue('builder'))
  assert.equal(await w.run(args('builder')), 0)
  assert.ok(w.git.some(a => a.slice(2).join(' ') === 'checkout -B linear/eng-1-run'))
  assert.ok(w.launches[0]!.lists.deny.includes('Bash(git push*)'))
  assert.ok(w.launches[0]!.lists.deny.includes('Bash(gh *)'))
  assert.equal(w.outputs.at(-1)!.publish, 'true')
  assert.equal(w.outputs.at(-1)!.kind, 'complete')
  assert.equal(w.gh.length, 0) // the work step has no GitHub token and makes no gh call
  assert.deepEqual(moves(w), [['move', 'Building', 'kept']])
})

test('builder work: a retry after a Verifier FAIL continues the pushed branch and gets the FAIL as feedback', async () => {
  const fail = '**Verifier: FAIL** (attempt 1) on aaaaaaa.\nThe footer shows no date.'
  const w = world('builder', issue('builder', { notes: [fail] }), { branchExists: true })
  await w.run(args('builder'))
  assert.ok(w.git.some(a => a.slice(2).join(' ') === 'checkout -B linear/eng-1-run origin/linear/eng-1-run'))
  assert.match(w.launches[0]!.prompt, /A verifier failed your last attempt[\s\S]*The footer shows no date/)
})

test('builder publish: pushes, opens the pull request, then delegates to the Verifier and sets Verifying', async () => {
  const w = world('builder', issue('builder'), { env: { BUILD_PUBLISH: 'true', BUILD_KIND: 'complete', BUILD_SUMMARY: 'footer done' } })
  await w.run(args('builder', 'publish'))
  assert.ok(w.git.some(a => a.slice(2).join(' ') === 'push -u origin linear/eng-1-run'))
  assert.ok(w.gh.some(a => a[1] === 'create'))
  assert.ok(w.writes.some(x => x[0] === 'note' && String(x[1]).includes('https://github.test/pr/7') && String(x[1]).startsWith('**Handoff:** Builder (cloud) to Verifier')))
  assert.deepEqual(moves(w).at(-1), ['move', 'Verifying', 'u-ver'])
  assert.equal(w.gh.some(a => a[1] === 'merge'), false) // the builder never merges
})

test('builder: an `agent:nous` issue runs on the Nous launcher', async () => {
  const w = world('builder', issue('builder', { labels: ['repo:sandbox', 'agent:nous'] }))
  let used = ''
  ;(w.deps as Record<string, unknown>).launchers = { nous: (config: { model: string }) => async () => { used = config.model; return { ok: true, summary: 'COMPLETE: done', usd: 0 } } }
  await w.run(args('builder'))
  assert.equal(used, 'test-model')
  assert.equal(w.launches.length, 0)
})

test('builder: a needs_input block sets Blocked and hands the issue to Meshach (no delegate)', async () => {
  const w = world('builder', issue('builder'), { replies: ['BLOCKED needs_input: Which date format, US or ISO?'] })
  await w.run(args('builder'))
  assert.deepEqual(moves(w).at(-1), ['move', 'Blocked', null])
  assert.match(String(activities(w).at(-1)![2]), /I need an answer from Meshach \(needs_input\)/)
})

test('verifier work: PASS is passed on as a step output, with no merge and no delegate change in this step', async () => {
  const w = world('verifier', issue('verifier'))
  await w.run(args('verifier'))
  assert.deepEqual(w.outputs.at(-1), { verdict: 'PASS', sha: SHA })
  assert.equal(w.gh.length, 0)
  assert.ok(w.writes.some(x => x[0] === 'note' && String(x[1]).startsWith('**Verifier: PASS** on aaaaaaa')))
  assert.deepEqual(moves(w), [['move', 'Verifying', 'kept']])
})

test('verifier merge: after PASS the code merges the verified commit, waits for the Vercel status, posts the URL and sets Done', async () => {
  const w = world('verifier', issue('verifier', { notes: PASSED }), {
    env: { VERDICT: 'PASS', VERIFIED_SHA: SHA }, pr: { url: 'https://github.test/pr/7', state: 'OPEN', headRefOid: SHA },
    statuses: [[], [{ context: 'Vercel', state: 'success', target_url: 'https://deploy.test/x' }]]
  })
  await w.run(args('verifier', 'merge'))
  assert.deepEqual(w.gh.find(a => a[1] === 'merge'), ['pr', 'merge', 'https://github.test/pr/7', '--squash', '--match-head-commit', SHA])
  assert.ok(w.gh.some(a => a[0] === 'api' && a[1] === `repos/{owner}/{repo}/commits/${MERGE_SHA}/status`))
  assert.deepEqual(moves(w).map(m => m[1]), ['Deploying', 'completed'])
  assert.deepEqual(moves(w).at(-1), ['move', 'completed', null])
  assert.match(String(activities(w).at(-1)![2]), /Merged and deployed\. Vercel: https:\/\/deploy\.test\/x/)
})

test('verifier merge: a deploy status that never comes says "merged, deploy not confirmed" and leaves Deploying', async () => {
  const w = world('verifier', issue('verifier', { notes: PASSED }), { env: { VERDICT: 'PASS', VERIFIED_SHA: SHA }, pr: { url: 'https://github.test/pr/7', state: 'OPEN', headRefOid: SHA } })
  await w.run(args('verifier', 'merge'))
  assert.match(String(activities(w).at(-1)![2]), /^Merged, deploy not confirmed/)
  assert.deepEqual(moves(w).map(m => m[1]), ['Deploying'])
  assert.deepEqual(w.writes.at(-1), ['delegate', null])
})

test('verifier merge: a pull request that moved after the verdict is not merged', async () => {
  const w = world('verifier', issue('verifier', { notes: PASSED }), { env: { VERDICT: 'PASS', VERIFIED_SHA: SHA }, pr: { url: 'https://github.test/pr/7', state: 'OPEN', headRefOid: 'c'.repeat(40) } })
  await w.run(args('verifier', 'merge'))
  assert.equal(w.gh.some(a => a[1] === 'merge'), false)
  assert.deepEqual(moves(w).at(-1), ['move', 'Blocked', null])
})

test('verifier: FAIL posts "Verifier: FAIL" with the reasons and delegates back to Builder (cloud)', async () => {
  const w = world('verifier', issue('verifier'), { verdict: 'FAIL' })
  await w.run(args('verifier'))
  const note = w.writes.find(x => x[0] === 'note')!
  assert.match(String(note[1]), /^\*\*Verifier: FAIL\*\* \(attempt 1\)[\s\S]*The footer shows no date/)
  assert.deepEqual(moves(w).at(-1), ['move', 'Building', 'u-build'])
  assert.deepEqual(w.outputs.at(-1), { verdict: 'FAIL' })
})

test('verifier: past max_retries (counted from "Verifier: FAIL" comments) the issue goes to Meshach', async () => {
  const notes = ['**Verifier: FAIL** (attempt 1) on a.', '**Builder:** pull request ready.', '**Verifier: FAIL** (attempt 2) on a.']
  const w = world('verifier', issue('verifier', { notes }), { verdict: 'FAIL' })
  await w.run(args('verifier'))
  assert.match(String(w.writes.find(x => x[0] === 'note')![1]), /attempt 3/)
  assert.deepEqual(moves(w).at(-1), ['move', 'Blocked', null])
  assert.match(String(activities(w).at(-1)![2]), /failed the work 3 times \(max_retries is 2\)/)
})

test('a role that is not the issue\'s delegate exits with no change', async () => {
  const w = world('builder', issue('builder', { delegate: USERS.verifier }))
  assert.equal(await w.run(args('builder')), 0)
  assert.deepEqual(w.writes, [])
  assert.equal(w.launches.length, 0)
  assert.match(w.logs.at(-1)!, /delegated to Verifier, not Builder \(cloud\): nothing to do/)
})

test('a crash is reported to the Linear session, and the workflow\'s failure step reports one too', async () => {
  const w = world('builder', issue('builder'), { gitThrows: true })
  assert.equal(await w.run(args('builder')), 1)
  assert.deepEqual(activities(w).at(-1), ['activity', 'error', 'The builder job crashed: git exploded'])
  assert.deepEqual(w.outputs.at(-1), { reported: 'true' })
  const c = world('builder', issue('builder'))
  assert.equal(await c.run(['--report-crash', '--role', 'builder', '--issue', 'ENG-1', '--session', 'sess-1', '--run-url', 'https://github.test/run/1']), 0)
  assert.match(String(activities(c)[0]![2]), /stopped before it finished[\s\S]*https:\/\/github\.test\/run\/1/)
  assert.deepEqual(moves(c), [['move', 'Blocked', null]])
})

test('kill switch: with AGENT_LOOP_ENABLED not true the job posts "paused" and changes nothing else', async () => {
  const w = world('builder', issue('builder'), { env: { AGENT_LOOP_ENABLED: 'false' } })
  await w.run(args('builder', 'gate'))
  assert.equal(w.writes.length, 1)
  assert.match(String(w.writes[0]![2]), /^Paused: the cloud agent loop is switched off/)
  assert.deepEqual(w.outputs.at(-1), { go: 'false' })
  assert.equal(w.launches.length, 0)
})

test('run limit: over today\'s limit the gate stops; the limit comes from limits.runs_per_day, default 40', async () => {
  const over = world('builder', issue('builder'), { runsToday: 41 })
  await over.run(args('builder', 'gate'))
  assert.match(String(over.writes[0]![2]), /41 agent runs today is over the daily limit of 40/)
  assert.deepEqual(over.outputs.at(-1), { go: 'false' })
  const raised = world('builder', issue('builder'), { runsToday: 41, authority: { ...AUTHORITY, limits: { ...AUTHORITY.limits, runs_per_day: 50 } } })
  await raised.run(args('builder', 'gate'))
  assert.deepEqual(raised.outputs.at(-1), { go: 'true', session: 'sess-1' })
  const unset = world('builder', issue('builder'), { runsToday: 41, authority: { ...AUTHORITY, limits: { max_retries: 2 } } })
  await unset.run(args('builder', 'gate'))
  assert.match(String(unset.writes[0]![2]), /limit of 40/)
  assert.equal(job.RUNS_PER_DAY, 40)
})

test('a repo not on cloud_repos is refused for the builder and left alone (no writes) for the shared Architect', async () => {
  const w = world('builder', issue('builder', { labels: ['repo:other'] }))
  await w.run([...args('builder', 'gate').filter(a => a !== 'sandbox' && a !== '--repo')])
  assert.match(String(activities(w)[0]![2]), /other is not on cloud_repos/)
  assert.deepEqual(moves(w), [['move', 'Blocked', null]])
  const a = world('architect', issue('architect', { labels: ['repo:other'] }))
  await a.run(['--role', 'architect', '--issue', 'ENG-1', '--phase', 'gate'])
  assert.deepEqual(a.writes, [])
  // A job started for one repo on an issue labeled with another is refused too.
  const m = world('builder', issue('builder'))
  await m.run(['--role', 'builder', '--issue', 'ENG-1', '--repo', 'other', '--phase', 'gate'])
  assert.match(String(activities(m)[0]![2]), /started for other/)
})

test('the laptop Architect skips an issue whose repo is on cloud_repos', async () => {
  const theIssue = { ...issue('architect'), notes: ['**Blocked (dependency):** which date?'] }
  const linear = { ...fakeLinear(USERS.architect!, theIssue) }
  const logs: string[] = []
  let launched = 0
  await architect.main(['--once'], { linear, authority: () => AUTHORITY, launch: async () => { launched++; return { ok: true, summary: '' } }, checkLogin: () => ({ ok: true }), log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), confDir: '/tmp/none', policy: '', stack: '' })
  assert.equal(launched, 0)
  assert.ok(logs.some(l => /ENG-1: skipped, sandbox is on cloud_repos/.test(l)))
})

test('Linear tokens are minted per job with the client credentials grant from LINEAR_<ROLE>_CLIENT_ID and _SECRET', async () => {
  const sent: { url: string, body: string }[] = []
  const fetch = async (url: string, init: { body: string }) => { sent.push({ url, body: String(init.body) }); return { ok: true, status: 200, json: async () => ({ access_token: 'minted-not-real' }) } }
  assert.equal(await oauth.mintAppToken({ clientId: 'id-1', clientSecret: 'secret-1', fetch }), 'minted-not-real')
  const body = new URLSearchParams(sent[0]!.body)
  assert.equal(body.get('grant_type'), 'client_credentials')
  assert.equal(body.get('client_id'), 'id-1')
  assert.deepEqual(oauth.credentialNames('verifier'), { id: 'LINEAR_VERIFIER_CLIENT_ID', secret: 'LINEAR_VERIFIER_CLIENT_SECRET' })
  // main() mints with the role's own pair, then calls Linear with that token.
  const minted: unknown[] = [], auth: string[] = []
  const gql = async (_url: string, init: { headers: Record<string, string>, body: string }) => {
    auth.push(init.headers.authorization!)
    const op = /^(?:query|mutation)\s+(\w+)/.exec(JSON.parse(init.body).query)![1]
    const data = op === 'Me' ? { viewer: USERS.verifier } : { issue: { ...issue('verifier'), delegate: USERS.builder, labels: { nodes: [] }, comments: { nodes: [] } } }
    return { ok: true, status: 200, json: async () => ({ data }) }
  }
  const code = await job.main(args('verifier'), {
    env: { LINEAR_VERIFIER_CLIENT_ID: 'vid', LINEAR_VERIFIER_CLIENT_SECRET: 'vsecret' }, authority: () => AUTHORITY, fetch: gql,
    mint: async (x: unknown) => { minted.push(x); return 'job-token' }, log: () => {}, warn: () => {}
  })
  assert.equal(code, 0)
  assert.equal((minted[0] as { clientId: string }).clientId, 'vid')
  assert.ok(auth.every(a => a === 'Bearer job-token'))
})

test('sweep: dispatches each cloud issue with no queued or running job, skips one that has a job, and obeys the kill switch', async () => {
  const w = world('builder', issue('builder'))
  const nine = { ...issue('builder'), identifier: 'ENG-9' }, offList = { ...issue('builder'), identifier: 'ENG-3', labels: ['repo:other'] }
  ;(w.deps as Record<string, unknown>).linearFor = (role: string) => ({ viewer: async () => USERS[role], delegatedIssues: async () => role === 'builder' ? [issue('builder'), nine, offList] : [] })
  assert.equal(await w.run(['--sweep']), 0)
  assert.deepEqual(w.dispatched, [{ role: 'builder', issue: 'ENG-1', session: '', repo: 'sandbox' }]) // ENG-9 has a run; ENG-3 is not a cloud repo
  const off = world('builder', issue('builder'), { env: { AGENT_LOOP_ENABLED: 'false' } })
  await off.run(['--sweep'])
  assert.deepEqual(off.dispatched, [])
})

test('with no credentials the job stops before any network call and names the missing value', async () => {
  const logs: string[] = []
  let fetched = 0
  const code = await job.main(['--role', 'builder', '--issue', 'X', '--session', 'Y', '--dry-run'], { env: {}, authority: () => AUTHORITY, fetch: async () => { fetched++ }, log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) })
  assert.equal(code, 2)
  assert.equal(fetched, 0)
  assert.match(logs[0]!, /LINEAR_BUILDER_CLIENT_ID/)
})

test('the model never gets a GitHub token or the step-output files', () => {
  const env = job.modelEnv({ PATH: '/bin', GH_TOKEN: 'x', GITHUB_TOKEN: 'x', AGENT_GH_WRITE_TOKEN: 'x', GITHUB_OUTPUT: '/f', GITHUB_ENV: '/g', CLAUDE_CODE_OAUTH_TOKEN: 'login', LINEAR_BUILDER_CLIENT_SECRET: 's' })
  assert.deepEqual(env, { PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'login' })
})

test('linear-agent.yml: only the publish and merge steps hold the GitHub write token; the work step holds no GitHub token; no ${{ }} in run', async () => {
  const { readFileSync } = await import('node:fs')
  const { parseYaml } = await import('./yaml-lite.ts')
  const wf = parseYaml(readFileSync(new URL('../.github/workflows/linear-agent.yml', import.meta.url), 'utf8'))
  const steps: { name: string, env?: Record<string, string>, run?: string, with?: Record<string, string> }[] = wf.jobs.agent.steps
  const text = (s: unknown) => JSON.stringify(s)
  assert.deepEqual(steps.filter(s => text(s).includes('AGENT_GH_WRITE_TOKEN')).map(s => s.name), ['Publish (builder)', 'Merge (verifier)'])
  const work = steps.find(s => s.name.startsWith('Work'))!
  assert.doesNotMatch(text(work), /AGENT_GH_|github\.token|GITHUB_TOKEN|GH_TOKEN/)
  assert.doesNotMatch(text(wf.jobs.agent.env), /AGENT_GH_|github\.token/)
  for (const s of steps) assert.doesNotMatch(String(s.run ?? ''), /\$\{\{/, s.name)
  for (const s of steps.filter(s => String((s as { uses?: string }).uses ?? '').startsWith('actions/checkout@'))) assert.equal(String(s.with?.['persist-credentials']), 'false')
  assert.equal(wf.concurrency.group, 'linear-issue-${{ inputs.issue }}')
  assert.equal(String(wf.jobs.agent['timeout-minutes']), '45')
})

test('verifier merge: a PASS step output with no matching PASS comment on the issue (or a newer FAIL) is not merged', async () => {
  for (const notes of [[], [...PASSED, '**Verifier: FAIL** (attempt 1) on aaaaaaa.\nno']]) {
    const w = world('verifier', issue('verifier', { notes }), { env: { VERDICT: 'PASS', VERIFIED_SHA: SHA }, pr: { url: 'https://github.test/pr/7', state: 'OPEN', headRefOid: SHA } })
    await w.run(args('verifier', 'merge'))
    assert.equal(w.gh.some(a => a[1] === 'merge'), false)
    assert.deepEqual(moves(w).at(-1), ['move', 'Blocked', null])
  }
  assert.equal(job.passedOnIssue(PASSED, SHA), true)
})

test('verifier merge: a rerun after Linear moved the merged issue to Done still confirms the deploy', async () => {
  const w = world('verifier', issue('verifier', { notes: PASSED, state: { id: 'st-done', name: 'Done', type: 'completed' } }), {
    env: { VERDICT: 'PASS', VERIFIED_SHA: SHA }, pr: { url: 'https://github.test/pr/7', state: 'MERGED', headRefOid: SHA, mergeCommit: { oid: MERGE_SHA } },
    statuses: [[{ context: 'Vercel', state: 'success', target_url: 'https://deploy.test/y' }]]
  })
  await w.run(args('verifier', 'merge'))
  assert.equal(w.gh.some(a => a[1] === 'merge'), false)
  assert.match(String(activities(w).at(-1)![2]), /deploy\.test\/y/)
})

test('builder work: a retry that adds no new commit is not sent to the verifier again', async () => {
  const w = world('builder', issue('builder', { notes: ['**Verifier: FAIL** (attempt 1) on aaaaaaa.\nno date'] }), { branchExists: true, ahead: '0' })
  await w.run(args('builder'))
  assert.ok(w.git.some(a => a.slice(2).join(' ') === 'rev-list --count origin/linear/eng-1-run..HEAD'))
  assert.equal(w.outputs.some(o => o.publish === 'true'), false)
  assert.deepEqual(moves(w).at(-1), ['move', 'Blocked', null])
})

test('verifier: a check the verifier was refused goes to Meshach and is not counted as a FAIL', async () => {
  const w = world('verifier', issue('verifier'), { verdict: 'FAIL' })
  ;(w.deps as Record<string, unknown>).verify = async () => ({ verdict: 'FAIL', summary: 'x', detail: 'I could not run pnpm test: permission denied.\nVERDICT: FAIL' })
  await w.run(args('verifier'))
  assert.equal(w.writes.some(x => x[0] === 'note'), false)
  assert.deepEqual(moves(w).at(-1), ['move', 'Blocked', null])
})

test('sweep: one role failing in Linear does not stop the others', async () => {
  const w = world('builder', issue('builder'))
  ;(w.deps as Record<string, unknown>).linearFor = (role: string) => role === 'architect'
    ? { viewer: async () => { throw new Error('revoked') }, delegatedIssues: async () => [] }
    : { viewer: async () => USERS[role], delegatedIssues: async () => role === 'builder' ? [issue('builder')] : [] }
  await w.run(['--sweep'])
  assert.equal(w.dispatched.length, 1)
  assert.ok(w.logs.some(l => /architect: revoked/.test(l)))
})
