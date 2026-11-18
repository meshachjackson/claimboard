// The one dispatcher and the finishing call.
// Fake agent, fake board api, no money spent. Test names say which rule they check.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import './instance-setup.ts'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
const d = await import('../app/utils/dispatch.ts')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let r: any
before(async () => { r = await import('../scripts/board-run.mjs') })

const NOW = '2026-11-06T12:00:00.000Z'
const TASK = { task_id: 'TSK-1', title: 'Fix it', original_request: 'Fix it', acceptance_requirements: 'It works', tags: '', priority: 'normal', project_id: 'agent-board' }
const STEP = { step_id: 'STP-1', task_id: 'TSK-1', role: 'builder', assignee: 'agt-claude-code-macbook', goal: 'Fix it', step_state: 'awaiting_pull', claim_key: 'k', updated_at: NOW, created_at: NOW, cancelled: false, acked_at: null }

/** A board api that accepts everything and records the calls. */
function fakeApi() {
  const calls: { op: string, args: Record<string, unknown> }[] = []
  const api = async (op: string, args: Record<string, unknown>) => {
    calls.push({ op, args })
    if (op === 'get_task') return { ok: true, task: TASK, steps: [], notes: [] }
    return { ok: true, rows: { steps: [{ ...STEP, updated_at: `t${calls.length}` }] } }
  }
  return { api, calls, last: (op: string) => calls.filter(c => c.op === op).at(-1)?.args }
}
const noPause = async () => {}
const finishFns = { finish: async () => ({ ref: 'board/tsk-1-run@abc', summary: '1 commit.' }), verify: async () => ({ verdict: 'PASS', summary: 'ok' }) }
const base = (f: ReturnType<typeof fakeApi>) => ({ api: f.api, task: TASK, step: STEP, prepare: async () => ({ ok: true, cwd: '/wt' }), pause: noPause, ...finishFns })

test('parseEnd: finds the last finishing line and strips it from the body', () => {
  assert.deepEqual(d.parseEnd('did it\nCOMPLETE: all done'), { kind: 'complete', summary: 'all done', body: 'did it' })
  assert.equal(d.parseEnd('x\nREVIEW: check the colors').kind, 'review')
  assert.deepEqual(d.parseEnd('blah\nBLOCKED capability: no push access'), { kind: 'block', block: 'capability', reason: 'no push access', body: 'blah' })
  assert.equal(d.parseEnd('CANNOT PLAN: needs ops-repo').kind, 'block')
  assert.equal(d.parseEnd('I think that is finished.').kind, 'none')
  assert.equal(d.parseEnd('').kind, 'none')
  assert.equal(d.parseEnd('BLOCKED nonsense: x').kind, 'none')
})

test('stop_reason carries the block kind and reads it back', () => {
  assert.equal(d.encodeStop('dependency', 'wait for TSK-2'), '[dependency] wait for TSK-2')
  assert.deepEqual(d.parseStop('[capability] No push access.'), { kind: 'capability', reason: 'No push access.' })
  assert.deepEqual(d.parseStop('plain old reason'), { kind: '', reason: 'plain old reason' })
})

test('routeBlock: the four kinds route four different ways; only an exhausted transient writes failed', () => {
  const routes = d.BLOCK_KINDS.map((k: string) => JSON.stringify(d.routeBlock(k, 0)))
  assert.equal(new Set(routes).size, 4)
  assert.equal(d.routeBlock('needs_input').attention, true)
  assert.equal(d.routeBlock('dependency').attention, false)
  assert.equal(d.routeBlock('capability').reroute, true)
  assert.equal(d.routeBlock('transient', 0).retryFree, true)
  assert.equal(d.routeBlock('transient', d.MAX_TRANSIENT).retryFree, false)
  assert.equal(d.routeBlock('transient', d.MAX_TRANSIENT).step_state, 'failed')
  for (const k of ['needs_input', 'dependency', 'capability']) assert.equal(d.routeBlock(k).step_state, 'needs_input', k) // retryOnce ignores these
})

test('nudge: a reply with no finishing line gets two nudges in the same session, then completes if it finishes', async () => {
  const f = fakeApi()
  const turns: { prompt: string, resume?: string }[] = []
  const replies = ['Working on it.', 'Still going.', 'Built it.\nCOMPLETE: done']
  const out = await r.runStep({ ...base(f), launch: async (o: { prompt: string, resume?: string }) => { turns.push({ prompt: o.prompt, resume: o.resume }); return { ok: true, summary: replies[turns.length - 1], sessionId: 'sess-1', usd: 0.1 } } })
  assert.deepEqual(out, { state: 'served', verdict: 'PASS' })
  assert.equal(turns.length, 1 + d.MAX_NUDGES)
  assert.equal(turns[0]!.resume, undefined)
  assert.equal(turns[1]!.resume, 'sess-1')
  assert.match(turns[1]!.prompt, /Reminder 1 of 2/)
  assert.match(turns[2]!.prompt, /Reminder 2 of 2/)
})

test('nudge: a finishing line on the first reply means no nudge', async () => {
  const f = fakeApi()
  let n = 0
  const out = await r.runStep({ ...base(f), launch: async () => { n++; return { ok: true, summary: 'x\nCOMPLETE: done' } } })
  assert.equal(out.state, 'served')
  assert.equal(n, 1)
})

test('nudge: still no finishing line after 2 nudges blocks the step for Meshach and grades nothing', async () => {
  const f = fakeApi()
  let n = 0, graded = false
  const out = await r.runStep({ ...base(f), verify: async () => { graded = true; return { verdict: 'PASS', summary: '' } }, launch: async () => { n++; return { ok: true, summary: 'chatter', sessionId: 's' } } })
  assert.equal(n, 3)
  assert.equal(out.state, 'blocked')
  assert.equal(graded, false)
  const w = f.last('update_step')!
  assert.equal(w.step_state, 'needs_input')
  assert.match(String(w.stop_reason), /^\[needs_input\] The agent ended 3 turns without a finishing line/)
  assert.equal(f.calls.some(c => c.op === 'complete_step'), false)
})

test('nudge: a nudge gets only what is left of the step cap', async () => {
  const f = fakeApi()
  const caps: (number | undefined)[] = []
  await r.runStep({ ...base(f), maxUsd: 2, launch: async (o: { budgetUsd?: number }) => { caps.push(o.budgetUsd); return { ok: true, summary: caps.length < 3 ? 'no line' : 'COMPLETE: ok', usd: 0.5 } } })
  assert.deepEqual(caps, [2, 1.5, 1])
})

test('block kinds: needs_input, dependency and capability park the step; each keeps its kind in stop_reason', async () => {
  for (const [kind, text] of [['needs_input', 'which repo?'], ['dependency', 'wait for TSK-2'], ['capability', 'no push access']] as const) {
    const f = fakeApi()
    const out = await r.runStep({ ...base(f), launch: async () => ({ ok: true, summary: `tried\nBLOCKED ${kind}: ${text}` }) })
    assert.equal(out.state, 'blocked', kind)
    assert.equal(out.block, kind)
    const w = f.last('update_step')!
    assert.equal(w.step_state, 'needs_input', kind)
    assert.match(String(w.stop_reason), new RegExp(`^\\[${kind}\\] ${text}`))
    assert.equal(f.calls.some(c => c.op === 'complete_step'), false, kind)
  }
  const cap = fakeApi()
  await r.runStep({ ...base(cap), launch: async () => ({ ok: true, summary: 'BLOCKED capability: no push access' }) })
  assert.match(String(cap.last('update_step')!.stop_reason), /different agent/)
})

test('block kinds: transient is retried free twice, then fails with [transient]; a retry that finishes passes', async () => {
  const f = fakeApi()
  let n = 0
  const out = await r.runStep({ ...base(f), launch: async () => { n++; return { ok: true, summary: 'BLOCKED transient: rate limited' } } })
  assert.equal(n, 1 + d.MAX_TRANSIENT)
  assert.equal(out.state, 'failed')
  const w = f.last('update_step')!
  assert.equal(w.step_state, 'failed')
  assert.match(String(w.stop_reason), /^\[transient\]/)

  const g = fakeApi()
  let m = 0
  const ok = await r.runStep({ ...base(g), launch: async () => { m++; return m === 1 ? { ok: false, summary: 'API Error: 429 rate limit' } : { ok: true, summary: 'COMPLETE: done' } } })
  assert.equal(ok.state, 'served')
  assert.equal(m, 2)
})

test('verdict: a finished step is always served with a verdict', async () => {
  const f = fakeApi()
  await r.runStep({ ...base(f), launch: async () => ({ ok: true, summary: 'REVIEW: check the colors' }), verify: async () => ({ verdict: 'FAIL', summary: 'nope' }) })
  const w = f.last('complete_step')!
  assert.equal(w.step_state, 'served')
  assert.equal(w.verdict, 'FAIL')
  assert.match(String(w.output_summary), /Review requested: check the colors/)
})

test('finishRefusal: a served work step needs a verdict; blank counts as missing; chat steps and good writes pass', () => {
  assert.match(d.finishRefusal('complete_step', { step_state: 'served' }), /verdict/)
  assert.match(d.finishRefusal('complete_step', { step_state: 'served', verdict: '  ' }), /verdict/)
  assert.equal(d.finishRefusal('complete_step', { step_state: 'served', verdict: 'PASS' }), '')
  assert.equal(d.finishRefusal('complete_step', { step_state: 'served' }, 'chat'), '')
  assert.equal(d.finishRefusal('complete_step', { step_state: 'served' }, ''), '')
  assert.match(d.finishRefusal('complete_step', { step_state: 'failed' }), /reason/)
  assert.equal(d.finishRefusal('complete_step', { step_state: 'needs_input', output_summary: 'which one?' }), '')
  assert.match(d.finishRefusal('update_step', { step_state: 'failed', stop_reason: '' }), /stop_reason/)
  assert.equal(d.finishRefusal('update_step', { step_state: 'failed', stop_reason: '[transient] x' }), '')
  assert.equal(d.finishRefusal('heartbeat', {}), '')
})

test('isTransient: rate limits and network errors, not ordinary failures', () => {
  for (const t of ['API Error: 429', 'rate limit exceeded', 'Overloaded', 'fetch failed', 'ECONNRESET']) assert.equal(d.isTransient(t), true, t)
  for (const t of ['out of budget', 'permission denied', '']) assert.equal(d.isTransient(t), false, t)
})

test('targets: targetOf maps the three agents and pool steps; openByTarget counts open steps only', () => {
  assert.equal(d.targetOf({ assignee: 'agt-claude-code-macbook' }), 'laptop')
  assert.equal(d.targetOf({ assignee: 'pool:builder' }), 'laptop')
  assert.equal(d.targetOf({ assignee: 'agt-claude-code-cloud' }), 'cloud')
  assert.equal(d.targetOf({ assignee: 'agt-actions-runner' }), 'actions')
  assert.equal(d.targetOf({ assignee: 'person:meshach' }), '')
  const open = (assignee: string, over = {}) => ({ assignee, role: 'builder', step_state: 'awaiting_pull', ...over })
  assert.deepEqual(d.openByTarget([open('agt-claude-code-cloud'), open('agt-claude-code-cloud', { cancelled: true }), open('agt-claude-code-cloud', { step_state: 'served' }), open('agt-actions-runner'), open('pool:builder'), open('agt-claude-code-cloud', { role: 'chat' })]), { laptop: 1, cloud: 1, actions: 1 })
})

test('dispatcher poll: fast while steps are open or the answer is unreadable, slower when none are open', () => {
  assert.equal(d.dispatchPollMs({ ok: true, targets: { laptop: 0, cloud: 0, actions: 0 } }), d.DISPATCH_POLL_IDLE_MS)
  assert.equal(d.dispatchPollMs({ ok: true, targets: { laptop: 0, cloud: 2, actions: 0 } }), d.DISPATCH_POLL_ACTIVE_MS)
  assert.equal(d.dispatchPollMs({ ok: true, targets: { laptop: 1 } }), d.DISPATCH_POLL_ACTIVE_MS)
  assert.equal(d.dispatchPollMs(null), d.DISPATCH_POLL_ACTIVE_MS)
  assert.equal(d.dispatchPollMs({ ok: false }), d.DISPATCH_POLL_ACTIVE_MS)
})

test('cloud wake: needs open steps, a URL and a quiet cooldown', () => {
  const o = { open: 2, url: 'https://wake.example/x', lastWakeMs: 0, nowMs: 3_600_000, cooldownMs: 1_800_000 }
  assert.equal(d.cloudWakeDue(o).wake, true)
  assert.equal(d.cloudWakeDue({ ...o, open: 0 }).wake, false)
  assert.match(d.cloudWakeDue({ ...o, url: '' }).why, /BOARD_RUN_CLOUD_WAKE_URL/)
  assert.equal(d.cloudWakeDue({ ...o, lastWakeMs: 3_000_000 }).wake, false)
})

test('pickNext: a cloud or actions step is never picked by the laptop dispatcher', () => {
  const tasks = [TASK]
  const steps = [{ ...STEP, step_id: 'STP-C', assignee: 'agt-claude-code-cloud' }, { ...STEP, step_id: 'STP-D', task_id: 'TSK-2', assignee: 'agt-actions-runner' }]
  assert.deepEqual(r.pickNext([...tasks, { ...TASK, task_id: 'TSK-2' }], steps, [], 2), [])
  assert.equal(r.pickNext(tasks, [STEP], [], 2).length, 1)
})

test('board-run dry run: lists what it would claim with targets, claims nothing, exits 0', async () => {
  const calls: string[] = []
  const api = async (op: string) => {
    calls.push(op)
    if (op === 'list_claimable') return { ok: true, steps: [STEP] }
    if (op === 'get_task') return { ok: true, task: TASK, steps: [STEP], notes: [] }
    return { ok: true }
  }
  const lines: string[] = []
  const log = console.log
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')) }
  try {
    assert.equal(await r.main(['--once', '--dry-run'], { api }), 0)
  } finally { console.log = log }
  assert.deepEqual(lines, ['would claim TSK-1 STP-1 (builder, target laptop)'])
  assert.equal(calls.includes('claim_step'), false)
  assert.equal(calls.includes('heartbeat'), false)
})
