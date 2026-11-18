// The runner that works unattended. Test names start with the criterion id.
// Fake agent, fake verifier, fake git and a fake push stream: nothing here spends money or touches a repo.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
const types = await import('../app/types/board.ts')
types.setBoardOwner('person:meshach', 'Meshach')

const ME = { person: 'person:meshach' }
const mock = (file: string) => JSON.parse(readFileSync(new URL(`../mock/${file}`, import.meta.url), 'utf8'))
const NOW = '2026-10-30T12:00:00.000Z'

let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
let runOp: typeof import('../app/utils/boardOps.ts').runOp
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let r: any
before(async () => {
  ({ applyOp, runOp } = await import('../app/utils/boardOps.ts'))
  r = await import('../scripts/board-run.mjs')
})

const task = (over: object = {}) => ({
  task_id: 'TSK-1', title: 'Fix the thing', original_request: 'Fix the thing', acceptance_requirements: 'It works', task_type: 'build', proposed_assignee: '', assignee: '',
  upgrade_target: '', execution_policy: '', approval_state: 'not_required', work_state: 'backlog', current_step: 0, steps_total: 0, outputs_ref: '',
  internal_verification: 'none', macro_verification: 'none', escalation: 'none', priority: 'normal', project_id: 'agent-board', created_by: 'person:meshach',
  created_at: NOW, due_at: null, updated_by: 'x', updated_at: NOW, stage: 'backlog', tags: '', ...over
}) as never
const step = (over: object = {}) => ({
  step_id: 'STP-1', task_id: 'TSK-1', step_no: 1, assignee: 'agt-run', goal: 'builder: Fix the thing', input_ref: '', target_action: 'draft', target_ticket_ref: '',
  step_state: 'awaiting_pull', stop_reason: '', verdict: '', budget_used: '', output_ref: '', output_summary: '', vera_ticket_ref: '', created_at: NOW,
  dispatched_at: null, ended_at: null, updated_at: NOW, claim_key: 'pull:STP-1', lease_owner: '', lease_expires_at: null, acked_at: null, cancelled: false,
  claim_count: 0, last_claimed_at: null, role: 'builder', activity: '', heartbeat_at: null, ...over
}) as never
const agent = (id: string, type: string, status = 'active') => ({ agent_id: id, name: id, lifecycle_status: status, agent_type: type }) as never
const board = (tasks: object[], steps: object[] = [], registry = [agent('agt-run', ''), agent('agt-b', 'builder'), agent('agt-off', '', 'retired')]) =>
  ({ tasks: tasks as never[], steps: steps as never[], notes: [] as never[], columns: mock('board_columns.json'), registry: registry as never[] })
const run = (b: ReturnType<typeof board>, op: string, args: object) => applyOp(b, op, args as never, ME as never, Date.parse(NOW) + 1000)
const stepsOf = (b: ReturnType<typeof board>) => b.steps as unknown as { assignee: string, step_state: string, cancelled: boolean }[]

test('R1: Start gives an unassigned card to the default runner; a blank, unknown or retired runner uses the pool; an assignee is kept', () => {
  assert.equal(types.defaultRunner(), '')
  const pool = board([task()])
  run(pool, 'start_task', { task_id: 'TSK-1', updated_at: NOW })
  assert.equal(stepsOf(pool)[0]!.assignee, 'pool:builder')

  types.setDefaultRunner('agt-run')
  try {
    const b = board([task()])
    assert.equal(run(b, 'start_task', { task_id: 'TSK-1', updated_at: NOW }).ok, true)
    assert.equal(stepsOf(b)[0]!.assignee, 'agt-run')
    assert.equal((b.tasks[0] as unknown as { assignee: string }).assignee, 'agt-run')

    const kept = board([task({ assignee: 'agt-b' })])
    run(kept, 'start_task', { task_id: 'TSK-1', updated_at: NOW })
    assert.equal(stepsOf(kept)[0]!.assignee, 'agt-b')

    for (const id of ['agt-nobody', 'agt-off']) {
      types.setDefaultRunner(id)
      const c = board([task()])
      run(c, 'start_task', { task_id: 'TSK-1', updated_at: NOW })
      assert.equal(stepsOf(c)[0]!.assignee, 'pool:builder', id)
    }
    types.setDefaultRunner('agt-run')
    const restart = board([task({ stage: 'build', work_state: 'blocked' })], [step({ step_state: 'failed', assignee: 'pool:builder' })])
    run(restart, 'start_task', { task_id: 'TSK-1', updated_at: NOW })
    assert.equal(stepsOf(restart).filter(s => !s.cancelled).at(-1)!.assignee, 'agt-run')
  } finally { types.setDefaultRunner('') }
  assert.throws(() => types.setDefaultRunner('bad id'))
})

test('R2: pickNext returns a builder step whose lease lapsed, not one with a live lease', () => {
  const t = [task({ task_id: 'T-A' }), task({ task_id: 'T-B' })]
  const dead = step({ step_id: 'S-A', task_id: 'T-A', step_state: 'dispatched', claim_count: 1, lease_expires_at: '2026-10-30T11:00:00.000Z' })
  const live = step({ step_id: 'S-B', task_id: 'T-B', step_state: 'dispatched', claim_count: 1, lease_expires_at: '2026-10-30T13:00:00.000Z' })
  assert.deepEqual(r.pickNext(t, [dead, live], [], 2, Date.parse(NOW)).map((s: { step_id: string }) => s.step_id), ['S-A'])
})

test('R3: resolveRepo finds <codeDir>/<project>, or says what to do', () => {
  const isRepo = (p: string) => p === '/code/agent-board'
  assert.deepEqual(r.resolveRepo(task(), { codeDir: '/code', isRepo }), { ok: true, repo: '/code/agent-board' })
  const none = r.resolveRepo(task({ project_id: '' }), { codeDir: '/code', isRepo })
  assert.equal(none.ok, false)
  assert.match(none.reason, /no project/)
  assert.match(none.reason, /Restart/)
  const missing = r.resolveRepo(task({ project_id: 'governance' }), { codeDir: '/code', isRepo })
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /governance/)
  assert.match(missing.reason, /Restart/)
})

test('R4: worktreeFor names the path and branch, cuts from origin/main or main, and reuses an existing worktree', () => {
  const calls: string[][] = []
  // withOrigin: origin/main exists. ahead: origin/main is an ancestor of local main (local is ahead or equal).
  const git = (withOrigin: boolean, ahead: boolean) => (a: string[]) => {
    calls.push(a)
    const status = a.includes('--verify') ? (withOrigin ? 0 : 1) : a.includes('--is-ancestor') ? (ahead ? 0 : 1) : 0
    return { status, stdout: '', stderr: '' }
  }
  const fresh = r.worktreeFor('/code/agent-board', 'TSK-930219', { exists: () => false, git: git(true, false) })
  assert.deepEqual([fresh.path, fresh.branch], ['/code/agent-board-tsk-930219', 'board/tsk-930219-run'])
  assert.deepEqual(calls.at(-1), ['-C', '/code/agent-board', 'worktree', 'add', '/code/agent-board-tsk-930219', '-b', 'board/tsk-930219-run', 'origin/main'])
  for (const [withOrigin, ahead, want] of [[true, true, 'main'], [false, false, 'main'], [true, false, 'origin/main']] as const) {
    calls.length = 0
    r.worktreeFor('/code/agent-board', 'TSK-930219', { exists: () => false, git: git(withOrigin, ahead) })
    assert.equal(calls.at(-1)!.at(-1), want, `${withOrigin} ${ahead}`)
  }
  calls.length = 0
  r.worktreeFor('/code/agent-board', 'TSK-930219', { exists: () => true, git: git(true, false) })
  assert.equal(calls.some(c => c.includes('add')), false)
})

test('R5: the agent command has an allowlist, a push ban and a cap; the verifier has no Edit or Write', () => {
  const list = (argv: string[], flag: string) => {
    const i = argv.indexOf(flag)
    const out: string[] = []
    for (let k = i + 1; k < argv.length && !argv[k]!.startsWith('--'); k++) out.push(argv[k]!)
    return out
  }
  const a = r.agentCommand({ worktree: '/wt', maxUsd: 2 })
  for (const flag of ['-p', '--strict-mcp-config']) assert.ok(a.includes(flag), flag)
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk')
  assert.equal(a[a.indexOf('--max-budget-usd') + 1], '2')
  assert.equal(a[a.indexOf('--add-dir') + 1], '/wt')
  assert.ok(list(a, '--allowedTools').includes('Bash(git *)') && list(a, '--allowedTools').includes('Edit'))
  for (const d of ['Bash(git push*)', 'Bash(rm -rf*)', 'Bash(vercel*)', 'Bash(gh pr merge*)', 'Bash(pnpm * add *)']) assert.ok(list(a, '--disallowedTools').includes(d), d)
  const v = r.verifierCommand({ worktree: '/wt', maxUsd: 2 })
  assert.equal(v[v.indexOf('--agent') + 1], 'loop-verifier')
  assert.equal(v[v.indexOf('--permission-mode') + 1], 'dontAsk')
  assert.equal(v[v.indexOf('--add-dir') + 1], '/wt')
  const tools = list(v, '--allowedTools')
  assert.equal(tools.includes('Edit') || tools.includes('Write'), false)
  assert.ok(tools.includes('Bash(grep *)') && tools.includes('Bash(wc *)'))
})

test('R6: childEnv drops tokens, secrets, passwords and keys but keeps PATH, HOME and the Anthropic key', () => {
  const out = r.childEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a', BOARD_RUN_TOKEN: 'x', BOARD_AGENT_TOKEN: 'y', GITHUB_TOKEN: 'z', db_password: 'p', STRIPE_KEY: 'k', MY_Secret: 's', LANG: 'en' })
  assert.deepEqual(Object.keys(out).sort(), ['ANTHROPIC_API_KEY', 'HOME', 'LANG', 'PATH'])
})

test('R7: gate stops on the kill switch and on the daily cap; recordSpend adds up per day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-gate-'))
  assert.equal(r.gate({ dir, dailyUsd: 5, today: '2026-10-30' }), '')
  r.recordSpend(dir, 2, '2026-10-30')
  assert.equal(r.recordSpend(dir, 1.5, '2026-10-30'), 3.5)
  assert.equal(r.gate({ dir, dailyUsd: 5, today: '2026-10-30' }), '')
  r.recordSpend(dir, 1.5, '2026-10-30')
  assert.match(r.gate({ dir, dailyUsd: 5, today: '2026-10-30' }), /daily/)
  assert.equal(r.gate({ dir, dailyUsd: 5, today: '2026-10-31' }), '')
  assert.equal(r.recordSpend(dir, 1, '2026-10-31'), 1)
  writeFileSync(join(dir, 'board-run.off'), '')
  assert.match(r.gate({ dir, dailyUsd: 50, today: '2026-10-31' }), /off/)
})

// A card in Build with one open builder step for agt-run, answered by the real op layer.
function live(over: object = {}) {
  const b = board([task({ stage: 'build', work_state: 'awaiting_start', assignee: 'agt-run', ...over })], [step()])
  const api = async (op: string, args: Record<string, unknown>) => {
    if (op !== 'get_task') return runOp(b as never, op, args, { agent_id: 'agt-run' }) as never
    const x = runOp(b as never, 'read_task', args, { agent_id: 'agt-run' }) as unknown as { rows: { tasks: unknown[], steps: unknown[], notes: unknown[] } }
    return { ok: true, task: x.rows.tasks[0], steps: x.rows.steps, notes: x.rows.notes }
  }
  return { b, api }
}

test('R8: prepare ok: launch and verify get cwd, the ref lands on the step and the card, spend is reported', async () => {
  const { b, api } = live()
  const seen: string[] = []
  let spent = 0
  const out = await r.runStep({
    api, task: b.tasks[0], step: b.steps[0],
    prepare: async () => ({ ok: true, cwd: '/wt/tsk-1' }),
    launch: async (o: { cwd: string }) => { seen.push(o.cwd); return { ok: true, summary: 'built it\nCOMPLETE: done', usd: 0.4 } },
    finish: async (o: { cwd: string }) => { seen.push(o.cwd); return { ref: 'board/tsk-1-run@abc1234', summary: '1 commit.' } },
    verify: async (o: { cwd: string }) => { seen.push(o.cwd); return { verdict: 'PASS', summary: 'ok', usd: 0.1 } },
    onSpend: (usd: number) => { spent += usd }
  })
  assert.deepEqual(out, { state: 'served', verdict: 'PASS' })
  assert.deepEqual(seen, ['/wt/tsk-1', '/wt/tsk-1', '/wt/tsk-1'])
  assert.equal(spent, 0.5)
  const s = b.steps[0] as unknown as { output_ref: string, target_ticket_ref: string }
  assert.equal(s.output_ref, 'board/tsk-1-run@abc1234')
  assert.equal(s.target_ticket_ref, 'board/tsk-1-run@abc1234')
  const t = b.tasks[0] as unknown as { stage: string, outputs_ref: string }
  assert.equal(t.stage, 'review')
  assert.ok(t.outputs_ref.includes('board/tsk-1-run@abc1234'))
})

test('R8b: prepare not ok parks the step with the reason and launches nothing', async () => {
  const { b, api } = live()
  let launched = false
  const out = await r.runStep({
    api, task: b.tasks[0], step: b.steps[0],
    prepare: async () => ({ ok: false, reason: 'No repo for this card. Set the project, then press Restart.' }),
    launch: async () => { launched = true; return { ok: true, summary: '' } },
    verify: async () => ({ verdict: 'PASS', summary: '' })
  })
  assert.equal(out.state, 'parked')
  assert.equal(launched, false)
  const s = b.steps[0] as unknown as { step_state: string, stop_reason: string }
  assert.equal(s.step_state, 'needs_input')
  assert.equal(s.stop_reason, 'No repo for this card. Set the project, then press Restart.')
  assert.equal((b.tasks[0] as unknown as { work_state: string }).work_state, 'needs_input')
})

test('R8c: no commit plus "no shell or key" parks the step; the same words after a commit are graded', async () => {
  assert.equal(r.blockedByEnvironment('Bash is denied in this session, so I cannot start the dev server.'), true)
  assert.equal(r.blockedByEnvironment('I added the filter boxes and the tests pass.'), false)
  const { b, api } = live()
  let graded = false
  const out = await r.runStep({
    api, task: b.tasks[0], step: b.steps[0],
    prepare: async () => ({ ok: true, cwd: '/wt/tsk-1' }),
    launch: async () => ({ ok: true, summary: 'I do not have the API key, so I cannot run the demo.\nCOMPLETE: done', usd: 0.2 }),
    finish: async () => ({ ref: '', summary: 'No commits on the branch.' }),
    verify: async () => { graded = true; return { verdict: 'FAIL', summary: '' } }
  })
  assert.equal(out.state, 'parked')
  assert.equal(graded, false)
  assert.equal((b.steps[0] as unknown as { step_state: string }).step_state, 'needs_input')
  const c = live()
  const kept = await r.runStep({
    api: c.api, task: c.b.tasks[0], step: c.b.steps[0],
    prepare: async () => ({ ok: true, cwd: '/wt/tsk-1' }),
    launch: async () => ({ ok: true, summary: 'Built it. I could not run the demo without a key.\nCOMPLETE: done', usd: 0.2 }),
    finish: async () => ({ ref: 'board/tsk-1-run@abc1234', summary: '1 commit.' }),
    verify: async () => ({ verdict: 'PASS', summary: '' })
  })
  assert.equal(kept.state, 'served')
})

test('R9: parseSse reads event and data from a chunk', () => {
  const got = r.parseSse('event: ready\ndata: {}\n\nevent: changed\ndata: {"at":1}\n\n')
  assert.deepEqual(got.map((e: { event: string }) => e.event), ['ready', 'changed'])
  assert.equal(got[1].data, '{"at":1}')
})

test('R9b: watch calls onChange within 2 seconds of a changed event and sends the bearer token', async () => {
  let auth = ''
  const server = createServer((req, res) => {
    auth = String(req.headers.authorization)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('event: changed\ndata: {}\n\n')
  })
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as { port: number }).port
  const ctl = new AbortController()
  const t0 = Date.now()
  const hit = new Promise<number>(ok => { r.watch({ url: `http://127.0.0.1:${port}`, token: 'fixture:agt-x', signal: ctl.signal, onChange: () => ok(Date.now() - t0) }).catch(() => {}) })
  const ms = await hit
  ctl.abort(); server.closeAllConnections(); server.close()
  assert.ok(ms < 2000, `took ${ms} ms`)
  assert.equal(auth, 'Bearer fixture:agt-x')
})

test('R10: the install script prints a plist and writes nothing without --yes', () => {
  const script = new URL('../scripts/install-board-run.sh', import.meta.url).pathname
  const plist = join(homedir(), 'Library', 'LaunchAgents', 'com.example.board-run.plist')
  const had = existsSync(plist)
  const printed = execFileSync('bash', [script, '--print'], { encoding: 'utf8', env: { ...process.env, LABEL_PREFIX: 'com.example' } })
  // The label prefix defaults to com.example (LABEL_PREFIX sets it), and the job carries its settings folder.
  for (const part of ['KeepAlive', 'ThrottleInterval', 'com.example.board-run', 'BOARD_RUN_CONF_DIR']) assert.ok(printed.includes(part), part)
  assert.equal(/TOKEN|fixture:/i.test(printed), false)
  const env = { ...process.env, LABEL_PREFIX: 'com.example' }
  assert.match(execFileSync('bash', [script], { encoding: 'utf8', env }), /Nothing installed/)
  assert.match(execFileSync('bash', [script, '--uninstall'], { encoding: 'utf8', env }), /Add --yes/)
  assert.equal(existsSync(plist), had) // the dry runs neither create nor remove the job
})

test('R5b: parseClaudeJson reads a result object and a list of events', () => {
  assert.deepEqual(r.parseClaudeJson('{"type":"result","result":" done ","total_cost_usd":0.25,"is_error":false}'), { summary: 'done', usd: 0.25, isError: false })
  const list = '[{"type":"system"},{"type":"result","result":"ok","total_cost_usd":1,"is_error":true}]'
  assert.deepEqual(r.parseClaudeJson(list), { summary: 'ok', usd: 1, isError: true })
  assert.deepEqual(r.parseClaudeJson('not json'), { summary: 'not json', usd: 0, isError: false })
})

test('R10b: --help names the environment variables, and a non-local URL with no token is refused', () => {
  const script = new URL('../scripts/board-run.mjs', import.meta.url).pathname
  const help = execFileSync(process.execPath, [script, '--help'], { encoding: 'utf8' })
  for (const part of ['BOARD_RUN_URL', 'BOARD_RUN_TOKEN', '--cap', '--once', '--only']) assert.ok(help.includes(part), part)
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, BOARD_RUN_URL: 'https://example.invalid' }
  assert.throws(() => execFileSync(process.execPath, [script, '--once'], { encoding: 'utf8', env, stdio: 'pipe' }), /usage/)
})

test('R8c: a failed prepare that throws parks the step instead of crashing', async () => {
  const { b, api } = live()
  const out = await r.runStep({ api, task: b.tasks[0], step: b.steps[0], prepare: async () => { throw new Error('git worktree add failed') },
    launch: async () => ({ ok: true, summary: '' }), verify: async () => ({ verdict: 'PASS', summary: '' }) })
  assert.equal(out.state, 'parked')
  assert.match((b.steps[0] as unknown as { stop_reason: string }).stop_reason, /git worktree add failed/)
})

test('R8d: no commits means no ref, and a PASS-less run still completes the step', async () => {
  const { b, api } = live()
  const out = await r.runStep({ api, task: b.tasks[0], step: b.steps[0], prepare: async () => ({ ok: true, cwd: '/wt' }),
    launch: async () => ({ ok: true, summary: 'nothing to do\nCOMPLETE: done' }), finish: async () => ({ ref: '', summary: 'No commits on the branch.' }),
    verify: async () => ({ verdict: 'FAIL', summary: 'no change' }) })
  assert.deepEqual(out, { state: 'served', verdict: 'FAIL' })
  assert.equal((b.steps[0] as unknown as { output_ref: string }).output_ref, '')
})

test('R2b: buildPrompt tells the agent to commit in its worktree and not to push', () => {
  const text = r.buildPrompt(task(), step(), [])
  assert.ok(text.includes('Commit your work'))
  assert.ok(text.includes('Do not push'))
})

test('R2c: a publish step may push a draft PR, and nothing else in the prompt changes the ban', () => {
  const text = r.buildPrompt(task(), { ...step(), target_action: 'publish' }, [])
  assert.ok(text.includes('draft pull request'))
  assert.ok(text.includes('Do not merge'))
  assert.ok(!text.includes('Do not push'))
  assert.ok(r.buildPrompt(task(), { ...step(), target_action: 'draft' }, []).includes('Do not push'))
})

test('R8e: the verifier\'s reasons are posted as a note on the card before the step is completed', async () => {
  const { b, api } = live()
  await r.runStep({ api, task: b.tasks[0], step: b.steps[0], prepare: async () => ({ ok: true, cwd: '/wt' }), launch: async () => ({ ok: true, summary: 'did it\nCOMPLETE: done' }),
    finish: async () => ({ ref: '', summary: '' }), verify: async () => ({ verdict: 'FAIL', summary: 'x', detail: 'Criterion 2 failed: the grep count was 3.' }) })
  const notes = b.notes as unknown as { kind: string, body: string }[]
  assert.ok(notes.some(n => n.kind === 'summary' && n.body.startsWith('Verifier FAIL: Criterion 2 failed')))
})

// ---------- Architect steps (plan only, read-only) ----------

const ARCH = 'agt-claude-code-macbook'
const archStep = (over: object = {}) => step({ step_id: 'STP-A', role: 'architect', assignee: ARCH, target_action: 'read', goal: 'architect: Plan the thing', claim_key: 'pull:STP-A', ...over })

test('A1: pickNext takes an architect step assigned to this runner, not another agent\'s or a pool one; builders unchanged', () => {
  const t = [task({ task_id: 'T-A' }), task({ task_id: 'T-B' }), task({ task_id: 'T-C' }), task({ task_id: 'T-D' })]
  const mine = archStep({ step_id: 'S-A', task_id: 'T-A' })
  const other = archStep({ step_id: 'S-B', task_id: 'T-B', assignee: 'agt-largo' })
  const pool = archStep({ step_id: 'S-C', task_id: 'T-C', assignee: 'pool:advisor' })
  const build = step({ step_id: 'S-D', task_id: 'T-D' })
  const ids = (steps: object[]) => r.pickNext(t, steps, [], 5, Date.parse(NOW)).map((s: { step_id: string }) => s.step_id)
  assert.deepEqual(ids([mine, other, pool, build]).sort(), ['S-A', 'S-D'])
  assert.deepEqual(ids([archStep({ step_id: 'S-A', task_id: 'T-A', cancelled: true })]), [])
})

test('A2: planCommand is read-only: no Edit or Write allowed, writes and git changes denied, push ban kept, one folder, capped', () => {
  const list = (argv: string[], flag: string) => {
    const i = argv.indexOf(flag)
    const out: string[] = []
    for (let k = i + 1; k < argv.length && !argv[k]!.startsWith('--'); k++) out.push(argv[k]!)
    return out
  }
  const a = r.planCommand({ worktree: '/wt', maxUsd: 2 })
  const allowed = list(a, '--allowedTools'), denied = list(a, '--disallowedTools')
  for (const w of ['Edit', 'Write', 'NotebookEdit', 'Bash(git commit*)', 'Bash(git push*)', 'Bash(git add*)']) {
    assert.equal(allowed.includes(w), false, `allowed ${w}`)
    assert.ok(denied.includes(w), `denied ${w}`)
  }
  assert.ok(allowed.includes('Read') && allowed.includes('Grep') && allowed.includes('Bash(git log*)'))
  assert.equal(allowed.some((t: string) => /pnpm|npm|node|python|mkdir/.test(t)), false)
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk')
  assert.equal(a[a.indexOf('--max-budget-usd') + 1], '2')
  assert.equal(a[a.indexOf('--add-dir') + 1], '/wt')
})

test('A3: buildPrompt gives an architect the plan prompt: read-only, CANNOT PLAN escape, no commit order', () => {
  const p = r.buildPrompt(task(), archStep(), [])
  assert.match(p, /architect/)
  assert.match(p, /BLOCKED capability/)
  assert.match(p, /Do not edit/)
  assert.doesNotMatch(p, /Commit your work/)
})

test('A4: a plan is posted as a proposal note and the step is served + PASS; the card waits for Approve plan', async () => {
  const b = board([task({ stage: 'architecture', work_state: 'awaiting_start', assignee: ARCH })], [archStep()])
  const api = async (op: string, args: Record<string, unknown>) => {
    if (op !== 'get_task') return runOp(b as never, op, args, { agent_id: ARCH }) as never
    const x = runOp(b as never, 'read_task', args, { agent_id: ARCH }) as unknown as { rows: { tasks: unknown[], steps: unknown[], notes: unknown[] } }
    return { ok: true, task: x.rows.tasks[0], steps: x.rows.steps, notes: x.rows.notes }
  }
  let spent = 0, verified = false
  const out = await r.runStep({
    api, task: b.tasks[0], step: b.steps[0],
    prepare: async () => ({ ok: true, cwd: '/wt/tsk-1' }),
    launch: async () => ({ ok: true, summary: '1. Add the filter to app/utils/x.ts.\n2. Test it.\nCOMPLETE: done', usd: 0.3 }),
    finish: async () => { throw new Error('architect must not look for commits') },
    verify: async () => { verified = true; return { verdict: 'PASS', summary: '' } },
    onSpend: (usd: number) => { spent += usd }
  })
  assert.deepEqual(out, { state: 'served', verdict: 'PASS' })
  assert.equal(verified, false)
  assert.equal(spent, 0.3)
  const s = b.steps[0] as unknown as { step_state: string, verdict: string, output_ref: string, output_summary: string, acked_at: string }
  assert.deepEqual([s.step_state, s.verdict, s.output_ref], ['served', 'PASS', 'plan:TSK-1/STP-A'])
  assert.ok(s.output_summary.includes('Add the filter') && s.acked_at)
  const notes = b.notes as unknown as { kind: string, body: string, step_id: string }[]
  const proposals = notes.filter(n => n.kind === 'proposal')
  assert.ok(proposals.length >= 1 && proposals.some(n => n.body.startsWith('1. Add the filter') && n.step_id === 'STP-A'))
  assert.equal((b.tasks[0] as unknown as { work_state: string }).work_state, 'needs_input')
  // The Approve plan op accepts it.
  assert.equal(run(b, 'approve_plan', { step_id: 'STP-A', updated_at: (b.steps[0] as unknown as { updated_at: string }).updated_at }).ok, true)
})

test('A5: "CANNOT PLAN:" parks the step in Needs you with the reason, posts no proposal and does not pass', async () => {
  const b = board([task({ stage: 'architecture', work_state: 'awaiting_start', assignee: ARCH })], [archStep()])
  const api = async (op: string, args: Record<string, unknown>) => {
    if (op !== 'get_task') return runOp(b as never, op, args, { agent_id: ARCH }) as never
    const x = runOp(b as never, 'read_task', args, { agent_id: ARCH }) as unknown as { rows: { tasks: unknown[], steps: unknown[], notes: unknown[] } }
    return { ok: true, task: x.rows.tasks[0], steps: x.rows.steps, notes: x.rows.notes }
  }
  const out = await r.runStep({
    api, task: b.tasks[0], step: b.steps[0],
    prepare: async () => ({ ok: true, cwd: '/wt/tsk-1' }),
    launch: async () => ({ ok: true, summary: 'CANNOT PLAN: the card needs changes in ops-repo, which is not in this folder.', usd: 0.1 })
  })
  assert.equal(out.state, 'blocked')
  const s = b.steps[0] as unknown as { step_state: string, stop_reason: string, verdict: string }
  assert.equal(s.step_state, 'needs_input')
  assert.match(s.stop_reason, /ops-repo/)
  assert.equal(s.verdict, '')
  assert.equal((b.notes as unknown as { kind: string }[]).some(n => n.kind === 'proposal'), false)
})

test('A6: an agent that errors fails the architect step with a reason; no repo parks it', async () => {
  const mk = () => {
    const b = board([task({ stage: 'architecture', work_state: 'awaiting_start', assignee: ARCH })], [archStep()])
    const api = async (op: string, args: Record<string, unknown>) => {
      if (op !== 'get_task') return runOp(b as never, op, args, { agent_id: ARCH }) as never
      const x = runOp(b as never, 'read_task', args, { agent_id: ARCH }) as unknown as { rows: { tasks: unknown[], steps: unknown[], notes: unknown[] } }
      return { ok: true, task: x.rows.tasks[0], steps: x.rows.steps, notes: x.rows.notes }
    }
    return { b, api }
  }
  const f = mk()
  const failed = await r.runStep({ api: f.api, task: f.b.tasks[0], step: f.b.steps[0], prepare: async () => ({ ok: true, cwd: '/wt' }), launch: async () => ({ ok: false, summary: 'out of budget' }) })
  assert.equal(failed.state, 'failed')
  assert.match((f.b.steps[0] as unknown as { stop_reason: string }).stop_reason, /out of budget/)
  const n = mk()
  const parked = await r.runStep({ api: n.api, task: n.b.tasks[0], step: n.b.steps[0], prepare: async () => ({ ok: false, reason: 'No repo. Set the project, then press Restart.' }), launch: async () => { throw new Error('no') } })
  assert.equal(parked.state, 'parked')
  const e = mk()
  const empty = await r.runStep({ api: e.api, task: e.b.tasks[0], step: e.b.steps[0], prepare: async () => ({ ok: true, cwd: '/wt' }), launch: async () => ({ ok: true, summary: '  ', usd: 0 }), pause: async () => {} })
  assert.equal(empty.state, 'blocked')
  assert.equal((e.b.steps[0] as unknown as { verdict: string }).verdict, '')
})

test('S1: a step id shared by two cards is skipped, the next step is picked, and the shared ids are named with their cards', () => {
  const t = [task({ task_id: 'T-A' }), task({ task_id: 'T-B' }), task({ task_id: 'T-C' })]
  const dupA = step({ step_id: 'S-DUP', task_id: 'T-A', created_at: '2026-10-30T10:00:00.000Z' })
  const dupB = step({ step_id: 'S-DUP', task_id: 'T-B', created_at: '2026-10-30T10:01:00.000Z' })
  const next = step({ step_id: 'S-NEXT', task_id: 'T-C', created_at: '2026-10-30T11:00:00.000Z' })
  const ids = r.pickNext(t, [dupA, dupB, next], [], 5, Date.parse(NOW)).map((s: { step_id: string }) => s.step_id)
  assert.deepEqual(ids, ['S-NEXT'])
  assert.deepEqual([...r.sharedStepIds([dupA, dupB, next])], [['S-DUP', ['T-A', 'T-B']]])
})

test('S2: a step the board refused (not_claimed) is left out for the rest of the cycle; the steps behind it are picked', async () => {
  const t = [task({ task_id: 'T-A' }), task({ task_id: 'T-B' })]
  const first = step({ step_id: 'S-1', task_id: 'T-A', created_at: '2026-10-30T10:00:00.000Z' })
  const second = step({ step_id: 'S-2', task_id: 'T-B', created_at: '2026-10-30T10:01:00.000Z' })
  const api = async (op: string) => op === 'get_task' ? { ok: true, steps: [], notes: [] } : { ok: false, reason: 'not_claimed' }
  const result = await r.runStep({ api, task: t[0], step: first })
  assert.equal(result.state, 'not_claimed')
  const ids = (skipped: Set<string>) => r.pickNext(t, [first, second], [], 1, Date.parse(NOW), skipped).slice(0, 1).map((s: { step_id: string }) => s.step_id)
  assert.deepEqual(ids(new Set()), ['S-1'])
  assert.deepEqual(ids(new Set(['T-A/S-1'])), ['S-2'])
})

test('S3: with unique step ids pickNext behaves as before', () => {
  const t = [task({ task_id: 'T-A', priority: 'low' }), task({ task_id: 'T-B', priority: 'urgent' })]
  const ids = r.pickNext(t, [step({ step_id: 'S-1', task_id: 'T-A' }), step({ step_id: 'S-2', task_id: 'T-B' })], [], 5, Date.parse(NOW)).map((s: { step_id: string }) => s.step_id)
  assert.deepEqual(ids, ['S-2', 'S-1'])
  assert.equal(r.sharedStepIds([step({ step_id: 'S-1', task_id: 'T-A' }), step({ step_id: 'S-1', task_id: 'T-A' })]).size, 0)
})

test('S4: the log line for a refused claim carries the board\'s reason; other results are unchanged', () => {
  const s = step({ step_id: 'S-1', task_id: 'T-A' }) as { task_id: string, step_id: string }
  assert.equal(r.resultLine(s, { state: 'not_claimed', reason: 'stale updated_at' }), 'T-A S-1: not_claimed (stale updated_at)')
  assert.equal(r.resultLine(s, { state: 'not_claimed' }), 'T-A S-1: not_claimed')
  assert.equal(r.resultLine(s, { state: 'served', verdict: 'PASS' }), 'T-A S-1: served PASS')
})
