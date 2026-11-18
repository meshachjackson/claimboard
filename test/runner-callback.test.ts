// Tests for scripts/runner-callback.py, the signed callback to the orchestrator (docs/runner-actions.md, "Phase C";
//).
// No network: the script's send() gets a fake opener. Secrets here are made-up values.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const SECRET = 'fake-callback-secret-for-tests'
const hasPython = () => !spawnSync('python3', ['-V']).error

// Runs a Python snippet with the script loaded as `m`.
function py(body: string) {
  const code = [
    'import importlib.util, json, io, contextlib, urllib.error',
    "spec = importlib.util.spec_from_file_location('cb', 'scripts/runner-callback.py')",
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    body,
  ].join('\n')
  return spawnSync('python3', ['-I', '-c', code], { encoding: 'utf8' })
}

function cli(args: string[], env: Record<string, string> = {}) {
  return spawnSync('python3', ['-I', 'scripts/runner-callback.py', ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env },
  })
}

const base = ['--job-id', 'job-abc_123', '--step-id', 'STP-930297', '--status', 'served',
  '--output-ref', 'https://github.com/x/y/actions/runs/1', '--tokens-in', '200', '--tokens-out', '100']
const env = { VERA_CALLBACK_URL: 'https://orchestrator.test/webhook/status', VERA_CALLBACK_SECRET: SECRET }

test('callback: the body has exactly the seven contract keys, in canonical JSON', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const r = cli([...base, '--dry-run'], env)
  assert.equal(r.status, 0, r.stderr)
  const { body } = JSON.parse(r.stdout)
  const parsed = JSON.parse(body)
  assert.deepEqual(Object.keys(parsed).sort(), ['job_id', 'output_ref', 'status', 'step_id', 'tokens_in', 'tokens_out', 'verdict'])
  assert.deepEqual(parsed, { job_id: 'job-abc_123', step_id: 'STP-930297', status: 'served',
    output_ref: 'https://github.com/x/y/actions/runs/1', tokens_in: 200, tokens_out: 100, verdict: '' })
  // Canonical: sorted keys, no spaces.
  assert.equal(body, JSON.stringify(Object.fromEntries(Object.entries(parsed).sort(([a], [b]) => a.localeCompare(b)))))
})

test('callback: the HMAC matches one computed independently with Node crypto', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const before = Math.floor(Date.now() / 1000)
  const r = cli([...base, '--dry-run'], env)
  const { headers, body } = JSON.parse(r.stdout)
  // X-the orchestrator-Timestamp is Unix seconds; the signature covers "<timestamp>.<raw body>".
  const ts = headers['X-Orchestrator-Timestamp']
  assert.match(ts, /^\d+$/)
  assert.ok(Number(ts) >= before && Number(ts) <= Math.floor(Date.now() / 1000) + 1)
  const expected = 'sha256=' + createHmac('sha256', SECRET).update(Buffer.from(`${ts}.${body}`, 'utf8')).digest('hex')
  assert.equal(headers['X-Orchestrator-Signature'], expected)
  assert.notEqual(headers['X-Orchestrator-Signature'], 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex'), 'the timestamp is signed too')
  assert.notEqual(headers['X-Orchestrator-Signature'], 'sha256=' + createHmac('sha256', 'other-secret').update(`${ts}.${body}`).digest('hex'))
})

test('callback: two calls with the same inputs give byte-identical bodies and signatures', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const a = JSON.parse(cli([...base, '--dry-run'], env).stdout), b = JSON.parse(cli([...base, '--dry-run'], env).stdout)
  assert.equal(a.body, b.body)
  assert.equal(a.headers['X-Orchestrator-Idempotency-Key'], b.headers['X-Orchestrator-Idempotency-Key'])
  // Key order of the dict does not matter: same bytes either way.
  const p = py(`
x = m.payload('j1', 'STP-930001', 'served', 'r', 1, 2, 'PASS')
y = dict(reversed(list(x.items())))
print(m.body_bytes(x) == m.body_bytes(y), m.sign('s', 1700000000, m.body_bytes(x)) == m.sign('s', 1700000000, m.body_bytes(y)))
`)
  assert.equal(p.status, 0, p.stderr)
  assert.equal(p.stdout.trim(), 'True True')
})

test('callback: the dedupe key is callback:<job_id>:<status>', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const { headers } = JSON.parse(cli([...base, '--dry-run'], env).stdout)
  assert.equal(headers['X-Orchestrator-Idempotency-Key'], 'callback:job-abc_123:served')
  const v = JSON.parse(cli(['--job-id', 'j9', '--step-id', 'STP-930002', '--status', 'served', '--verdict', 'INCONCLUSIVE', '--dry-run'], env).stdout)
  assert.equal(v.headers['X-Orchestrator-Idempotency-Key'], 'callback:j9:served')
  assert.equal(JSON.parse(v.body).verdict, 'INCONCLUSIVE')
  assert.equal(JSON.parse(v.body).tokens_in, 0, 'no count given: 0 (0 when not metered)')
  for (const st of ['started', 'failed', 'needs_input']) {
    const r = JSON.parse(cli(['--job-id', 'j9', '--step-id', 'STP-930002', '--status', st, '--dry-run'], env).stdout)
    assert.equal(r.headers['X-Orchestrator-Idempotency-Key'], `callback:j9:${st}`)
  }
})

test('callback: an unknown status, a bad id, a bad or stray verdict and a non-https URL are refused', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const refused = (args: string[], e = env) => cli([...args, '--dry-run'], e).status === 2
  assert.ok(refused(['--job-id', 'j', '--step-id', 'STP-930001', '--status', 'done']))
  assert.ok(refused(['--job-id', 'j', '--step-id', 'STP-930001', '--status', 'succeeded']))
  assert.ok(refused(['--job-id', 'j', '--step-id', 'STP-930001', '--status', 'served', '--verdict', 'MAYBE']))
  assert.ok(refused(['--job-id', 'has space', '--step-id', 'STP-930001', '--status', 'started']))
  assert.ok(refused(['--job-id', 'j', '--step-id', 'TSK-930001', '--status', 'started']))
  assert.ok(refused(['--job-id', 'j', '--step-id', 'STP-930001', '--status', 'started', '--verdict', 'PASS']))
  assert.ok(refused(['--job-id', 'j', '--step-id', 'STP-930001', '--status', 'started', '--tokens-in', '-1']))
  assert.ok(refused(['--job-id', 'j', '--step-id', 'STP-930001', '--status', 'started'], { ...env, VERA_CALLBACK_URL: 'http://the orchestrator workflow.test/x' }))
})

test('callback: a missing URL or secret skips without failing', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  for (const e of [{}, { VERA_CALLBACK_URL: env.VERA_CALLBACK_URL }, { VERA_CALLBACK_SECRET: SECRET }]) {
    const r = cli(base, e)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /callback skipped/)
  }
})

test('callback: send posts the exact bytes with both headers, retries a 5xx, stops on a 4xx', t => {
  if (!hasPython()) return t.skip('python3 is not installed')
  const p = py(`
sent = []
class R:
    def __init__(self, code): self.status = code
    def __enter__(self): return self
    def __exit__(self, *a): return False
def opener_for(codes):
    def opener(req, timeout):
        sent.append((req.full_url, req.get_method(), req.data, dict(req.header_items())))
        code = codes.pop(0)
        if code >= 400: raise urllib.error.HTTPError(req.full_url, code, 'x', {}, None)
        return R(code)
    return opener
env = {'VERA_CALLBACK_URL': 'https://orchestrator.test/hook', 'VERA_CALLBACK_SECRET': 's'}
args = ['--job-id', 'j1', '--step-id', 'STP-930001', '--status', 'started']
with contextlib.redirect_stdout(io.StringIO()):
    rc = m.main(args, env=env, opener=opener_for([503, 200]), sleep=lambda s: None, clock=lambda: 1700000000.7)
url, method, data, hdrs = sent[-1]
body = m.body_bytes(m.payload('j1', 'STP-930001', 'started'))
print(rc, len(sent), url, method, data == body, hdrs.get('X-orchestrator-signature') == m.sign('s', 1700000000, body), hdrs.get('X-orchestrator-timestamp'), hdrs.get('X-orchestrator-idempotency-key'))
sent.clear()
with contextlib.redirect_stdout(io.StringIO()):
    rc = m.main(args, env=env, opener=opener_for([401]), sleep=lambda s: None)
print(rc, len(sent))
sent.clear()
with contextlib.redirect_stderr(io.StringIO()):
    rc = m.main(args, env=env, opener=opener_for([500, 502, 504]), sleep=lambda s: None)
print(rc, len(sent))
`)
  assert.equal(p.status, 0, p.stderr)
  assert.deepEqual(p.stdout.trim().split('\n'), [
    '0 2 https://orchestrator.test/hook POST True True 1700000000 callback:j1:started',
    '1 1',
    '1 3',
  ])
})
