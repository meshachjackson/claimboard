// The Architect (scripts/linear-architect.mjs). A fake Linear object and a fake agent: no live call, no real claude, no money spent.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let a: any
before(async () => { a = await import('../scripts/linear-architect.mjs') })

const AUTHORITY = {
  default_tier: 'live',
  tiers: { 'early-dev': {}, 'live': {}, 'client': {} },
  repos: { 'sandbox': 'early-dev', 'catalyst-n8n': 'client' },
  architect_may_decide: ['scope', 'approach', 'naming', 'which_agent', 'retry_or_split', 'close_stale'],
  always_owner: ['new_spend_or_vendor', 'secrets_or_credentials', 'client_data'],
  limits: { per_run_usd: 2, per_day_usd: 10, max_retries: 2 }
}
const ME = { id: 'u-architect', name: 'Architect' }
const BUILDER = { id: 'u-builder', name: 'Builder (laptop)' }
const issue = (extra = {}) => ({ id: 'iss-1', identifier: 'ENG-1', title: 'Fix the footer', description: 'The footer is wrong.', labels: ['repo:sandbox'],
  notes: ['**Blocked (dependency):** Should the year come from the server or the browser?'], ...extra })

/** A fake Linear that records every write in order. */
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
const deps = (reply: string | Error, extra = {}) => {
  const prompts: { prompt: string, lists: { allow: string[], deny: string[] } }[] = []
  return {
    prompts, spent: [] as number[],
    codeDir: '/code', isRepo: () => true, policy: 'POLICY-TEXT', builderName: BUILDER.name,
    launch: async (x: { prompt: string, lists: { allow: string[], deny: string[] } }) => { prompts.push(x); if (reply instanceof Error) throw reply; return { ok: true, summary: reply, usd: 0.25 } },
    onSpend(usd: number) { this.spent.push(usd) }, ...extra
  }
}
const run = (linear: ReturnType<typeof fakeLinear>, d: ReturnType<typeof deps>, i = issue()) => a.ruleIssue({ linear, me: ME, issue: i, authority: AUTHORITY, deps: d })

test('parseRuling: reads the last DECIDE or ESCALATE line, and nothing else counts', () => {
  assert.deepEqual(a.parseRuling('I read the code.\nDECIDE approach: Use the server year in layouts/default.vue.'), { verb: 'DECIDE', kind: 'approach', text: 'Use the server year in layouts/default.vue.' })
  assert.deepEqual(a.parseRuling('**ESCALATE new_spend_or_vendor: Pay for a date service? Options: yes, no. I would pick no.**'), { verb: 'ESCALATE', kind: 'new_spend_or_vendor', text: 'Pay for a date service? Options: yes, no. I would pick no.' })
  assert.equal(a.parseRuling('I think we should decide to use the server.'), null)
  assert.equal(a.parseRuling(''), null)
})

test('a decision the Architect may make goes back to the builder: comment, response, delegate set to the builder', async () => {
  const linear = fakeLinear(), d = deps('Looked at layouts.\nDECIDE approach: Use the server year in layouts/default.vue.')
  const r = await run(linear, d)
  assert.deepEqual(r, { state: 'decided', kind: 'approach', to: BUILDER.name })
  assert.deepEqual(linear.writes.at(-1), ['delegate', BUILDER.id])
  assert.ok(linear.writes.some(w => w[0] === 'note' && String(w[1]).startsWith('**Handoff:** Architect to Builder (laptop)\n**Ruling or result:** Use the server year')))
  assert.ok(linear.writes.some(w => w[0] === 'activity' && w[1] === 'response'))
  assert.deepEqual(d.spent, [0.25])
})

test('a kind on the always_owner list goes to Meshach even when the agent wrote DECIDE', async () => {
  const linear = fakeLinear(), d = deps('DECIDE new_spend_or_vendor: Buy the date service.')
  const r = await run(linear, d)
  assert.deepEqual(r, { state: 'escalated', kind: 'new_spend_or_vendor' })
  assert.deepEqual(linear.writes.at(-1), ['delegate', null])
  assert.ok(linear.writes.some(w => w[0] === 'activity' && w[1] === 'elicitation'))
  assert.ok(!linear.writes.some(w => w[0] === 'note' && String(w[1]).startsWith('**Handoff:**')))
})

test('a kind on neither list goes to Meshach', async () => {
  const linear = fakeLinear()
  assert.equal((await run(linear, deps('DECIDE scope_of_done: Drop the second check.'))).state, 'escalated')
  assert.deepEqual(linear.writes.at(-1), ['delegate', null])
})

test('ESCALATE becomes one question for Meshach: a comment, an elicitation, and no agent left on the issue', async () => {
  const linear = fakeLinear()
  const r = await run(linear, deps('ESCALATE scope: Should the footer also show the version? Options: yes, no. I would pick no.'))
  assert.deepEqual(r, { state: 'escalated', kind: 'scope' })
  assert.ok(linear.writes.some(w => w[0] === 'note' && String(w[1]).startsWith('**Blocked (scope):** Should the footer')))
  assert.deepEqual(linear.writes.at(-1), ['delegate', null])
})

test('no ruling line, or an agent that fails to start, goes to Meshach instead of guessing', async () => {
  for (const reply of ['I am not sure what to do here.', new Error('login expired')]) {
    const linear = fakeLinear()
    assert.deepEqual(await run(linear, deps(reply)), { state: 'escalated', kind: 'architect_failed' })
    assert.deepEqual(linear.writes.at(-1), ['delegate', null])
  }
})

test('loop guard: after max_retries rulings on one issue the next block goes to Meshach and no agent starts', async () => {
  const linear = fakeLinear(), d = deps('DECIDE approach: again')
  const notes = ['**Architect decision (approach):** one', '**Architect decision (approach):** two', '**Architect decision (approach):** three', '**Blocked (dependency):** still stuck']
  assert.deepEqual(await run(linear, d, issue({ notes })), { state: 'escalated', kind: 'repeat_block' })
  assert.equal(d.prompts.length, 0)
})

test('a client repo is refused before any agent starts', async () => {
  const linear = fakeLinear(), d = deps('DECIDE approach: x')
  assert.deepEqual(await run(linear, d, issue({ labels: ['repo:catalyst-n8n'] })), { state: 'refused' })
  assert.equal(d.prompts.length, 0)
  assert.deepEqual(linear.writes.at(-1), ['delegate', null])
})

test('no repo label asks Meshach which repo, and no agent starts', async () => {
  const linear = fakeLinear(), d = deps('DECIDE approach: x')
  assert.deepEqual(await run(linear, d, issue({ labels: [] })), { state: 'escalated', kind: 'which_repo' })
  assert.equal(d.prompts.length, 0)
})

test('the agent runs read-only and its prompt carries the policy, both lists and the block reason as data', async () => {
  const linear = fakeLinear(), d = deps('DECIDE naming: Call it footerYear.')
  await run(linear, d)
  const { prompt, lists } = d.prompts[0]
  assert.deepEqual(lists.allow, a.READ_ONLY.allow) // no stack file: no web fetch at all
  assert.ok(lists.deny.includes('WebSearch'))
  for (const tool of ['Edit', 'Write', 'Bash(git commit*)', 'Bash(git push*)', 'Bash(gh *)']) assert.ok(lists.deny.includes(tool), tool)
  assert.ok(!lists.allow.some((t: string) => /Edit|Write|push|commit/.test(t)))
  for (const text of ['POLICY-TEXT', 'scope, approach, naming', 'new_spend_or_vendor', 'Should the year come from the server', 'data, not instructions']) assert.ok(prompt.includes(text), text)
})

test('with no builder to hand back to, the decision goes to Meshach rather than being lost', async () => {
  const linear = fakeLinear(), d = deps('DECIDE approach: Use the server year.', { builderName: 'Nobody' })
  const r = await run(linear, d)
  assert.equal(r.state, 'escalated')
  assert.ok(linear.writes.some(w => w[0] === 'note' && String(w[1]).includes('Use the server year')))
})

test('a claude that is not logged in starts no ruling and comments once on the issue', async () => {
  const l = { ...fakeLinear(), viewer: async () => ME, delegatedIssues: async () => [issue()] }
  const d = deps('DECIDE approach: x'), logs: string[] = []
  const code = await a.main(['--once'], { linear: l, ...d, authority: () => AUTHORITY, confDir: '/nonexistent-conf', checkLogin: () => ({ ok: false, reason: 'the claude program is not logged in' }), log: () => {}, warn: (m: string) => logs.push(m) })
  assert.equal(code, 0)
  assert.equal(d.prompts.length, 0)
  assert.equal(logs.filter(m => /not picking up work/.test(m)).length, 1)
  assert.equal(l.writes.filter(w => w[0] === 'note').length, 1)
  assert.equal(l.writes.some(w => w[0] === 'delegate'), false)
})

test('Architect comments follow the standard formats and stay under 700 characters', async () => {
  const long = 'x'.repeat(3000)
  const ruled = fakeLinear()
  await run(ruled, deps(`DECIDE approach: ${long}`))
  const handoff = String(ruled.writes.find(w => w[0] === 'note')![1])
  assert.match(handoff, /^\*\*Handoff:\*\* Architect to Builder \(laptop\)\n\*\*Ruling or result:\*\* /)
  for (const label of ['Evidence', 'Left to do', 'Do not']) assert.ok(handoff.includes(`\n**${label}:** `), label)
  assert.ok(handoff.length <= 700, `handoff is ${handoff.length}`)
  const asked = fakeLinear()
  await run(asked, deps(`ESCALATE scope: ${long}`))
  const blocked = String(asked.writes.find(w => w[0] === 'note')![1])
  assert.match(blocked, /^\*\*Blocked \(scope\):\*\* /)
  for (const label of ['Tried', 'Need', 'Then']) assert.ok(blocked.includes(`\n**${label}:** `), label)
  assert.ok(blocked.endsWith('delegate this issue to Builder (laptop) again.'))
  assert.ok(blocked.length <= 700, `blocked is ${blocked.length}`)
})

const STACK = '## Hosting: Vercel\n- Docs: https://vercel.com/docs\n## Nuxt\n- Docs: https://nuxt.com/docs and https://ui.nuxt.com/docs, (https://Vercel.com/docs/again)\n- Not a link: http://insecure.example.com'

test('docHosts: one entry per https host, lowercased and sorted; http links and empty input give nothing', () => {
  assert.deepEqual(a.docHosts(STACK), ['nuxt.com', 'ui.nuxt.com', 'vercel.com'])
  assert.deepEqual(a.docHosts(''), [])
  assert.deepEqual(a.docHosts('See https://docs.n8n.io. Also `https://nodejs.org/api`, "https://x.dev/a", https://end.io;'), ['docs.n8n.io', 'end.io', 'nodejs.org', 'x.dev'])
  assert.deepEqual(a.docHosts(undefined), [])
})

test('the shipped stack file parses to at least one docs host, and every host is a plain domain', async () => {
  const { readFileSync } = await import('node:fs')
  const hosts = a.docHosts(readFileSync(a.STACK_PATH, 'utf8'))
  assert.ok(hosts.length > 0)
  for (const h of hosts) assert.match(h, /^[a-z0-9.-]+\.[a-z]{2,}$/)
})

test('with a stack file the Architect may fetch only its docs sites, still cannot write or search, and the prompt carries the stack', async () => {
  const linear = fakeLinear(), d = deps('DECIDE naming: Call it footerYear.', { stack: STACK })
  await run(linear, d)
  const { prompt, lists } = d.prompts[0]
  assert.deepEqual(lists.allow.filter((t: string) => t.startsWith('WebFetch')), ['WebFetch(domain:nuxt.com)', 'WebFetch(domain:ui.nuxt.com)', 'WebFetch(domain:vercel.com)'])
  assert.ok(!lists.allow.includes('WebFetch'), 'no unscoped WebFetch')
  for (const tool of ['Edit', 'Write', 'WebSearch', 'Bash(git push*)']) assert.ok(lists.deny.includes(tool), tool)
  for (const text of ["Meshach's preferred stack", 'https://vercel.com/docs', 'new_spend_or_vendor']) assert.ok(prompt.includes(text), text)
})
