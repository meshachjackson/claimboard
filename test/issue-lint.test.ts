// Issue lint (sections 6 and 7 F1). One case per row of the table,
// each run with `-` bullets and with `*` bullets (Linear stores `*`). The "Rules lines differ" row reads docs/linear-templates.
// Fake Linear API, no live call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lintIssue } from '../scripts/lib/issue-lint.mjs'
import { main } from '../scripts/linear-run.mjs'

const AUTHORITY = {
  default_tier: 'live',
  tiers: { 'early-dev': { push_branch: true, open_pr: true, merge: true, deploy: true, merge_requires: [] }, 'live': { push_branch: true, open_pr: true, merge: false, deploy: false, merge_requires: [] }, 'client': {} },
  repos: { 'agent-workshop': 'early-dev', 'agent-board': 'live' },
  limits: { per_run_usd: 2, per_day_usd: 10, max_retries: 0 }
}
const BULLETS = ['-', '*']

/** A well-formed description in the template shape, using the given bullet. */
const body = (b: string, over: { header?: string[], done?: string[], extra?: string } = {}) => [
  ...(over.header ?? [`${b} **Goal:** fix it`, `${b} **Repo and tier:** agent-board / live`, `${b} **Owner agent:** Builder (laptop)`, `${b} **Checks:** 2 lines below`]),
  '', '## Done when', '', ...(over.done ?? ['`pnpm test` exits 0', 'File `scripts/x.mjs` exists']).map(x => `${b} [ ] ${x}`), '',
  ...(over.extra ? [over.extra, ''] : []), '## Rules', '', `${b} No secrets.`
].join('\n')
const issue = (description: string, labels = ['repo:agent-board', 'tier:live'], extra = {}) => ({ id: 'iss-1', identifier: 'ENG-1', title: 'Fix it', description, labels, notes: [], ...extra })
const lint = (i: unknown, deps = {}) => lintIssue(i, AUTHORITY, deps)

for (const b of BULLETS) {
  const tag = `(${b} bullets)`
  test(`a well-formed issue has no errors and no warnings ${tag}`, async () => {
    assert.deepEqual(await lint(issue(body(b))), { errors: [], warnings: [], holds: [] })
  })
  test(`no Done when list is an error ${tag}`, async () => {
    const r = await lint(issue(`${b} **Goal:** fix it\n\nJust do it.`))
    assert.equal(r.errors.length, 1); assert.match(r.errors[0]!, /no "Done when" list/)
  })
  test(`a leftover {{ placeholder is an error ${tag}`, async () => {
    const r = await lint(issue(body(b, { done: ['`pnpm test` exits 0'], extra: 'Notes: {{fill me}}' })))
    assert.equal(r.errors.length, 1); assert.match(r.errors[0]!, /\{\{/)
  })
  test(`a {{ quoted in backticks is not a placeholder ${tag}`, async () => {
    const r = await lint(issue(body(b, { done: ['`pnpm test` exits 0', 'No `{{` is left in `docs/x.md`'] })))
    assert.deepEqual(r.errors, [])
  })
  test(`a {{ inside a fenced code block is not a placeholder ${tag}`, async () => {
    const r = await lint(issue(body(b, { extra: 'Example:\n```\nTitle: {{name}}\n```' })))
    assert.deepEqual(r.errors, [])
  })
  test(`a bare {{ after a code span is still an error ${tag}`, async () => {
    const r = await lint(issue(body(b, { extra: 'Use `x` here. {{fill me}}\n```\nok\n```' })))
    assert.equal(r.errors.length, 1); assert.match(r.errors[0]!, /\{\{/)
  })
  test(`a Done when line with no command, file or URL is a warning, not an error ${tag}`, async () => {
    const r = await lint(issue(body(b, { done: ['`pnpm test` exits 0', 'The table has the right columns'] })))
    assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0]!, /table has the right columns/)
  })
  test(`a URL or a file path counts as checkable ${tag}`, async () => {
    const r = await lint(issue(body(b, { done: ['https://example.test/ok answers', 'docs/plan.md lists it'] })))
    assert.deepEqual(r.warnings, [])
  })
  test(`Depends on an issue that is not Done is a hold; once Done it passes ${tag}`, async () => {
    const i = issue(body(b, { extra: 'Depends on: ENG-7' }))
    const open = await lint(i, { issueState: async () => 'started' })
    assert.deepEqual(open.errors, []); assert.equal(open.holds.length, 1); assert.match(open.holds[0]!, /ENG-7.*not Done/)
    const done = await lint(i, { issueState: async () => 'completed' })
    assert.deepEqual([done.errors, done.holds], [[], []])
    assert.match((await lint(i, { issueState: async () => null })).errors[0]!, /does not exist/)
  })
  test(`a failed lookup of a dependency is a warning, not a block ${tag}`, async () => {
    const r = await lint(issue(body(b, { extra: 'Depends on: ENG-7' })), { issueState: async () => { throw new Error('down') } })
    assert.deepEqual(r.errors, []); assert.match(r.warnings[0]!, /could not look up ENG-7/)
  })
  test(`the Decision label on a delegated issue is an error ${tag}`, async () => {
    const r = await lint(issue(body(b), ['repo:agent-board', 'tier:live', 'Decision']))
    assert.equal(r.errors.length, 1); assert.match(r.errors[0]!, /Decision/)
  })
  test(`a header repo, tier or builder that disagrees with the labels is an error; the labels win ${tag}`, async () => {
    const head = (repoTier: string, owner: string) => [`${b} **Goal:** x`, `${b} **Repo and tier:** ${repoTier}`, `${b} **Owner agent:** ${owner}`]
    const repo = await lint(issue(body(b, { header: head('agent-workshop / live', 'Builder (laptop)') })))
    assert.match(repo.errors.join(), /header says repo "agent-workshop".*repo:agent-board/)
    const tier = await lint(issue(body(b, { header: head('agent-board / early-dev', 'Builder (laptop)') })))
    assert.match(tier.errors.join(), /header says tier "early-dev".*tier:live/)
    const agent = await lint(issue(body(b, { header: head('agent-board / live', 'Builder (laptop), builder nous') })))
    assert.match(agent.errors.join(), /builder "nous".*no `agent:` label/)
    const same = await lint(issue(body(b, { header: head('agent-board / live', 'Builder (laptop), builder nous') }), ['repo:agent-board', 'tier:live', 'agent:nous']))
    assert.deepEqual(same.errors, [])
  })
  test(`a tier label that disagrees with the authority file is a warning; the file is used ${tag}`, async () => {
    const r = await lint(issue(body(b, { header: [`${b} **Goal:** x`] }), ['repo:agent-board', 'tier:early-dev']))
    assert.deepEqual(r.errors, []); assert.match(r.warnings[0]!, /puts agent-board at live/)
  })
}

// ---------- The runner: refuse once, start nothing ----------

type Call = { op: string, variables: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
function runner(issues: unknown[]) {
  const calls: Call[] = []
  const fetch = async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body)
    const op = /^(?:query|mutation)\s+(\w+)/.exec(query)![1]!
    calls.push({ op, variables })
    const data: Record<string, unknown> = {
      Me: { viewer: { id: 'app-runner', name: 'Builder' } }, Delegated: { issues: { nodes: issues } }, Sessions: { agentSessions: { nodes: [] } },
      AgentSessionCreateOnIssue: { agentSessionCreateOnIssue: { agentSession: { id: 'ses-1' } } }, CommentCreate: { commentCreate: { success: true } },
      IssueUpdate: { issueUpdate: { success: true } }, AgentActivityCreate: { agentActivityCreate: { success: true } }
    }
    return { ok: true, status: 200, json: async () => ({ data: data[op] }) }
  }
  const agent = { launch: 0, prepare: 0, verify: 0 }
  const deps = {
    fetch, token: 'test-token-not-real', confDir: mkdtempSync(join(tmpdir(), 'issue-lint-')), codeDir: '/code', env: {}, authority: () => AUTHORITY,
    isRepo: (p: string) => p === '/code/agent-board', prepare: () => { agent.prepare++; return { path: '/wt', branch: 'b' } },
    launch: async () => { agent.launch++; return { ok: true, summary: 'COMPLETE: done', usd: 0 } }, verify: async () => { agent.verify++; return { verdict: 'PASS', summary: 'ok', detail: '', usd: 0 } },
    finish: () => ({ ahead: 0, summary: '' }), git: () => ({ status: 0, stdout: '', stderr: '' }), gh: () => ({ status: 0, stdout: '', stderr: '' }),
    sleep: async () => {}, pause: async () => {}, log: () => {}, warn: () => {}
  }
  return { calls, agent, deps, comments: () => calls.filter(c => c.op === 'CommentCreate').map(c => c.variables.input.body as string) }
}
const withComments = (i: ReturnType<typeof issue>, notes: string[]) => ({ ...i, comments: { nodes: notes.map(body => ({ body })) }, labels: { nodes: i.labels.map(name => ({ name })) } })

test('an issue with errors gets one comment, loses its delegate, and starts no agent', async () => {
  const w = runner([withComments(issue('No checks here.'), [])])
  assert.equal(await main(['--once'], w.deps), 0)
  assert.equal(w.comments().length, 1)
  assert.match(w.comments()[0]!, /Not started[\s\S]*no "Done when" list[\s\S]*<!-- issue-lint:error:/)
  assert.deepEqual(w.calls.filter(c => c.op === 'IssueUpdate').map(c => c.variables.input), [{ delegateId: null }])
  assert.deepEqual(w.agent, { launch: 0, prepare: 0, verify: 0 })
})

test('a second poll over the same issue posts no second comment, still clears the delegate and starts nothing', async () => {
  const first = runner([withComments(issue('No checks here.'), [])])
  await main(['--once'], first.deps)
  const marked = first.comments()[0]!
  const second = runner([withComments(issue('No checks here.'), [marked])])
  await main(['--once'], second.deps)
  assert.equal(second.comments().length, 0)
  assert.equal(second.calls.filter(c => c.op === 'IssueUpdate').length, 1)
  assert.deepEqual(second.agent, { launch: 0, prepare: 0, verify: 0 })
})

test('a different problem on the same issue gets a new comment', async () => {
  const first = runner([withComments(issue('No checks here.'), [])])
  await main(['--once'], first.deps)
  const second = runner([withComments(issue('Still none, plus {{x}}.'), [first.comments()[0]!])])
  await main(['--once'], second.deps)
  assert.equal(second.comments().length, 1)
})

test('a clean issue passes the lint and the agent starts', async () => {
  const w = runner([withComments(issue(body('-')), [])])
  await main(['--once'], w.deps)
  assert.equal(w.comments().length, 0)
  assert.equal(w.agent.prepare, 1); assert.ok(w.agent.launch >= 1)
})

// ---------- F4: hold until Depends on is Done ----------

test('a dependency that is not Done gets one comment and no run, keeps the delegate; after it is Done the next poll starts it', async () => {
  const dep = (type: string) => (w: ReturnType<typeof runner>) => {
    const f = w.deps.fetch
    w.deps.fetch = async (u: string, init: { body: string }) => {
      if (/query IssueState/.test(JSON.parse(init.body).query)) return { ok: true, status: 200, json: async () => ({ data: { issue: { identifier: 'ENG-7', state: { type } } } }) }
      return f(u, init)
    }
    return w
  }
  const text = body('-', { extra: 'Depends on: ENG-7 - the fix it needs' })
  const first = dep('started')(runner([withComments(issue(text), [])]))
  await main(['--once'], first.deps)
  assert.equal(first.comments().length, 1)
  assert.match(first.comments()[0]!, /Waiting[\s\S]*ENG-7[\s\S]*<!-- issue-lint:hold:/)
  assert.deepEqual(first.calls.filter(c => c.op === 'IssueUpdate'), []) // delegate kept
  assert.deepEqual(first.agent, { launch: 0, prepare: 0, verify: 0 })
  // Next poll, still not Done: the marker is already in the comments, so no second comment.
  const again = dep('started')(runner([withComments(issue(text), [first.comments()[0]!])]))
  await main(['--once'], again.deps)
  assert.equal(again.comments().length, 0)
  assert.deepEqual(again.agent, { launch: 0, prepare: 0, verify: 0 })
  // is Done: the same issue now starts.
  const ready = dep('completed')(runner([withComments(issue(text), [first.comments()[0]!])]))
  await main(['--once'], ready.deps)
  assert.equal(ready.agent.prepare, 1); assert.ok(ready.agent.launch >= 1)
})

// ---------- Section 6 row: the five Rules lines differ between templates ----------

const AGENT_TEMPLATES = ['build-task', 'bug-fix', 'docs-only-task', 'follow-up', 'agent-or-backend-test']
/** Every `## Rules` block in a template file as its bullet lines, rewritten to bullet `b` so both stored forms compare alike. */
function rulesBlocks(file: string, b: string): string[][] {
  const text = readFileSync(join(import.meta.dirname, '..', 'docs', 'linear-templates', `${file}.md`), 'utf8')
  return [...text.matchAll(/^## Rules\s*\n((?:\s*[-*+] .*\n?)+)/gm)].map(m => m[1]!.split('\n').filter(l => l.trim()).map(l => l.replace(/^\s*[-*+]\s+/, `${b} `)))
}
/** Which files (and block numbers) have Rules lines that differ from the first template's first block. Empty means no drift. */
function rulesDrift(blocks: Record<string, string[][]>): string[] {
  const ref = JSON.stringify(blocks[AGENT_TEMPLATES[0]!]![0])
  return Object.entries(blocks).flatMap(([f, bs]) => bs.flatMap((blk, i) => JSON.stringify(blk) === ref ? [] : [`${f}#${i + 1}`]))
}

for (const b of BULLETS) {
  test(`the five Rules lines are identical in the five agent templates (${b} bullets)`, () => {
    const blocks = Object.fromEntries(AGENT_TEMPLATES.map(f => [f, rulesBlocks(f, b)]))
    for (const f of AGENT_TEMPLATES) assert.ok(blocks[f]!.length >= 1, `${f} has no Rules block`)
    assert.equal(blocks[AGENT_TEMPLATES[0]!]![0]!.length, 5)
    assert.deepEqual(rulesDrift(blocks), [])
  })
  test(`a Rules line that differs in one template is caught (${b} bullets)`, () => {
    const blocks = Object.fromEntries(AGENT_TEMPLATES.map(f => [f, rulesBlocks(f, b)]))
    blocks['bug-fix']![0]![2] = `${b} Spend is fine.`
    assert.deepEqual(rulesDrift(blocks), ['bug-fix#1'])
  })
}
