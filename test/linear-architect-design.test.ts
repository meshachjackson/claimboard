// The Architect's up-front design pass (scripts/lib/architect-design.mjs, designIssue in scripts/linear-architect.mjs).
// A fake Linear object and a fake agent: no live call, no real claude, no money spent.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let a: any, d: any
before(async () => { a = await import('../scripts/linear-architect.mjs'); d = await import('../scripts/lib/architect-design.mjs') })

const AUTHORITY = {
  default_tier: 'live', tiers: { 'early-dev': {}, 'live': {}, 'client': {} }, repos: { sandbox: 'early-dev' },
  architect_may_decide: ['scope', 'approach', 'naming', 'which_agent', 'retry_or_split', 'close_stale'],
  always_owner: ['new_spend_or_vendor', 'secrets_or_credentials', 'client_data'],
  limits: { per_run_usd: 2, per_day_usd: 10, max_retries: 2 }
}
const ME = { id: 'u-architect', name: 'Architect' }
const BUILDER = { id: 'u-builder', name: 'Builder (laptop)' }
const issue = (extra = {}) => ({ id: 'iss-1', identifier: 'ENG-1', title: 'Add a footer year', description: 'Show the year.', labels: ['repo:sandbox', 'needs:design'], notes: [], ...extra })

function fakeLinear() {
  const writes: unknown[][] = []
  return {
    writes,
    sessionFor: async () => 'sess-1',
    activity: async (_s: string, c: { type: string, body: string }) => { writes.push(['activity', c.type, c.body]) },
    note: async (_id: string, body: string) => { writes.push(['note', body]) },
    setDelegate: async (_id: string, user: string | null) => { writes.push(['delegate', user]) },
    findUser: async (name: string) => name === BUILDER.name ? BUILDER : null
  }
}
const deps = (reply: string, extra = {}) => {
  const prompts: string[] = [], lists: { allow: string[], deny: string[] }[] = []
  return {
    prompts, lists, codeDir: '/code', isRepo: () => true, policy: 'POLICY-TEXT', builderName: BUILDER.name,
    launch: async (x: { prompt: string, lists: { allow: string[], deny: string[] } }) => { prompts.push(x.prompt); lists.push(x.lists); return { ok: true, summary: reply, usd: 0.25 } }, onSpend() {}, ...extra
  }
}
const run = (linear: ReturnType<typeof fakeLinear>, dp: ReturnType<typeof deps>, i = issue()) => a.ruleIssue({ linear, me: ME, issue: i, authority: AUTHORITY, deps: dp })
const notes = (l: ReturnType<typeof fakeLinear>) => l.writes.filter(w => w[0] === 'note').map(w => String(w[1]))

test('design then builder: one design comment, then the delegate is the builder', async () => {
  const linear = fakeLinear(), dp = deps('Approach: read the year on the server.\nFiles: layouts/default.vue.\nRisks: none.\nDECIDE approach: server year.\nREADY: Use the server year.')
  const r = await run(linear, dp)
  assert.deepEqual(r, { state: 'designed', kind: 'needs:design', to: BUILDER.name })
  assert.equal(dp.prompts.length, 1)
  assert.match(dp.prompts[0], /Design the work before it is built/)
  assert.equal(notes(linear).length, 1)
  assert.ok(notes(linear)[0].startsWith('**Design:**'))
  assert.match(notes(linear)[0], /approach: server year/)
  assert.deepEqual(linear.writes.at(-1), ['delegate', BUILDER.id])
})

test('a design with an always_owner decision holds and asks: the design is posted, no builder is set', async () => {
  const linear = fakeLinear(), dp = deps('Approach: use a paid date API.\nDECIDE new_spend_or_vendor: pay for the date API.\nREADY: Use it.')
  const r = await run(linear, dp)
  assert.deepEqual(r, { state: 'escalated', kind: 'new_spend_or_vendor' })
  assert.equal(notes(linear).length, 2) // the design, then the question
  assert.ok(notes(linear)[0].startsWith('**Design:**'))
  assert.ok(notes(linear)[1].startsWith('**Blocked (new_spend_or_vendor):**'))
  assert.ok(linear.writes.some(w => w[0] === 'activity' && w[1] === 'elicitation'))
  assert.ok(!linear.writes.some(w => w[0] === 'activity' && w[1] === 'response'))
  assert.deepEqual(linear.writes.at(-1), ['delegate', null])
  assert.ok(!linear.writes.some(w => w[0] === 'delegate' && w[1] === BUILDER.id))
})

test('an ESCALATE ending, or a decision kind on neither list, also holds', async () => {
  const l1 = fakeLinear()
  assert.equal((await run(l1, deps('Approach: x.\nESCALATE scope: Also add the version? Options: yes, no. I would pick no.'))).state, 'escalated')
  assert.deepEqual(l1.writes.at(-1), ['delegate', null])
  const l2 = fakeLinear()
  assert.equal((await run(l2, deps('Approach: x.\nDECIDE scope_of_done: drop a check.\nREADY: go.'))).state, 'escalated')
  assert.deepEqual(l2.writes.at(-1), ['delegate', null])
})

test('a reply with no READY or ESCALATE ending posts no design and goes to Meshach', async () => {
  const linear = fakeLinear()
  const r = await run(linear, deps('Approach: something, then I ran out of room'))
  assert.deepEqual(r, { state: 'escalated', kind: 'architect_failed' })
  assert.ok(!notes(linear).some(n => n.startsWith('**Design:**')))
  assert.match(notes(linear)[0], /delegate this issue to the Architect again/)
})

test('an issue without the label gets no design pass: it is ruled on as before', async () => {
  const linear = fakeLinear(), dp = deps('DECIDE approach: Use the server year.')
  const r = await run(linear, dp, issue({ labels: ['repo:sandbox'], notes: ['**Blocked (dependency):** Server or browser?'] }))
  assert.deepEqual(r, { state: 'decided', kind: 'approach', to: BUILDER.name })
  assert.doesNotMatch(dp.prompts[0], /Design the work before it is built/)
  assert.ok(!notes(linear).some(n => n.startsWith('**Design:**')))
})

test('a labeled issue that was already designed, or that a builder blocked on, is ruled on, not designed again', async () => {
  assert.equal(d.wantsDesign(issue()), true)
  assert.equal(d.wantsDesign(issue({ notes: ['**Design:** Approach: x'] })), false)
  assert.equal(d.wantsDesign(issue({ notes: ['**Blocked (dependency):** q'] })), false)
  assert.equal(d.wantsDesign(issue({ labels: ['repo:sandbox'] })), false)
  const linear = fakeLinear(), dp = deps('DECIDE approach: Use the server year.')
  await run(linear, dp, issue({ notes: ['**Design:** Approach: x', '**Blocked (dependency):** q'] }))
  assert.doesNotMatch(dp.prompts[0], /Design the work before it is built/)
})

test('the design comment stays under the 800 characters a builder reads', () => {
  const c = d.designComment(d.parseDesign(`Approach: ${'long '.repeat(400)}\nREADY: go.`))
  assert.ok(c.length <= d.DESIGN_MAX && c.startsWith('**Design:**'))
})

test('the Architect\'s own earlier hold does not stop a retry; the READY line leads the comment; a held design says its decisions wait', () => {
  assert.equal(d.wantsDesign(issue({ notes: ['**Blocked (which_repo):** x\n**Tried:** read the issue, the comments and the repo, and could not rule alone.'] })), true)
  const design = d.parseDesign('Approach: x.\nDECIDE new_spend_or_vendor: pay.\nREADY: Do the thing.')
  assert.match(d.designComment(design), /Start here: Do the thing\./)
  assert.match(d.designComment(design, true), /waiting on Meshach/)
})

test('the design pass gets the preferred stack in its prompt and may fetch only the docs sites in the stack file', async () => {
  const linear = fakeLinear(), dp = deps('Approach: x.\nFiles: y.\nRisks: none.\nREADY: Go.', { stack: 'Hosting: Vercel. Docs: https://vercel.com/docs' })
  await run(linear, dp)
  assert.match(dp.prompts[0], /preferred stack/)
  assert.match(dp.prompts[0], /https:\/\/vercel\.com\/docs/)
  assert.deepEqual(dp.lists[0].allow.filter(t => t.startsWith('WebFetch')), ['WebFetch(domain:vercel.com)'])
  assert.ok(dp.lists[0].deny.includes('WebSearch'))
})

test('with no stack file the design prompt has no stack section and no fetch', async () => {
  const linear = fakeLinear(), dp = deps('Approach: x.\nFiles: y.\nRisks: none.\nREADY: Go.')
  await run(linear, dp)
  assert.doesNotMatch(dp.prompts[0], /preferred stack/)
  assert.ok(!dp.lists[0].allow.some(t => t.startsWith('WebFetch')))
})
