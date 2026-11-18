// The Nous Portal builder (scripts/lib/nous-agent.mjs). A fake chat completions API
// on 127.0.0.1 that plays scripted replies and records requests. No real host is called and no money is spent.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nous: any
const KEY = 'fixture-key-not-real-0123'
type Reply = { status?: number, body: unknown }
let server: http.Server, base = ''
let queue: Reply[] = []
let catalog: Reply = { body: { data: [] } }
let catalogHits = 0
let seen: { auth: string, body: any }[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  nous = await import('../scripts/lib/nous-agent.mjs')
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', d => { raw += d })
    req.on('end', () => {
      // The model catalog is answered on its own so it never touches the scripted chat queue or the request record.
      if (req.url?.endsWith('/models')) {
        catalogHits++
        res.writeHead(catalog.status ?? 200, { 'content-type': 'application/json' })
        return res.end(typeof catalog.body === 'string' ? catalog.body : JSON.stringify(catalog.body))
      }
      seen.push({ auth: String(req.headers.authorization), body: JSON.parse(raw || '{}') })
      const next = queue.shift() ?? { body: say('COMPLETE: default') }
      res.writeHead(next.status ?? 200, { 'content-type': 'application/json' })
      res.end(typeof next.body === 'string' ? next.body : JSON.stringify(next.body))
    })
  })
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
})
after(() => server.close())

const say = (content: string, usage = { prompt_tokens: 1000, completion_tokens: 500 }) => ({ choices: [{ message: { role: 'assistant', content } }], usage })
const call = (name: string, args: unknown, id = 'c1') => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 20 } })
const LISTS = { allow: ['Bash(git *)', 'Bash(node *)', 'Bash(ls *)'], deny: ['Bash(git push*)', 'Bash(git push* main*)'] }
const GIT_ENV = { PATH: process.env.PATH ?? '', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.test', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

function setup(extra: Record<string, unknown> = {}, env: Record<string, string> = { ...GIT_ENV, LINEAR_NOUS_API_KEY: KEY }) {
  queue = []; seen = []
  const cwd = mkdtempSync(join(tmpdir(), 'nous-wt-'))
  execFileSync('git', ['init', '-q'], { cwd, env: GIT_ENV })
  writeFileSync(join(cwd, 'a.txt'), 'one\ntwo\nthree\n')
  const config = { base_url: base, model: 'free/model:free', key_env: 'LINEAR_NOUS_API_KEY', max_turns: 10, price_in: 0, price_out: 0, command_timeout_s: 5, ...extra }
  const launch = nous.makeNousLauncher(config, { env })
  return { cwd, launch, go: (prompt = 'do it', more = {}) => launch({ prompt, cwd, lists: LISTS, budgetUsd: 2, ...more }) }
}
/** What the model was told after its last tool call: the content of the last tool message sent to the API. */
const lastToolText = () => String(seen.at(-1)!.body.messages.filter((m: { role: string }) => m.role === 'tool').at(-1)?.content)

test('tool loop: writes a file, commits with a multi-word message, ends with the finishing line, sends the bearer key and the tools', async () => {
  const t = setup()
  queue = [{ body: call('write_file', { path: 'src/new.txt', content: 'hello' }) }, { body: call('run', { argv: ['git', 'add', '-A'] }) },
    { body: call('run', { argv: ['git', 'commit', '-m', 'Fix the footer year'] }) }, { body: say('COMPLETE: added the file') }]
  const r = await t.go()
  assert.equal(r.ok, true)
  assert.equal(r.summary, 'COMPLETE: added the file')
  assert.equal(readFileSync(join(t.cwd, 'src/new.txt'), 'utf8'), 'hello')
  assert.equal(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: t.cwd, env: GIT_ENV }).toString().trim(), 'Fix the footer year')
  assert.equal(seen.length, 4)
  assert.equal(seen[0]!.auth, `Bearer ${KEY}`)
  assert.equal(seen[0]!.body.model, 'free/model:free')
  assert.deepEqual(seen[0]!.body.tags, ['product=agent-board-runner', 'user=agent-board-runner']) // live Nous: no tags is 400 "missing tags", no user tag is 400 "missing user tag"
  assert.deepEqual(seen[0]!.body.tools.map((x: { function: { name: string } }) => x.function.name), ['read_file', 'write_file', 'edit_file', 'list_files', 'grep', 'run'])
})

test('tags come from the config when set', async () => {
  const t = setup({ tags: ['product=custom'] })
  queue = [{ body: say('COMPLETE: x') }]
  await t.go()
  assert.deepEqual(seen[0]!.body.tags, ['product=custom'])
})

test('spend: tokens times the configured price per million, and a free model costs 0', async () => {
  const paid = setup({ price_in: 2, price_out: 10 })
  queue = [{ body: say('COMPLETE: x', { prompt_tokens: 1_000_000, completion_tokens: 100_000 }) }]
  assert.equal((await paid.go()).usd, 3)
  const free = setup()
  queue = [{ body: say('COMPLETE: x') }]
  assert.equal((await free.go()).usd, 0)
})

test('the dollar cap stops the loop', async () => {
  const t = setup({ price_in: 1000, price_out: 0 })
  queue = [{ body: { ...call('list_files', {}), usage: { prompt_tokens: 10_000, completion_tokens: 0 } } }, { body: say('COMPLETE: never reached') }]
  const r = await t.go('x', { budgetUsd: 1 })
  assert.match(r.summary, /dollar cap/)
  assert.equal(seen.length, 1)
})

test('max_turns ends a model that never stops calling tools', async () => {
  const t = setup({ max_turns: 3 })
  queue = Array.from({ length: 5 }, () => ({ body: call('list_files', {}) }))
  const r = await t.go()
  assert.equal(r.ok, true)
  assert.match(r.summary, /Stopped after 3 tool rounds/)
  assert.equal(seen.length, 3)
})

test('resume continues the same conversation for a nudge', async () => {
  const t = setup()
  queue = [{ body: say('I think I am done.') }, { body: say('COMPLETE: now done') }]
  const first = await t.go('first prompt')
  const second = await t.go('Reminder 1 of 2', { resume: first.sessionId })
  assert.equal(second.sessionId, first.sessionId)
  const texts = seen[1]!.body.messages.map((m: { content: string }) => m.content)
  assert.ok(texts.includes('first prompt') && texts.includes('I think I am done.') && texts.includes('Reminder 1 of 2'))
})

test('run refuses a command on the deny list', async () => {
  const t = setup()
  queue = [{ body: call('run', { argv: ['git', 'push', 'origin', 'x'] }) }, { body: say('BLOCKED needs_input: x') }]
  await t.go()
  assert.match(lastToolText(), /Denied: git push origin x is on the deny list/)
})

test('run refuses a command that is not on the allow list', async () => {
  const t = setup()
  queue = [{ body: call('run', { argv: ['curl', 'https://example.test'] }) }, { body: say('x') }]
  await t.go()
  assert.match(lastToolText(), /Not allowed: curl/)
})

test('run refuses chaining, pipes and redirects, and a program name with spaces', async () => {
  const t = setup()
  for (const argv of [['git', 'status', '&&', 'ls'], ['ls', '|', 'cat'], ['ls', '>', 'x'], ['git status && ls'], ['git', 'status', ';', 'ls']]) {
    queue = [{ body: call('run', { argv }) }, { body: say('x') }]
    await t.go()
    assert.match(lastToolText(), /no shell|program alone/, JSON.stringify(argv))
  }
  assert.equal(existsSync(join(t.cwd, 'x')), false)
})

test('run refuses command substitution and backticks', async () => {
  const t = setup()
  for (const argv of [['git', 'commit', '-m', '$(whoami)'], ['ls', '`pwd`'], ['node', '-e', 'x$(y)']]) {
    queue = [{ body: call('run', { argv }) }, { body: say('x') }]
    await t.go()
    assert.match(lastToolText(), /Command substitution/, JSON.stringify(argv))
  }
})

test('the runner pushes and opens the pull request, so this builder cannot, even where the lists allow it', () => {
  const live = { allow: [...LISTS.allow, 'Bash(gh pr create*)'], deny: [] }
  assert.match(nous.commandRefusal(['git', 'push', 'origin', 'HEAD:main'], live), /Denied/)
  assert.match(nous.commandRefusal(['gh', 'pr', 'create'], live), /Denied/)
})

test('run refuses git options before the subcommand, so -C cannot hide a push', async () => {
  const t = setup()
  queue = [{ body: call('run', { argv: ['git', '-C', '/elsewhere', 'push'] }) }, { body: say('x') }]
  await t.go()
  assert.match(lastToolText(), /subcommand first/)
})

test('file tools refuse a path outside the worktree: dotdot, absolute, symlink, and .git', async () => {
  const t = setup()
  const outside = mkdtempSync(join(tmpdir(), 'nous-outside-'))
  writeFileSync(join(outside, 'secret.txt'), 'nope')
  symlinkSync(outside, join(t.cwd, 'link'))
  for (const [name, args] of [['read_file', { path: '../../etc/hosts' }], ['read_file', { path: join(outside, 'secret.txt') }], ['read_file', { path: 'link/secret.txt' }],
    ['write_file', { path: 'link/new.txt', content: 'x' }], ['write_file', { path: '.git/hooks/pre-commit', content: 'x' }], ['list_files', { path: '/' }]] as [string, unknown][]) {
    queue = [{ body: call(name, args) }, { body: say('x') }]
    await t.go()
    assert.match(lastToolText(), /outside the worktree|not file tools/, `${name} ${JSON.stringify(args)}`)
  }
  assert.equal(existsSync(join(outside, 'new.txt')), false)
})

test('edit_file replaces exactly one match and refuses zero or many', async () => {
  const t = setup()
  writeFileSync(join(t.cwd, 'b.txt'), 'x x y')
  for (const [old, want] of [['y', /edited/], ['x', /appears 2 times/], ['zzz', /appears 0 times/]] as [string, RegExp][]) {
    queue = [{ body: call('edit_file', { path: 'b.txt', old, new: 'Z' }) }, { body: say('x') }]
    await t.go()
    assert.match(lastToolText(), want)
  }
  assert.equal(readFileSync(join(t.cwd, 'b.txt'), 'utf8'), 'x x Z')
})

test('read_file cuts a long file and says how to read the rest; grep and list_files work', async () => {
  const t = setup()
  writeFileSync(join(t.cwd, 'big.txt'), 'line of text\n'.repeat(3000))
  queue = [{ body: call('read_file', { path: 'big.txt' }) }, { body: say('x') }]
  await t.go()
  assert.match(lastToolText(), /cut at 10000 characters.*offset and limit/s)
  queue = [{ body: call('read_file', { path: 'a.txt', offset: 2, limit: 1 }) }, { body: say('x') }]
  await t.go()
  assert.equal(lastToolText(), 'two')
  queue = [{ body: call('grep', { pattern: 'thr.e' }) }, { body: say('x') }]
  await t.go()
  assert.equal(lastToolText(), 'a.txt:3: three')
  queue = [{ body: call('list_files', {}) }, { body: say('x') }]
  await t.go()
  assert.match(lastToolText(), /a\.txt/)
})

test('a command the model runs never sees a name that holds a key or token', async () => {
  const t = setup({}, { ...GIT_ENV, LINEAR_NOUS_API_KEY: KEY, SOME_TOKEN: 'tok', OTHER_SECRET: 's', ANTHROPIC_API_KEY: 'a' })
  queue = [{ body: call('run', { argv: ['node', '-e', 'console.log(Object.keys(process.env).join(","))'] }) }, { body: say('x') }]
  await t.go()
  assert.doesNotMatch(lastToolText(), /LINEAR_NOUS_API_KEY|SOME_TOKEN|OTHER_SECRET|ANTHROPIC/)
  assert.match(lastToolText(), /PATH/)
})

test('a command that hangs is killed at the timeout', async () => {
  const t = setup({ command_timeout_s: 0.3 })
  queue = [{ body: call('run', { argv: ['node', '-e', 'setTimeout(()=>{},20000)'] }) }, { body: say('x') }]
  await t.go()
  assert.match(lastToolText(), /Killed after/)
})

test('a failure mid-loop still reports the spend so far', async () => {
  const t = setup({ price_in: 1000, price_out: 0 })
  queue = [{ body: { ...call('list_files', {}), usage: { prompt_tokens: 1000, completion_tokens: 0 } } }, { status: 500, body: 'boom' }]
  const r = await t.go('x', { budgetUsd: 100 })
  assert.equal(r.ok, false)
  assert.equal(r.usd, 1)
})

test('the key never shows in a returned summary, even when the API echoes it', async () => {
  const t = setup()
  queue = [{ status: 500, body: `server said: bad key ${KEY}` }]
  const err = await t.go()
  assert.equal(err.ok, false)
  assert.doesNotMatch(err.summary, new RegExp(KEY))
  assert.match(err.summary, /HTTP 500/)
  queue = [{ body: say(`COMPLETE: the key is ${KEY}`) }]
  assert.doesNotMatch((await t.go()).summary, new RegExp(KEY))
})

test('a 429 reads as a rate limit so the runner retries it, and no key set is a plain error', async () => {
  const t = setup()
  queue = [{ status: 429, body: 'slow down' }]
  const r = await t.go()
  assert.equal(r.ok, false)
  const { isTransient } = await import('../app/utils/dispatch.ts')
  assert.equal(isTransient(r.summary), true)
  const none = setup({}, { ...GIT_ENV })
  const n = await none.go()
  assert.equal(n.ok, false)
  assert.match(n.summary, /No Nous Portal key is set \(env name LINEAR_NOUS_API_KEY\)/)
  assert.equal(seen.length, 0) // setup() cleared the record: with no key nothing was sent
})

// ---------- Waiting out a 429 (retry_after 95 killed the run) ----------
const limited = (retry_after: unknown) => ({ status: 429, body: { status: 429, message: "You've reached this model's current fair-share rate limit", reason: 'rate_limited', retry_after, alternates: ['meituan/longcat-2.0'] } })
function waiter(extra: Record<string, unknown> = {}) {
  const t = setup()
  const sleeps: number[] = [], logs: string[] = []
  const launch = nous.makeNousLauncher({ base_url: base, model: 'free/model:free', key_env: 'LINEAR_NOUS_API_KEY', max_turns: 10, command_timeout_s: 5, ...extra }, { env: { ...GIT_ENV, LINEAR_NOUS_API_KEY: KEY }, sleep: async (s: number) => { sleeps.push(s) }, log: (l: string) => logs.push(l) })
  return { t, sleeps, logs, go: (more = {}) => launch({ prompt: 'x', cwd: t.cwd, lists: LISTS, budgetUsd: 2, ...more }) }
}

test('a 429 with retry_after waits that long, logs one line, retries the same request and succeeds', async () => {
  const w = waiter()
  queue = [limited(95), { body: say('COMPLETE: done') }]
  const r = await w.go()
  assert.equal(r.ok, true)
  assert.equal(r.summary, 'COMPLETE: done')
  assert.deepEqual(w.sleeps, [95])
  assert.equal(w.logs.length, 1)
  assert.match(w.logs[0]!, /waiting 95 s/)
  assert.equal(seen.length, 2)
  assert.deepEqual(seen[1]!.body, seen[0]!.body) // the same request
  assert.doesNotMatch(JSON.stringify(seen), /longcat/) // never switches to the alternates
})

test('one wait is clamped to the configured maximum', async () => {
  const w = waiter({ rate_limit_max_wait_s: 30 })
  queue = [limited(500), { body: say('COMPLETE: ok') }]
  assert.equal((await w.go()).ok, true)
  assert.deepEqual(w.sleeps, [30])
})

test('waiting does not count against the dollar cap or tool rounds', async () => {
  const w = waiter({ price_in: 1000, max_turns: 1 })
  queue = [limited(1), limited(1), limited(1), { body: say('COMPLETE: ok', { prompt_tokens: 1000, completion_tokens: 0 }) }]
  const r = await w.go({ budgetUsd: 100 })
  assert.equal(r.ok, true)
  assert.equal(r.usd, 1)
  assert.equal(w.sleeps.length, 3)
})

test('when the wait budget is spent it stops with a plain message, no raw JSON, and not a transient one', async () => {
  const w = waiter({ rate_limit_budget_s: 200, rate_limit_max_wait_s: 120 })
  queue = [limited(95), limited(95), limited(95)]
  const r = await w.go()
  assert.equal(r.ok, false)
  assert.equal(r.summary, 'Nous Portal is rate limiting this model; waited 190 seconds; delegate the issue again later.')
  assert.doesNotMatch(r.summary, /[{}]|retry_after|alternates/)
  assert.deepEqual(w.sleeps, [95, 95])
  const { isTransient } = await import('../app/utils/dispatch.ts')
  assert.equal(isTransient(r.summary), false) // the runner must not retry and wait again
})

test('the stop message says so when the builder already committed work', async () => {
  const w = waiter({ rate_limit_budget_s: 10 })
  queue = [{ body: call('write_file', { path: 'b.txt', content: 'b' }) }, { body: call('run', { argv: ['git', 'add', '-A'] }) },
    { body: call('run', { argv: ['git', 'commit', '-m', 'Add b'] }) }, limited(95)]
  const r = await w.go()
  assert.equal(r.ok, false)
  assert.match(r.summary, /waited 0 seconds/)
  assert.match(r.summary, /already committed work in the worktree; it is kept/)
})

test('retry_after of 0 still waits at least 1 s, so the budget runs out instead of looping forever', async () => {
  const w = waiter({ rate_limit_budget_s: 3 })
  queue = Array.from({ length: 20 }, () => limited(0))
  const r = await w.go()
  assert.equal(r.ok, false)
  assert.deepEqual(w.sleeps, [1, 1, 1])
  assert.match(r.summary, /waited 3 seconds/)
})

test('a nudge turn still knows the builder committed earlier in the session', async () => {
  const w = waiter({ rate_limit_budget_s: 10 })
  queue = [{ body: call('write_file', { path: 'c.txt', content: 'c' }) }, { body: call('run', { argv: ['git', 'add', '-A'] }) },
    { body: call('run', { argv: ['git', 'commit', '-m', 'Add c'] }) }, { body: say('no finishing line yet') }]
  const first = await w.go()
  queue = [limited(95)]
  const r = await w.go({ resume: first.sessionId })
  assert.equal(r.ok, false)
  assert.match(r.summary, /already committed work in the worktree/)
})

test('the wait budget is shared by every turn of one run', async () => {
  const w = waiter({ rate_limit_budget_s: 100 })
  queue = [limited(60), { body: say('no finishing line') }]
  const first = await w.go()
  queue = [limited(60)]
  const r = await w.go({ resume: first.sessionId })
  assert.equal(r.ok, false)
  assert.match(r.summary, /waited 60 seconds/)
})

test('a missing or non-numeric retry_after is not waited on here: it falls back to the runner\'s short pause', async () => {
  for (const bad of [undefined, 'soon', null]) {
    const w = waiter()
    queue = [limited(bad)]
    const r = await w.go()
    assert.equal(r.ok, false)
    assert.deepEqual(w.sleeps, [])
    assert.match(r.summary, /HTTP 429/)
    assert.doesNotMatch(r.summary, /[{}]|retry_after/) // the API message, not the raw JSON
    const { isTransient } = await import('../app/utils/dispatch.ts')
    assert.equal(isTransient(r.summary), true)
  }
})

// ---------- Free fallback models (the one free model stayed rate limited for 452 s) ----------
const freeEntry = (id: string) => ({ id, pricing: { prompt: '0.0000000000', completion: '0' }, supported_parameters: ['tools', 'tool_choice'] })
const paidEntry = (id: string) => ({ id, pricing: { prompt: '0.0000015', completion: '0.0000075' }, supported_parameters: ['tools'] })
const FB = ['fb/one:free', 'fb/two:free']
function fb(extra: Record<string, unknown> = {}) {
  catalog = { body: { data: [freeEntry('fb/one:free'), freeEntry('fb/two:free')] } }; catalogHits = 0
  return waiter({ fallback_models: FB, rate_limit_budget_s: 100, rate_limit_max_wait_s: 60, ...extra })
}
const modelsSent = () => seen.map(s => s.body.model).filter((m, i, a) => m !== a[i - 1]) // consecutive repeats (a retry after a wait) collapse
const { isTransient } = await import('../app/utils/dispatch.ts')
const { parseEnd } = await import('../app/utils/dispatch.ts')

test('fallback: a model over its wait budget moves to the next free model with the same conversation, and the reply names both', async () => {
  const w = fb()
  queue = [limited(60), limited(60), { body: say('COMPLETE: done on the fallback') }]
  const r = await w.go()
  assert.equal(r.ok, true)
  assert.deepEqual(seen.map(x => x.body.model), ['free/model:free', 'free/model:free', 'fb/one:free'])
  assert.deepEqual(seen[2]!.body.messages, seen[1]!.body.messages) // continuity: the same history
  assert.deepEqual(w.sleeps, [60])
  assert.equal(w.logs.filter(l => /switching to fb\/one:free/.test(l)).length, 1)
  assert.match(w.logs.join('\n'), /free\/model:free is rate limited/)
  assert.equal(r.summary, 'COMPLETE: done on the fallback (models used: free/model:free, fb/one:free)')
  assert.equal(parseEnd(r.summary).summary, 'done on the fallback (models used: free/model:free, fb/one:free)')
  assert.equal(catalogHits, 1)
})

test('fallback: the first 429 with a retry_after longer than the per-wait cap switches without waiting', async () => {
  const w = fb()
  queue = [limited(95), { body: say('COMPLETE: ok') }]
  const r = await w.go()
  assert.equal(r.ok, true)
  assert.deepEqual(w.sleeps, [])
  assert.deepEqual(modelsSent(), ['free/model:free', 'fb/one:free'])
})

test('fallback: the new model gets a fresh wait budget', async () => {
  const w = fb()
  queue = [limited(60), limited(60), limited(50), limited(50), { body: say('COMPLETE: ok') }]
  const r = await w.go()
  assert.equal(r.ok, true)
  assert.deepEqual(w.sleeps, [60, 50, 50])
  assert.deepEqual(modelsSent().slice(-1), ['fb/one:free'])
})

test('fallback: no fallbacks configured behaves as before, and the catalog is never read', async () => {
  const w = waiter({ rate_limit_budget_s: 200, rate_limit_max_wait_s: 120 })
  catalogHits = 0
  queue = [limited(500), { body: say('COMPLETE: ok') }]
  assert.equal((await w.go()).ok, true)
  assert.deepEqual(w.sleeps, [120]) // clamped, not switched
  assert.equal(catalogHits, 0)
})

test('fallback: one that is not free is skipped with a log line, and a paid or untooled entry never counts', async () => {
  fb()
  catalog = { body: { data: [paidEntry('fb/one:free'), { ...freeEntry('fb/two:free'), supported_parameters: ['max_tokens'] }, freeEntry('fb/three:free')] } }
  const w2 = waiter({ fallback_models: ['fb/one:free', 'fb/two:free', 'fb/missing:free', 'fb/three:free'], rate_limit_budget_s: 100, rate_limit_max_wait_s: 60 })
  queue = [limited(95), { body: say('COMPLETE: ok') }]
  const r = await w2.go()
  assert.equal(r.ok, true)
  assert.deepEqual(modelsSent(), ['free/model:free', 'fb/three:free'])
  const log = w2.logs.join('\n')
  assert.match(log, /skipping fallback fb\/one:free; .*cannot confirm it is free/)
  assert.match(log, /skipping fallback fb\/two:free/)
  assert.match(log, /skipping fallback fb\/missing:free/)
})

test('fallback: ids in the 429 alternates are never used unless configured and confirmed', async () => {
  const w = fb()
  queue = Array.from({ length: 6 }, () => limited(60))
  await w.go()
  assert.doesNotMatch(JSON.stringify(modelsSent()), /longcat/)
})

test('fallback: every model limited ends with a plain message listing the models tried', async () => {
  const w = fb()
  queue = Array.from({ length: 6 }, () => limited(60))
  const r = await w.go()
  assert.equal(r.ok, false)
  assert.deepEqual(modelsSent(), ['free/model:free', 'fb/one:free', 'fb/two:free'])
  assert.equal(r.summary, 'Nous Portal is rate limiting every free model tried (free/model:free, fb/one:free, fb/two:free); waited 180 seconds; delegate the issue again later.')
  assert.doesNotMatch(r.summary, /[{}]|retry_after|alternates/)
  assert.equal(isTransient(r.summary), false)
})

test('fallback: the run-wide wait cap stops the run even with models left', async () => {
  const w = fb({ total_wait_cap_s: 100, rate_limit_budget_s: 80, rate_limit_max_wait_s: 80 })
  queue = [limited(60), limited(60), limited(60), limited(60), limited(60)]
  const r = await w.go()
  assert.equal(r.ok, false)
  assert.ok(w.sleeps.reduce((a, b) => a + b, 0) <= 100)
  assert.match(r.summary, /waited 60 seconds/)
  assert.equal(isTransient(r.summary), false)
})

test('fallback: the models and the wait cap persist across the runner\'s retry and a nudge (state lives on the launcher)', async () => {
  const w = fb()
  queue = [limited(95), { body: say('no finishing line') }]
  const first = await w.go()
  queue = [{ body: say('COMPLETE: finished') }]
  const r = await w.go({ resume: first.sessionId })
  assert.equal(modelsSent().at(-1), 'fb/one:free') // stays on the fallback, no switching back
  assert.equal(r.summary, 'COMPLETE: finished (models used: free/model:free, fb/one:free)')
})

test('fallback: a catalog that cannot be read leaves the primary only, and says so', async () => {
  for (const bad of [{ status: 500, body: 'down' }, { body: 'not json' }, { body: { data: 'nope' } }]) {
    const w = fb()
    catalog = bad
    queue = [limited(95), { body: say('COMPLETE: ok after waiting') }]
    const r = await w.go()
    assert.equal(r.ok, true)
    assert.deepEqual(seen.map(x => x.body.model), ['free/model:free', 'free/model:free'])
    assert.match(w.logs.join('\n'), /could not read the model catalog, so free\/model:free stays the only model/)
    assert.equal(r.summary, 'COMPLETE: ok after waiting') // no switch, so no models line
  }
})

test('fallback: the catalog is read again at each switch, so a model that stopped being free is caught', async () => {
  const w = fb()
  queue = Array.from({ length: 6 }, () => limited(60))
  await w.go()
  assert.equal(catalogHits, 2) // one read per switch, not one per fallback considered
})

test('fallback: names every model on REVIEW, BLOCKED, no-finishing-line and failure replies', async () => {
  for (const [reply, check] of [
    ['REVIEW: look at the footer', (r: any) => parseEnd(r.summary).summary === 'look at the footer (models used: free/model:free, fb/one:free)'],
    ['BLOCKED needs_input: which year?', (r: any) => parseEnd(r.summary).reason === 'which year? (models used: free/model:free, fb/one:free)'],
    ['all done, no line', (r: any) => r.summary.slice(0, 200).includes('free/model:free, fb/one:free')]
  ] as const) {
    const w = fb()
    queue = [limited(95), { body: say(reply) }]
    assert.ok(check(await w.go()), reply)
  }
  const w = fb()
  queue = [limited(95), { status: 500, body: 'boom' }]
  const r = await w.go()
  assert.equal(r.ok, false)
  assert.match(r.summary, /HTTP 500.*Models used: free\/model:free, fb\/one:free/)
})

test('fallback: the real model ids in the stop messages are not transient', async () => {
  const ids = ['stepfun/step-3.7-flash:free', 'meituan/longcat-2.5:free', 'upstage/solar-mini4:free']
  catalog = { body: { data: ids.slice(1).map(freeEntry) } }
  const t = nous.makeNousLauncher({ base_url: base, model: ids[0], fallback_models: ids.slice(1), rate_limit_budget_s: 100, rate_limit_max_wait_s: 60, key_env: 'LINEAR_NOUS_API_KEY' }, { env: { ...GIT_ENV, LINEAR_NOUS_API_KEY: KEY }, sleep: async () => {}, log: () => {} })
  const cwd = setup().cwd
  queue = Array.from({ length: 6 }, () => limited(60))
  const r = await t({ prompt: 'x', cwd, lists: LISTS, budgetUsd: 2 })
  assert.match(r.summary, /stepfun\/step-3\.7-flash:free, meituan\/longcat-2\.5:free, upstage\/solar-mini4:free/)
  assert.equal(isTransient(r.summary), false)
})

test('cost: a nonzero cost on a fallback stops the run in plain words and still counts the spend', async () => {
  const w = fb()
  const charged = say('COMPLETE: x'); (charged as { usage: Record<string, number> }).usage = { prompt_tokens: 10, completion_tokens: 5, cost: 0.02 } as never
  queue = [limited(95), { body: charged }]
  const r = await w.go()
  assert.equal(r.ok, false)
  assert.equal(r.usd, 0.02)
  assert.match(r.summary, /reported a charge of \$0\.02 on fb\/one:free/)
  assert.equal(isTransient(r.summary), false)
})

test('cost: a nonzero cost on a free-configured primary also stops, and cost 0 is fine', async () => {
  const t = setup()
  const free = say('COMPLETE: ok'); (free as { usage: Record<string, number> }).usage = { prompt_tokens: 10, completion_tokens: 5, cost: 0 } as never
  queue = [{ body: free }]
  assert.equal((await t.go()).ok, true)
  const paid = say('COMPLETE: x'); (paid as { usage: Record<string, number> }).usage = { prompt_tokens: 10, completion_tokens: 5, cost: 0.5 } as never
  queue = [{ body: paid }]
  const r = await t.go()
  assert.equal(r.ok, false)
  assert.match(r.summary, /reported a charge of \$0\.5 on free\/model:free/)
})

test('catalogSaysFree fails closed on price strings, missing pricing and missing tool support', () => {
  assert.equal(nous.catalogSaysFree([freeEntry('a')], 'a'), '')
  assert.notEqual(nous.catalogSaysFree([paidEntry('a')], 'a'), '')
  assert.notEqual(nous.catalogSaysFree([{ id: 'a', supported_parameters: ['tools'] }], 'a'), '')
  assert.notEqual(nous.catalogSaysFree([{ id: 'a', pricing: { prompt: '0' }, supported_parameters: ['tools'] }], 'a'), '')
  assert.notEqual(nous.catalogSaysFree([{ id: 'a', pricing: { prompt: 'free', completion: '0' }, supported_parameters: ['tools'] }], 'a'), '')
  assert.notEqual(nous.catalogSaysFree(null, 'a'), '')
  assert.notEqual(nous.catalogSaysFree([{ ...freeEntry('a'), pricing: { prompt: '0', completion: '0', request: '0.01' } }], 'a'), '') // a per-request fee is not free
  assert.notEqual(nous.catalogSaysFree([{ ...freeEntry('a'), pricing: { prompt: '0', completion: '0', image: 'x' } }], 'a'), '')
})

test('commandRefusal and insidePath are plain functions a reader can check', () => {
  assert.equal(nous.commandRefusal(['git', 'status'], LISTS), '')
  assert.match(nous.commandRefusal('git status', LISTS), /list of strings/)
  assert.match(nous.commandRefusal(['git', 'push', 'origin', 'main'], LISTS), /Denied/)
  mkdirSync(join(tmpdir(), 'nous-x'), { recursive: true })
})
