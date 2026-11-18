// Static checks on the verifier workflow (docs/runner-actions.md, "Phase C"). Nothing here runs the workflow or calls
// GitHub. Plan: the ops repo (doctrine rules 1 and 3).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseYaml } from './yaml-lite.ts'

const text = readFileSync(new URL('../.github/workflows/runner-verify.yml', import.meta.url), 'utf8')
const wf = parseYaml(text)
const jobs: Record<string, any> = wf.jobs
const allSteps = Object.values(jobs).flatMap((j: any) => j.steps ?? [])
const stepNamed = (job: string, needle: string) => jobs[job].steps.find((s: any) => (s.name ?? '').includes(needle))

test('verify: starts only on workflow_dispatch', () => {
  assert.deepEqual(Object.keys(wf.on), ['workflow_dispatch'])
  assert.deepEqual(Object.keys(jobs), ['guard', 'overlap', 'verify', 'callback'])
})

test('verify: inputs are exactly the six', () => {
  const inputs = wf.on.workflow_dispatch.inputs
  // Content: ticket, criteria, diff_ref. Routing ids: job_id, step_id, runner_sha.
  assert.deepEqual(Object.keys(inputs), ['job_id', 'step_id', 'ticket', 'criteria', 'diff_ref', 'runner_sha'])
  for (const k of Object.keys(inputs)) {
    assert.equal(inputs[k].required, true, k)
    assert.equal(inputs[k].type, 'string', k)
  }
})

test('verify: permissions per job, no write anywhere', () => {
  assert.deepEqual(wf.permissions, {})
  assert.deepEqual(jobs.guard.permissions, {})
  assert.deepEqual(jobs.overlap.permissions, { 'pull-requests': 'read' })
  assert.deepEqual(jobs.verify.permissions, { contents: 'read' })
  assert.deepEqual(jobs.callback.permissions, { contents: 'read' })
  for (const [name, job] of Object.entries(jobs)) assert.ok(!/write/.test(JSON.stringify(job.permissions)), name)
  // The overlap job checks out no code; it only lists pull requests.
  assert.ok(!jobs.overlap.steps.some((s: any) => s.uses))
  assert.ok(stepNamed('overlap', 'List open').run.includes('gh pr list') && /--json [^\n]*files/.test(stepNamed('overlap', 'List open').run))
})

test('verify: never downloads an artifact or reads worker output', () => {
  for (const word of ['download-artifact', 'spec_json', 'ledger', 'summary.md', 'job.json']) assert.ok(!text.includes(word), word)
  // The verify job runs verify.py checks first, then review.py, and runs no branch code (no install, no test command).
  const names = jobs.verify.steps.map((s: any) => s.name)
  const checks = names.findIndex((n: string) => n.startsWith('Deterministic checks'))
  const review = names.findIndex((n: string) => n.startsWith('Review on a different model'))
  assert.ok(checks >= 0 && review > checks)
  assert.ok(jobs.verify.steps[checks].run.includes('python3 -m lonnie.verifier checks'))
  assert.ok(jobs.verify.steps[review].run.includes('python3 -m lonnie.verifier review'))
  for (const s of jobs.verify.steps) assert.ok(!/pnpm|npm |node |setup-node/.test(s.run ?? '') && !/setup-node/.test(s.uses ?? ''), s.name)
  // The model key reaches the review step only.
  const keyed = allSteps.filter((s: any) => JSON.stringify(s).includes('ANTHROPIC_RUNNER_KEY'))
  assert.equal(keyed.length, 1)
  assert.equal(keyed[0].env.LONNIE_ANTHROPIC_KEY, '${{ secrets.ANTHROPIC_RUNNER_KEY }}')
  assert.equal(keyed[0], jobs.verify.steps[review])
})

test('verify: verdict callback runs always()', () => {
  const cb = jobs.callback
  assert.equal(cb.if, '${{ always() }}')
  assert.deepEqual(cb.needs, ['guard', 'verify'])
  const post = cb.steps.at(-1)
  // A final status of served with the verdict; the verifier signs with its own secret.
  assert.ok(post.run.includes('python3 -I scripts/runner-callback.py') && post.run.includes('--status served') && post.run.includes('--verdict "$VERDICT"'))
  assert.ok(post.run.includes('case "$VERDICT" in PASS|FAIL|INCONCLUSIVE) ;; *) VERDICT=INCONCLUSIVE ;; esac'))
  assert.equal(post.env.VERA_CALLBACK_URL, '${{ secrets.VERA_CALLBACK_URL }}')
  assert.equal(post.env.VERA_CALLBACK_SECRET, '${{ secrets.VERA_VERIFIER_CALLBACK_SECRET }}')
  assert.ok(!text.includes('secrets.VERA_CALLBACK_SECRET'), 'the runner secret never reaches the verifier')
  assert.equal(post.env.VERDICT, '${{ needs.verify.outputs.verdict }}')
  // The callback secrets sit only in the callback job.
  assert.equal(allSteps.filter((s: any) => JSON.stringify(s).includes('VERA_CALLBACK_SECRET')).length, 1)
})

test('verify: every action is pinned to a full commit id', () => {
  const uses = allSteps.filter((s: any) => s.uses)
  assert.ok(uses.length >= 4)
  for (const s of uses) assert.match(s.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, s.uses)
  for (const s of uses.filter((s: any) => s.uses.startsWith('actions/checkout@'))) assert.equal(s.with['persist-credentials'], false)
})

test('verify: no run script contains ${{ }}', () => {
  for (const s of allSteps.filter((s: any) => s.run)) assert.ok(!s.run.includes('${{'), s.name)
  // Inputs reach scripts only through env and with.
  const walk = (node: any, path: string[]): void => {
    if (typeof node === 'string') {
      if (/\$\{\{[^}]*inputs\./.test(node)) assert.ok(path.includes('env') || path.includes('with') || path.at(-1) === 'name' || path.at(-1) === 'outputs', path.join('.'))
    } else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, [...path, k])
  }
  walk(jobs, [])
})

test('verify: routing ids accept ids only', () => {
  const run = jobs.guard.steps[0].run as string
  for (const pattern of ['^[A-Za-z0-9_-]{1,64}$', '^STP-[0-9]{6,}$', '^[0-9a-f]{40}$', '^TSK-[0-9]{6}$', '^claude/tsk-[0-9]{6}(-[a-z0-9]+){0,6}$']) {
    assert.ok(run.includes(pattern), pattern)
  }
  assert.ok(run.includes('refs/heads/main'))
  // The patterns, tried on sample values: ids pass, free text (where worker output could hide) does not.
  const re = (p: string) => new RegExp(p)
  assert.ok(re('^[A-Za-z0-9_-]{1,64}$').test('job-2026_11_05'))
  assert.ok(!re('^[A-Za-z0-9_-]{1,64}$').test('I think the fix is to'))
  assert.ok(re('^STP-[0-9]{6,}$').test('STP-930297') && !re('^STP-[0-9]{6,}$').test('STP-1 reasoning'))
  assert.ok(!re('^[0-9a-f]{40}$').test('main'))
  // The branch rule matches the ops repo publish.py BRANCH_RE.
  assert.ok(re('^claude/tsk-[0-9]{6}(-[a-z0-9]+){0,6}$').test('claude/tsk-930126-make-the-header-sticky'))
  assert.ok(!re('^claude/tsk-[0-9]{6}(-[a-z0-9]+){0,6}$').test('main'))
  // Every job that uses an id waits for the guard.
  for (const name of ['overlap', 'verify', 'callback']) assert.ok([jobs[name].needs].flat().includes('guard'), name)
  assert.match(jobs.verify.if, /needs\.guard\.result == 'success'/)
})
