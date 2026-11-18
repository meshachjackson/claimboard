// Static checks on the GitHub Actions runner workflow (docs/runner-actions.md). Nothing here runs the workflow or
// calls GitHub. It reads the two files and fails if a safety rule from the plan is broken.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseYaml } from './yaml-lite.ts'

const dir = new URL('../.github/workflows/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8')
const entry = parseYaml(read('runner-job.yml'))
const core = parseYaml(read('runner-core.yml'))
const steps: any[] = core.jobs.runner.steps
const checkouts = steps.filter(s => String(s.uses ?? '').startsWith('actions/checkout@'))

// Every [path, string] pair in a parsed document, so a rule can look at where a value sits.
function* strings(node: any, path: string[] = []): Generator<[string[], string]> {
  if (typeof node === 'string') yield [path, node]
  else if (Array.isArray(node)) for (const [n, v] of node.entries()) yield* strings(v, [...path, String(n)])
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) yield* strings(v, [...path, k])
}

test('both files parse and the jobs are the ones we expect', () => {
  assert.deepEqual(Object.keys(entry.jobs), ['guard', 'callback-start', 'run-readonly', 'run-publish', 'callback-end'])
  assert.deepEqual(Object.keys(core.jobs), ['runner'])
})

test('the entry file starts only on workflow_dispatch', () => {
  assert.deepEqual(Object.keys(entry.on), ['workflow_dispatch'])
  assert.deepEqual(Object.keys(core.on), ['workflow_call'])
})

test('inputs: card_id, spec_json, publish (boolean, default false), a required runner_sha, and the phase C job_id and step_id', () => {
  const inputs = entry.on.workflow_dispatch.inputs
  assert.deepEqual(Object.keys(inputs), ['card_id', 'spec_json', 'publish', 'runner_sha', 'egress_allowlist', 'job_id', 'step_id'])
  assert.equal(inputs.job_id.required, true)
  assert.equal(inputs.step_id.required, true)
  assert.equal(inputs.publish.type, 'boolean')
  assert.equal(inputs.publish.default, false)
  assert.equal(inputs.runner_sha.required, true)
  assert.equal(inputs.egress_allowlist.type, 'boolean')
  assert.equal(inputs.egress_allowlist.default, false)
  assert.equal(inputs.card_id.required, true)
  assert.equal(inputs.spec_json.required, true)
})

test('inputs are validated before use: card_id pattern and a full 40-character runner_sha', () => {
  const first = steps[0].run as string
  assert.ok(first.includes('^TSK-[0-9]{6}$'))
  assert.ok(first.includes('^[0-9a-f]{40}$'))
})

test('every checkout sets persist-credentials: false and there are exactly two', () => {
  assert.equal(checkouts.length, 2)
  for (const c of checkouts) {
    assert.equal(c.with['persist-credentials'], false)
    assert.equal(c.with['fetch-depth'] === 0 || c.with['fetch-depth'] === 1, true)
  }
  assert.equal(checkouts[0].with['fetch-depth'], 0, 'agent-board needs full history so origin/main exists without a fetch')
})

test('every action is pinned to a full commit id', () => {
  for (const s of steps.filter(s => s.uses)) assert.match(s.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, s.uses)
})

test('no run script contains ${{ }} (inputs reach scripts through env only)', () => {
  const all = [entry, core].flatMap(doc => Object.values<any>(doc.jobs).flatMap(j => j.steps ?? []))
  assert.ok(all.length > 5)
  for (const s of all.filter(s => s.run)) assert.ok(!s.run.includes('${{'), `expression in a run script: ${s.name}`)
})

test('no event or input text is used outside env and with', () => {
  for (const doc of [entry, core]) {
    for (const [path, value] of strings(doc.jobs)) {
      if (!/\$\{\{[^}]*(inputs\.|github\.event|github\.head_ref)/.test(value)) continue
      assert.ok(path.includes('env') || path.includes('with') || path.at(-1) === 'name' || path.at(-1) === 'if', path.join('.'))
    }
  }
})

test('secrets: ANTHROPIC_RUNNER_KEY only in the runner step env, LOCAL_LAB_READ_TOKEN only in the ops-repo checkout token (core), passed by name (entry)', () => {
  // Where each secret appears, as "<last three path parts>=<value>".
  const found: string[] = []
  for (const [path, v] of strings(core.jobs)) if (v.includes('secrets.')) found.push(`${path.slice(-3).join('.')}=${v}`)
  const checkoutAt = steps.indexOf(checkouts[1])
  const runAt = steps.findIndex(s => s.env?.LONNIE_ANTHROPIC_KEY)
  assert.deepEqual(found.sort(), [
    `${checkoutAt}.with.token=\${{ secrets.LOCAL_LAB_READ_TOKEN }}`,
    `${runAt}.env.LONNIE_ANTHROPIC_KEY=\${{ secrets.ANTHROPIC_RUNNER_KEY }}`,
  ].sort())
  assert.equal(steps.filter(s => s.env?.LONNIE_ANTHROPIC_KEY).length, 1)
  assert.equal(steps.filter(s => s.env?.LONNIE_GITHUB_TOKEN !== undefined).length, 1)
  assert.equal(steps.find(s => s.with?.repository)?.with.repository, '${{ vars.OPS_REPO }}')
  // The caller passes exactly those two secrets by name, in the two jobs that call the core file, and nowhere else.
  const pass = { ANTHROPIC_RUNNER_KEY: '${{ secrets.ANTHROPIC_RUNNER_KEY }}', LOCAL_LAB_READ_TOKEN: '${{ secrets.LOCAL_LAB_READ_TOKEN }}' }
  assert.deepEqual(entry.jobs['run-readonly'].secrets, pass)
  assert.deepEqual(entry.jobs['run-publish'].secrets, pass)
  // Plus the two callback secrets, twice each (start and end callback jobs). See the callback tests below.
  assert.equal(JSON.stringify(entry).split('secrets.').length - 1, 8)
  assert.ok(!JSON.stringify(entry).includes('github.token'))
})

test('the job token reaches only the runner step, and only for a publish run', () => {
  const token = steps.find(s => s.env?.LONNIE_GITHUB_TOKEN !== undefined)
  assert.equal(token.env.LONNIE_PROFILE, 'github-actions')
  assert.match(token.env.LONNIE_GITHUB_TOKEN, /inputs\.publish/)
  assert.ok(!read('runner-core.yml').split('\n').some(l => /GITHUB_TOKEN/.test(l) && !l.trim().startsWith('#') && !/LONNIE_GITHUB_TOKEN/.test(l)))
})

test('permissions are minimal: none at the top, read-only for a no-push run, write only for the publish job', () => {
  assert.deepEqual(entry.permissions, {})
  assert.deepEqual(entry.jobs.guard.permissions, {})
  assert.deepEqual(entry.jobs['run-readonly'].permissions, { contents: 'read' })
  assert.deepEqual(entry.jobs['run-publish'].permissions, { contents: 'write', 'pull-requests': 'write' })
  assert.deepEqual(entry.jobs['callback-start'].permissions, { contents: 'read' })
  assert.deepEqual(entry.jobs['callback-end'].permissions, { contents: 'read' })
  assert.match(entry.jobs['run-readonly'].if, /!inputs\.publish/)
  assert.match(entry.jobs['run-publish'].if, /inputs\.publish/)
  assert.ok(!/write/.test(JSON.stringify(entry.jobs.guard)))
  // The called workflow sets no permissions of its own, so it can never ask for more than its caller gave.
  assert.equal(core.permissions, undefined)
  assert.equal(core.jobs.runner.permissions, undefined)
})

test('jobs run in parallel, one copy per job_id, and a 60 minute limit', () => {
  assert.equal(entry.concurrency.group, 'runner-job-${{ inputs.job_id }}')
  assert.equal(entry.concurrency['cancel-in-progress'], false)
  assert.equal(core.jobs.runner['timeout-minutes'], 60)
})

test('the credential guard runs after the checkouts and before the runner', () => {
  const at = (needle: string) => steps.findIndex(s => (s.name ?? '').includes(needle))
  const guard = steps[at('credential')]
  assert.ok(guard.run.includes('extraheader') && guard.run.includes('credential') && guard.run.includes('^include'))
  assert.ok(at('credential') > steps.indexOf(checkouts[1]))
  assert.ok(at('credential') < steps.findIndex(s => s.env?.LONNIE_ANTHROPIC_KEY))
})

test('results: peak memory measured, summary written, artifact kept 90 days, missing job.json fails the job', () => {
  const run = steps.find(s => s.env?.LONNIE_ANTHROPIC_KEY)
  assert.ok(run.run.includes('/usr/bin/time -v'))
  assert.ok(run.run.includes('python3 -m lonnie.cli --spec'))
  assert.ok(steps.some(s => (s.run ?? '').includes('GITHUB_STEP_SUMMARY') && (s.run ?? '').includes('summary.md')))
  assert.equal(steps.find(s => String(s.uses).startsWith('actions/upload-artifact@')).with['retention-days'], 90)
  assert.ok(steps.at(-1).run.includes('job.json'))
})

test('the Claude Code CLI is pinned to an exact version and installed from npm, not piped into a shell', () => {
  assert.match(core.jobs.runner.env.CLAUDE_CODE_VERSION, /^\d+\.\d+\.\d+$/)
  const text = read('runner-core.yml')
  assert.ok(!/curl[^\n]*\|\s*(ba)?sh/.test(text))
  assert.ok(!/wget[^\n]*\|\s*(ba)?sh/.test(text))
})

const at = (needle: string) => steps.findIndex(s => (s.name ?? '').includes(needle))
const harnessAt = steps.findIndex(s => s.env?.LONNIE_ANTHROPIC_KEY)

test('egress: the filter step runs only for a publish run or when egress_allowlist is on, right before the harness', () => {
  const f = steps[at('Limit outbound hosts')]
  assert.ok(f, 'filter step missing')
  assert.match(f.if, /inputs\.publish \|\| inputs\.egress_allowlist/)
  assert.equal(at('Limit outbound hosts'), harnessAt - 1)
  assert.ok(at('Limit outbound hosts') > steps.findIndex(s => (s.run ?? '').includes('npm install')))
  assert.ok(f['timeout-minutes'] <= 5)
  assert.ok(f.run.includes('timeout 120') && f.run.includes('runner-egress.py') && f.run.includes(' apply'))
})

test('egress: the cleanup step is always(), has the same condition, and comes right after the harness', () => {
  const c = steps[at('Remove the outbound limit')]
  assert.ok(c, 'cleanup step missing')
  assert.match(c.if, /^\$\{\{ always\(\) && \(inputs\.publish \|\| inputs\.egress_allowlist\) \}\}$/)
  assert.equal(at('Remove the outbound limit'), harnessAt + 1)
  assert.ok(c.run.includes('runner-egress.py') && c.run.includes(' remove'))
  // Uploads and the summary come after the filter is gone.
  assert.ok(at('Remove the outbound limit') < steps.findIndex(s => String(s.uses).startsWith('actions/upload-artifact@')))
})

test('egress: neither step has an env block or a secret, and no inputs.* sits in a run body', () => {
  for (const name of ['Limit outbound hosts', 'Remove the outbound limit']) {
    const s = steps[at(name)]
    assert.equal(s.env, undefined, name)
    assert.ok(!s.run.includes('secrets.') && !s.run.includes('${{') && !s.run.includes('TOKEN'), name)
  }
})

test('egress: the entry file turns the filter on for a publish run and passes the switch through otherwise', () => {
  assert.equal(entry.jobs['run-publish'].with.egress_allowlist, true)
  assert.match(entry.jobs['run-readonly'].with.egress_allowlist, /inputs\.egress_allowlist/)
  assert.equal(core.on.workflow_call.inputs.egress_allowlist.default, false)
})

test('egress: the hosts file lists the four required hosts and no wildcard or other port', () => {
  const text = readFileSync(new URL('../scripts/runner-egress-hosts.txt', import.meta.url), 'utf8')
  const hosts = text.split('\n').map(l => l.split('#')[0].trim()).filter(Boolean)
  for (const h of ['github.com', 'api.github.com', 'api.anthropic.com', 'registry.npmjs.org']) assert.ok(hosts.includes(h), h)
  for (const h of hosts) assert.match(h, /^[a-z0-9][a-z0-9.-]*$/, h)
})

// Dry run of the real script: it prints the iptables commands and changes nothing. Hosts are IPv4 literals so no DNS is needed.
function dryRun(action: string, hostsText: string, extra: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'egress-'))
  writeFileSync(join(dir, 'hosts.txt'), hostsText)
  writeFileSync(join(dir, 'resolv.conf'), 'nameserver 127.0.0.53\nnameserver 10.9.8.7\n')
  const r = spawnSync('python3', ['-I', 'scripts/runner-egress.py', action, '--dry-run', '--fast', '--no-peers',
    '--hosts', join(dir, 'hosts.txt'), '--resolv', join(dir, 'resolv.conf'), ...extra], { encoding: 'utf8' })
  rmSync(dir, { recursive: true })
  return r
}

test('egress script: dry-run apply builds the chain, switches it on last, rejects the rest, keeps DNS and existing connections', t => {
  if (spawnSync('python3', ['-V']).error) return t.skip('python3 is not installed')
  const r = dryRun('apply', '# comment\n1.2.3.4\n5.6.7.8\n')
  assert.equal(r.status, 0, r.stderr)
  const lines = r.stdout.trim().split('\n')
  const jump = lines.findIndex(l => l.startsWith('iptables -w -I OUTPUT 1 -j RUNNER_EGRESS'))
  assert.ok(jump > 0)
  assert.ok(lines.slice(0, jump).some(l => l.includes('--ctstate ESTABLISHED,RELATED -j ACCEPT')))
  assert.ok(lines.some(l => l.includes('-d 10.9.8.7 -p udp --dport 53 -j ACCEPT')))
  assert.ok(!lines.some(l => l.includes('127.0.0.53')))
  assert.ok(lines.some(l => l.includes('-d 1.2.3.4 -p tcp --dport 443 -j ACCEPT')))
  const rej = lines.findIndex(l => l.endsWith('-A RUNNER_EGRESS -j REJECT'))
  assert.ok(rej > lines.findIndex(l => l.includes('-d 5.6.7.8')) && rej < jump)
  assert.ok(lines.some(l => l.startsWith('ip6tables -w -I OUTPUT 1 -j RUNNER_EGRESS')))
})

test('egress script: a host that does not resolve stops it before any rule is added', t => {
  if (spawnSync('python3', ['-V']).error) return t.skip('python3 is not installed')
  const r = dryRun('apply', '1.2.3.4\nno-such-host.invalid\n')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /did not resolve: no-such-host\.invalid/)
  assert.ok(!r.stdout.includes('iptables'))
})

test('egress script: a bad hosts line is refused, and remove deletes the jump, the rules and the chain', t => {
  if (spawnSync('python3', ['-V']).error) return t.skip('python3 is not installed')
  assert.notEqual(dryRun('apply', '*.blob.core.windows.net\n').status, 0)
  const r = dryRun('remove', '')
  assert.equal(r.status, 0)
  for (const tool of ['iptables', 'ip6tables']) {
    for (const flag of ['-D OUTPUT -j RUNNER_EGRESS', '-F RUNNER_EGRESS', '-X RUNNER_EGRESS']) assert.ok(r.stdout.includes(`${tool} -w ${flag}`), `${tool} ${flag}`)
  }
})

// Runs a Python snippet against the real script's functions, with network and clock faked. `m` is the loaded module.
function pyRun(body: string) {
  const code = [
    'import importlib.util, json, sys, io, contextlib',
    "spec = importlib.util.spec_from_file_location('egress', 'scripts/runner-egress.py')",
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    body,
  ].join('\n')
  return spawnSync('python3', ['-I', '-c', code], { encoding: 'utf8' })
}
const hasPython = () => !spawnSync('python3', ['-V']).error

test('egress script: /meta git, api and web ranges are parsed (IPv4 only, no actions list) and added as rules', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const meta = { git: ['192.30.252.0/22', '2a0a:a440::/29'], api: ['140.82.112.0/20'], web: ['185.199.108.0/22'], actions: ['20.1.2.3/32'] }
  const p = pyRun(`
print(sorted(m.parse_meta(${JSON.stringify(JSON.stringify(meta))})))
print(sorted(m.rules(set(), [], set(), {'192.30.252.0/22'})[-3]))
`)
  assert.equal(p.status, 0, p.stderr)
  const [parsed, rule] = p.stdout.trim().split('\n')
  assert.equal(parsed, "['140.82.112.0/20', '185.199.108.0/22', '192.30.252.0/22']")
  assert.ok(rule.includes('192.30.252.0/22') && rule.includes('443'), rule)
})

test('egress script: a dry run with github.com in the list adds the /meta ranges before the reject rule', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const p = pyRun(`
import tempfile, pathlib, types
d = pathlib.Path(tempfile.mkdtemp())
(d/'hosts.txt').write_text('github.com\\n')
(d/'meta.json').write_text(json.dumps({'git': ['192.30.252.0/22'], 'api': ['140.82.112.0/20'], 'web': ['185.199.108.0/22']}))
(d/'resolv.conf').write_text('nameserver 10.9.8.7\\n')
m.socket.getaddrinfo = lambda h, *a, **k: [(2, 1, 6, '', ('140.82.113.3', 443))]
out = io.StringIO()
with contextlib.redirect_stdout(out):
    rc = m.main(['apply', '--dry-run', '--fast', '--no-peers', '--hosts', str(d/'hosts.txt'), '--resolv', str(d/'resolv.conf'), '--meta-file', str(d/'meta.json')])
lines = out.getvalue().splitlines()
print(rc)
for c in ('192.30.252.0/22', '140.82.112.0/20', '185.199.108.0/22', '140.82.113.3'):
    print(any(('-d ' + c + ' -p tcp --dport 443 -j ACCEPT') in l for l in lines))
print(max(i for i, l in enumerate(lines) if '-d 185.199.108.0/22' in l) < next(i for i, l in enumerate(lines) if l.endswith('-A RUNNER_EGRESS -j REJECT')))
print(any(l.startswith('egress filter on:') and '3 github ranges' in l for l in lines))
`)
  assert.equal(p.status, 0, p.stderr)
  assert.equal(p.stdout.trim().split('\n').join(' '), '0 True True True True True True')
})

test('egress script: when /meta cannot be read it fails closed, adds no rule and says so', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const p = pyRun(`
import tempfile, pathlib, urllib.error
d = pathlib.Path(tempfile.mkdtemp())
(d/'hosts.txt').write_text('github.com\\n')
(d/'resolv.conf').write_text('nameserver 10.9.8.7\\n')
m.socket.getaddrinfo = lambda h, *a, **k: [(2, 1, 6, '', ('140.82.113.3', 443))]
def boom(*a, **k): raise urllib.error.URLError('offline')
m.urllib.request.urlopen = boom
m.time.sleep = lambda s: None
out, err = io.StringIO(), io.StringIO()
with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
    rc = m.main(['apply', '--dry-run', '--fast', '--no-peers', '--hosts', str(d/'hosts.txt'), '--resolv', str(d/'resolv.conf')])
print(rc, 'iptables' in out.getvalue(), 'github ranges unavailable' in err.getvalue(), 'refusing to turn the filter on' in err.getvalue())
for bad in ('not json', '{}', json.dumps({'git': [], 'api': ['1.2.3.0/24'], 'web': ['1.2.3.0/24']}), json.dumps({'git': ['nope'], 'api': ['1.2.3.0/24'], 'web': ['1.2.3.0/24']}), json.dumps({'git': ['2a0a::/29'], 'api': ['2a0a::/29'], 'web': ['2a0a::/29']})):
    try:
        m.parse_meta(bad); print('accepted')
    except ValueError:
        print('refused')
`)
  assert.equal(p.status, 0, p.stderr)
  assert.equal(p.stdout.trim().split('\n').join(' '), '1 False True True refused refused refused refused refused')
})

test('egress script: names are resolved in three passes and the answers are joined', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const p = pyRun(`
calls, sleeps = [], []
def fake(h, *a, **k):
    calls.append(h)
    n = calls.count(h)
    if h == 'flaky.example' and n == 2: raise OSError('temporary')
    return [(2, 1, 6, '', ('10.0.0.%d' % n, 443))]
got = m.resolve_all(['rr.example', 'flaky.example', 'gone.example'][:2], getaddrinfo=fake, sleep=sleeps.append)
print(sorted(got['rr.example']), sorted(got['flaky.example']), len(calls), len(sleeps))
`)
  assert.equal(p.status, 0, p.stderr)
  assert.equal(p.stdout.trim(), "['10.0.0.1', '10.0.0.2', '10.0.0.3'] ['10.0.0.1', '10.0.0.3'] 6 2")
})

test('egress script: the self-check connects to the four hosts, retries, and names the host that is refused', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const p = pyRun(`
print(m.SELF_CHECK == ('github.com', 'api.github.com', 'api.anthropic.com', 'registry.npmjs.org'))
tried = []
def ok_after_one_retry(h):
    tried.append(h)
    if h == 'api.github.com' and tried.count(h) == 1: raise ConnectionRefusedError('refused')
lines, bad = m.self_check(m.SELF_CHECK, connect=ok_after_one_retry, sleep=lambda s: None)
print(bad, len(lines), all(l.endswith(' ok') for l in lines), tried.count('api.github.com'))
def refuse_npm(h):
    if h == 'registry.npmjs.org': raise ConnectionRefusedError('refused')
lines, bad = m.self_check(m.SELF_CHECK, connect=refuse_npm, sleep=lambda s: None)
print(bad, lines[-1])
`)
  assert.equal(p.status, 0, p.stderr)
  const [same, good, refused] = p.stdout.trim().split('\n')
  assert.equal(same, 'True')
  assert.equal(good, 'None 4 True 2')
  assert.equal(refused, 'registry.npmjs.org self-check registry.npmjs.org:443 FAILED after 3 tries: refused')
})

test('egress script: a failed self-check removes the rules it added and exits 1 before the harness', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const p = pyRun(`
import tempfile, pathlib
d = pathlib.Path(tempfile.mkdtemp())
(d/'hosts.txt').write_text('1.2.3.4\\n')
(d/'resolv.conf').write_text('nameserver 10.9.8.7\\n')
cmds = []
m.run_cmd = lambda cmd, dry: (cmds.append(' '.join(cmd)), 1 if ' -D ' in ' '.join(cmd) else 0)[1]  # -D fails: no jump left to delete
m.self_check = lambda hosts: (['self-check github.com:443 ok', 'self-check api.anthropic.com:443 FAILED after 3 tries: refused'], 'api.anthropic.com')
out, err = io.StringIO(), io.StringIO()
with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
    rc = m.main(['apply', '--fast', '--no-peers', '--hosts', str(d/'hosts.txt'), '--resolv', str(d/'resolv.conf')])
last = [c for c in cmds if ' -D OUTPUT' in c or ' -X ' in c]
print(rc, 'api.anthropic.com:443 was refused' in err.getvalue(), 'self-check github.com:443 ok' in out.getvalue(), len(last))
print(cmds.index('iptables -w -I OUTPUT 1 -j RUNNER_EGRESS') < cmds.index('iptables -w -D OUTPUT -j RUNNER_EGRESS'))
`)
  assert.equal(p.status, 0, p.stderr)
  assert.equal(p.stdout.trim().split('\n').join(' '), '1 True True 4 True')
})

test('egress: the filter step writes its summary on failure too, and the hosts it checks match the hosts file', () => {
  const f = steps[at('Limit outbound hosts')]
  assert.match(f.run, /trap write_summary EXIT/)
  assert.match(f.run, /self-check/)
  assert.ok(!f.run.includes('--no-self-check') && !f.run.includes('--meta-file') && !f.run.includes('--dry-run'))
  const script = readFileSync(new URL('../scripts/runner-egress.py', import.meta.url), 'utf8')
  const list = /^SELF_CHECK = \(([^)]*)\)/m.exec(script)![1].match(/'([^']+)'/g)!.map(x => x.slice(1, -1))
  assert.deepEqual(list, ['github.com', 'api.github.com', 'api.anthropic.com', 'registry.npmjs.org'])
  assert.match(script, /META_KEYS = \('git', 'api', 'web'\)/)
})

// Phase C: signed callbacks to the orchestrator (scripts/runner-callback.py, test/runner-callback.test.ts).
test('callbacks: ids are checked by the guard before anything runs', () => {
  const run = entry.jobs.guard.steps[0].run as string
  assert.ok(run.includes('^[A-Za-z0-9_-]{1,64}$') && run.includes('^STP-[0-9]{6,}$'))
  assert.match(entry.jobs.guard.steps[0].env.JOB_ID, /inputs\.job_id/)
  assert.match(entry.jobs.guard.steps[0].env.STEP_ID, /inputs\.step_id/)
})

test('callbacks: start after the guard, end always and after both run jobs', () => {
  const start = entry.jobs['callback-start'], end = entry.jobs['callback-end']
  assert.equal(start.needs, 'guard')
  assert.deepEqual(end.needs, ['guard', 'run-readonly', 'run-publish'])
  assert.equal(end.if, '${{ always() }}')
  assert.ok(start.steps.at(-1).run.includes('--status started'))
  const endRun = end.steps.at(-1).run as string
  assert.match(endRun, /status=failed/)
  assert.ok(endRun.includes('[ "$READONLY_RESULT" = success ] && [ "$STATE" = passed ]'))
  // A publish run that pushed and opened its draft PR ends as published (the ops repo publish.py), not passed.
  assert.ok(endRun.includes('[ "$PUBLISH_RESULT" = success ] && [ "$STATE" = published ]'))
  assert.ok(endRun.includes('--status "$status"'))
})

test('callbacks: the callback secrets sit only in the two callback steps, never in the core file', () => {
  for (const job of ['callback-start', 'callback-end']) {
    const step = entry.jobs[job].steps.at(-1)
    assert.equal(step.env.VERA_CALLBACK_URL, '${{ secrets.VERA_CALLBACK_URL }}')
    assert.equal(step.env.VERA_CALLBACK_SECRET, '${{ secrets.VERA_CALLBACK_SECRET }}')
    assert.ok(step.run.includes('python3 -I scripts/runner-callback.py'))
    const checkout = entry.jobs[job].steps[0]
    assert.match(checkout.uses, /^actions\/checkout@[0-9a-f]{40}$/)
    assert.equal(checkout.with['persist-credentials'], false)
    assert.equal(checkout.with['sparse-checkout'], 'scripts/runner-callback.py')
  }
  assert.ok(!read('runner-core.yml').includes('VERA_CALLBACK'))
})

test('callbacks: token counts flow from job.json through the core outputs to the end callback', () => {
  const outs = core.on.workflow_call.outputs
  for (const k of ['state', 'tokens_in', 'tokens_out']) {
    assert.equal(outs[k].value, `\${{ jobs.runner.outputs.${k} }}`)
    assert.equal(core.jobs.runner.outputs[k], `\${{ steps.record.outputs.${k} }}`)
  }
  const record = steps.find(s => s.id === 'record')
  assert.equal(record.if, '${{ always() }}')
  assert.ok(record.run.includes('job.json') && record.run.includes('GITHUB_OUTPUT') && record.run.includes('tokens_out'))
  const env = entry.jobs['callback-end'].steps.at(-1).env
  assert.equal(env.TOKENS_IN, '${{ needs.run-readonly.outputs.tokens_in || needs.run-publish.outputs.tokens_in }}')
  assert.equal(env.TOKENS_OUT, '${{ needs.run-readonly.outputs.tokens_out || needs.run-publish.outputs.tokens_out }}')
  assert.ok(entry.jobs['callback-end'].steps.at(-1).run.includes('--tokens-in "$TOKENS_IN" --tokens-out "$TOKENS_OUT"'))
})

test('actionlint, when it is installed', t => {
  const probe = spawnSync('actionlint', ['-version'])
  if (probe.error) return t.skip('actionlint is not installed')
  const r = spawnSync('actionlint', ['.github/workflows/runner-job.yml', '.github/workflows/runner-core.yml', '.github/workflows/runner-verify.yml'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})
