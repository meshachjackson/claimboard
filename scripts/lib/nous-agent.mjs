// The Nous Portal builder for scripts/linear-run.mjs: a small tool loop over an OpenAI-style chat completions API.
// makeNousLauncher() returns a `launch` with the same shape as launchClaude: ({ prompt, cwd, lists, resume, budgetUsd }) ->
// { ok, summary, usd, sessionId }. The rest of the runner (nudges, verifier, publish, caps) does not know the difference.
// Plan:. Node built-ins only. The API key is read from the env name in the config
// and appears only in the Authorization header. Every string that leaves this file is scrubbed of it.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { childEnv } from './runner-core.mjs'

const clip = (text, n) => String(text ?? '').slice(0, n)
// Nous Portal refuses a chat request unless it carries a `tags` list with a product tag and a user tag. Seen live: no tags gave
// HTTP 400 "missing tags"; a product tag alone gave "missing user tag"; both gave 200 (a top-level `user` field does not count).
// Hermes sends only product and client tags because it signs in with OAuth; an API key needs the user tag. Both values are labels for
// attribution, not secrets, and carry no personal data. `backends.nous.tags` overrides them.
const DEFAULT_TAGS = ['product=agent-board-runner', 'user=agent-board-runner']
// A model counts as free only when the catalog says so: the id is listed, prompt and completion prices are numerically 0, and it takes tools.
// Seen live 11/12/2026: free models carry a `:free` id suffix and price 0; the suffix alone is not trusted. Fails closed.
// Returns '' when free, otherwise the reason it could not be confirmed.
export function catalogSaysFree(catalog, id) {
  const m = (Array.isArray(catalog) ? catalog : []).find(x => x?.id === id)
  if (!m) return 'does not list it'
  const p = m.pricing
  // Every price field must be 0 (a per-request or other fee would not be free); a missing or non-numeric one fails closed.
  if (!p || typeof p !== 'object' || p.prompt == null || p.completion == null || !Object.values(p).every(v => v !== '' && v != null && Number(v) === 0)) return 'does not show it priced at 0'
  if (!Array.isArray(m.supported_parameters) || !m.supported_parameters.includes('tools')) return 'does not show tool support for it'
  return ''
}
const READ_CHARS = 10_000, OUT_CHARS = 20_000, GREP_HITS = 100

export const TOOLS = [
  ['read_file', 'Read a text file in the worktree. Long files come back in parts: pass offset (line number, from 1) and limit (lines).', { path: 'string', offset: 'number?', limit: 'number?' }],
  ['write_file', 'Create or overwrite a file in the worktree.', { path: 'string', content: 'string' }],
  ['edit_file', 'Replace one exact piece of text in a file. `old` must appear exactly once.', { path: 'string', old: 'string', new: 'string' }],
  ['list_files', 'List the files and folders in a folder of the worktree (default: the top).', { path: 'string?' }],
  ['grep', 'Search the worktree for a regular expression. Returns file:line: text.', { pattern: 'string', path: 'string?' }],
  ['run', 'Run one allowed command with no shell. argv is the program then its arguments, for example ["git","commit","-m","Fix the footer"]. No &&, pipes or redirects.', { argv: 'array' }]
].map(([name, description, props]) => ({
  type: 'function',
  function: {
    name, description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(Object.entries(props).map(([k, t]) => [k, t.startsWith('array') ? { type: 'array', items: { type: 'string' } } : { type: t.replace('?', '') }])),
      required: Object.entries(props).filter(([, t]) => !t.endsWith('?')).map(([k]) => k)
    }
  }
}))

/** childEnv keeps ANTHROPIC_API_KEY for the Claude builder. Command output goes to Nous, so nothing named like a key or Anthropic's env reaches a command here. */
const commandEnv = env => Object.fromEntries(Object.entries(env).filter(([k]) => !/^ANTHROPIC_|TOKEN|SECRET|PASSWORD|KEY/i.test(k)))

// The runner pushes and opens the pull request itself after the verifier passes, so this builder gets neither, whatever the tier allows.
const EXTRA_DENY = ['Bash(git push*)', 'Bash(gh *)']

// ---------- The command rules: the same allow and deny lists the Claude builder gets ----------

/** `Bash(git push*)` -> /^git push.*$/. Only `*` is special. */
function patternRegex(pattern) {
  const inner = /^Bash\((.*)\)$/.exec(pattern)?.[1]
  if (inner == null) return null
  return new RegExp(`^${inner.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
}
const matches = (patterns, text) => patterns.some(p => patternRegex(p)?.test(text))
const SHELL_WORDS = new Set(['&&', '||', ';', '|', '>', '>>', '<', '&', '2>&1'])

/** '' when the command may run; otherwise why not. `lists` is toolLists() from linear-run.mjs. */
export function commandRefusal(argv, lists) {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every(a => typeof a === 'string')) return 'argv must be a list of strings, the program first.'
  if (/\s/.test(argv[0])) return 'The first item of argv is the program alone, with no spaces. Put arguments in the following items.'
  if (argv.some(a => a.includes('$(') || a.includes('`'))) return 'Command substitution ($(...) and backticks) is not available. Put the plain text in the argument.'
  if (argv.some(a => SHELL_WORDS.has(a))) return 'There is no shell: &&, ;, pipes and redirects are not available. Run each command on its own.'
  // `git -C <dir> push` would hide the subcommand from the push rule, so git takes its subcommand first.
  if (argv[0] === 'git' && argv[1]?.startsWith('-')) return 'Put the git subcommand first: git <subcommand> [options].'
  const text = argv.join(' ')
  if (matches([...lists.deny, ...EXTRA_DENY], text)) return `Denied: ${clip(text, 80)} is on the deny list.`
  if (!matches(lists.allow, text)) return `Not allowed: ${clip(text, 80)} is not on the allow list.`
  return ''
}

// ---------- Paths: every file tool stays inside the worktree ----------

/** The absolute path for `p` inside `root`, or throws. Follows symlinks on the part that exists, and keeps out of .git. */
export function insidePath(root, p) {
  const real = realpathSync(root)
  const abs = resolve(root, String(p ?? '.'))
  let probe = abs, rest = ''
  while (!existsSync(probe)) { rest = join(basename(probe), rest); probe = dirname(probe) }
  const full = join(realpathSync(probe), rest)
  if (full !== real && !full.startsWith(real + sep)) throw new Error(`${clip(p, 80)} is outside the worktree.`)
  if (relative(real, full).split(sep)[0] === '.git') throw new Error('Use the git command, not file tools, for .git.')
  return full
}

// ---------- The tools ----------

function walk(dir, out = [], root = dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out, root)
    else if (e.isFile()) out.push(full)
    if (out.length > 5000) break
  }
  return out
}

function runCommand(argv, cwd, env, timeoutMs, spawnFn) {
  return new Promise(done => {
    let out = '', killed = false
    const child = spawnFn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { out += d })
    child.on('error', err => { clearTimeout(timer); done(`Could not start: ${err.message}`) })
    child.on('close', code => { clearTimeout(timer); done(`${killed ? `Killed after ${timeoutMs / 1000} s. ` : ''}exit ${code}\n${clip(out, OUT_CHARS)}`) })
  })
}

async function useTool(name, a, ctx) {
  const { cwd, lists } = ctx
  if (name === 'run') {
    const why = commandRefusal(a.argv, lists)
    return why || runCommand(a.argv, cwd, ctx.childEnv, ctx.timeoutMs, ctx.spawn)
  }
  if (name === 'list_files') {
    const dir = insidePath(cwd, a.path)
    return readdirSync(dir, { withFileTypes: true }).filter(e => e.name !== '.git').map(e => e.name + (e.isDirectory() ? '/' : '')).join('\n') || '(empty)'
  }
  if (name === 'grep') {
    const re = new RegExp(String(a.pattern)), root = insidePath(cwd, a.path), hits = []
    for (const f of statSync(root).isDirectory() ? walk(root) : [root]) {
      let text; try { text = readFileSync(f, 'utf8') } catch { continue }
      if (text.includes('\0')) continue
      text.split('\n').forEach((line, i) => { if (hits.length < GREP_HITS && re.test(line)) hits.push(`${relative(realpathSync(cwd), f)}:${i + 1}: ${clip(line, 200)}`) })
    }
    return hits.join('\n') || 'no matches'
  }
  const file = insidePath(cwd, a.path)
  if (name === 'read_file') {
    const lines = readFileSync(file, 'utf8').split('\n'), from = Math.max(1, Number(a.offset) || 1), want = Number(a.limit) || lines.length
    const text = lines.slice(from - 1, from - 1 + want).join('\n')
    return text.length > READ_CHARS ? `${text.slice(0, READ_CHARS)}\n[cut at ${READ_CHARS} characters; call again with offset and limit for the rest. The file has ${lines.length} lines.]` : text
  }
  if (name === 'write_file') { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, String(a.content ?? '')); return `wrote ${relative(realpathSync(cwd), file)}` }
  if (name === 'edit_file') {
    const text = readFileSync(file, 'utf8'), old = String(a.old ?? '')
    const n = old ? text.split(old).length - 1 : 0
    if (n !== 1) return `edit refused: \`old\` appears ${n} times; it must appear exactly once.`
    writeFileSync(file, text.replace(old, () => String(a.new ?? '')))
    return `edited ${relative(realpathSync(cwd), file)}`
  }
  return `unknown tool ${name}`
}

// ---------- The loop ----------

/**
 * `config` is backends.nous from the authority file: base_url, model, key_env, max_turns, max_tokens, price_in, price_out
 * (dollars per million tokens; 0 for a free model), timeouts, rate_limit_max_wait_s and rate_limit_budget_s (per model), total_wait_cap_s
 * (all models, seconds spent waiting), fallback_models (ordered ids, each used only after the catalog confirms it is free). `deps`: env (holds the key), fetch, spawn, childEnv.
 * The message list for each session is kept in memory, so a nudge (`resume`) continues the same conversation.
 */
export function makeNousLauncher(config, deps = {}) {
  const env = deps.env ?? process.env, send = deps.fetch ?? globalThis.fetch
  const key = env[config.key_env ?? 'LINEAR_NOUS_API_KEY']
  const scrub = s => (key ? String(s).split(key).join('[key]') : String(s))
  const sessions = new Map()
  // Run-wide state. The launcher is built once per issue run, and the runner's retries and nudges call it again, so none of this lives in launch().
  const fallbacks = Array.isArray(config.fallback_models) ? config.fallback_models.filter(m => typeof m === 'string' && m) : []
  const run = { model: config.model, models: [config.model], skipped: [], next: 0, modelWait: 0, totalWait: 0 }
  const startHeads = new Map() // cwd -> HEAD when this launcher first saw it, so nudge turns still know what the builder committed
  const sleep = deps.sleep ?? (s => new Promise(done => setTimeout(done, s * 1000)))
  const log = deps.log ?? (line => console.log(line))
  const maxWait = config.rate_limit_max_wait_s ?? 180, waitBudget = config.rate_limit_budget_s ?? 600
  const totalCap = config.total_wait_cap_s ?? 1200 // seconds spent waiting on rate limits, all models together, per run
  const modelsText = () => run.models.join(', ')
  const ctxFor = (cwd, lists) => ({ cwd, lists, spawn: deps.spawn ?? spawn, childEnv: commandEnv((deps.childEnv ?? childEnv)(deps.env ?? process.env)), timeoutMs: (config.command_timeout_s ?? 120) * 1000 })

  /** The public model catalog, read fresh each time a switch is wanted (so a model that stopped being free is caught). null when it cannot be read. */
  async function readCatalog() {
    let found = null
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30_000)
    try {
      const res = await send(`${String(config.base_url).replace(/\/+$/, '')}/models`, { signal: ctl.signal, headers: { authorization: `Bearer ${key}` } })
      const list = res.ok ? (await res.json())?.data : null
      found = Array.isArray(list) ? list : null
    } catch { found = null } finally { clearTimeout(timer) }
    return found
  }

  /** Moves to the next configured fallback that the catalog confirms is free. true when it switched. Ids from a 429's `alternates` are never used. */
  async function switchModel() {
    let catalog // read at most once per switch, when the first fallback is considered
    while (run.next < fallbacks.length) {
      const id = fallbacks[run.next++]
      if (run.models.includes(id) || run.skipped.includes(id)) continue
      catalog ??= await readCatalog()
      if (!catalog) { run.next--; log(`Nous Portal: could not read the model catalog, so ${run.model} stays the only model for this run.`); return false }
      const why = catalogSaysFree(catalog, id)
      if (why) { run.skipped.push(id); log(`Nous Portal: skipping fallback ${id}; the catalog ${why}, so I cannot confirm it is free.`); continue }
      log(`Nous Portal: ${run.model} is rate limited; switching to ${id} (confirmed free in the catalog).`)
      run.model = id; run.models.push(id); run.modelWait = 0
      return true
    }
    return false
  }

  /** The models list for the runner: appended to the finishing line (which the runner copies into the Linear reply and the pull request)
   *  when more than one model worked on the run. A single-model run is unchanged. */
  function naming(text) {
    if (run.models.length < 2) return text
    const lines = String(text).split('\n')
    for (let i = lines.length - 1; i >= 0; i--) if (/^\s*(COMPLETE|REVIEW|BLOCKED\s+(?:needs_input|dependency|transient|capability)|CANNOT PLAN)\s*:/i.test(lines[i])) { lines[i] += ` (models used: ${modelsText()})`; return lines.join('\n') }
    return `Models used: ${modelsText()}.\n${text}` // first, because the runner keeps only the start of a reply with no finishing line
  }

  /** One request. A 429 that names a numeric retry_after is waited out and the same request is sent again; the wait counts against neither
   *  the dollar cap nor the runner's retries. When the model has used its wait budget, or one wait would pass the per-wait cap, the run moves
   *  to the next confirmed-free fallback and sends the same messages there with a fresh budget. A 429 with no usable retry_after throws the
   *  plain HTTP 429 error, which the runner treats as transient and retries after its own short pause. */
  async function chat(messages) {
    if (!key) throw new Error(`No Nous Portal key is set (env name ${config.key_env ?? 'LINEAR_NOUS_API_KEY'}).`)
    for (;;) {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), (config.request_timeout_s ?? 180) * 1000)
      let res
      try {
        res = await send(`${String(config.base_url).replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST', signal: ctl.signal,
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: run.model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: config.max_tokens ?? 4096, tags: config.tags ?? DEFAULT_TAGS })
        })
        if (res.ok) return await res.json()
        const text = String(await res.text?.().catch(() => '') ?? '')
        if (res.status === 429) {
          let after = NaN; try { const raw = JSON.parse(text)?.retry_after; if (typeof raw === 'number' || (typeof raw === 'string' && raw.trim())) after = Number(raw) } catch { /* not JSON: no usable retry_after */ }
          if (Number.isFinite(after) && after >= 0) {
            const seconds = Math.max(1, Math.ceil(Math.min(after, maxWait)))
            clearTimeout(timer)
            if ((after > maxWait || run.modelWait + seconds > waitBudget) && await switchModel()) continue
            if (run.modelWait + seconds > waitBudget || run.totalWait + seconds > totalCap) throw Object.assign(new Error('rate limit wait spent'), { rateLimited: true, waited: run.totalWait })
            run.modelWait += seconds; run.totalWait += seconds
            log(`Nous Portal rate limit on ${run.model}: waiting ${seconds} s (${run.modelWait} of ${waitBudget} s used for this model, ${run.totalWait} of ${totalCap} s in all) before trying again.`)
            await sleep(seconds)
            continue
          }
        }
        // Show the API's own message when the body is JSON, not the raw dump. The status stays in the text.
        let shown = text; try { const m = JSON.parse(text)?.message; if (typeof m === 'string' && m) shown = m } catch { /* plain text */ }
        throw new Error(`Nous Portal HTTP ${res.status}: ${clip(shown, 300)}`)
      } finally { clearTimeout(timer) }
    }
  }

  return async function launch({ prompt, cwd, lists, resume, budgetUsd }) {
    let usd = 0
    const ctx0 = { cwd, env: commandEnv((deps.childEnv ?? childEnv)(deps.env ?? process.env)) }
    const head = () => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, env: ctx0.env, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } }
    if (!startHeads.has(cwd)) startHeads.set(cwd, head())
    const startHead = startHeads.get(cwd)
    try {
      const sessionId = resume && sessions.has(resume) ? resume : `nous-${sessions.size + 1}`
      const messages = sessions.get(sessionId) ?? [{ role: 'system', content: systemText(lists) }]
      sessions.set(sessionId, messages)
      messages.push({ role: 'user', content: prompt })
      const ctx = ctxFor(cwd, lists)
      for (let turn = 0; turn < (config.max_turns ?? 40); turn++) {
        const data = await chat(messages)
        const msg = data?.choices?.[0]?.message
        if (!msg) throw new Error(`Nous Portal sent no message: ${clip(JSON.stringify(data), 200)}`)
        // These models must cost nothing. A charge the API reports stops the run on any fallback, and on a primary that is configured as free.
        const charged = Number(data.usage?.cost)
        if (charged > 0 && (run.model !== config.model || !(config.price_in > 0 || config.price_out > 0))) {
          usd += charged
          return { ok: false, usd, sessionId, summary: `Stopped: Nous Portal reported a charge of $${charged} on ${run.model}, and this backend is set to use free models only. Nothing more was sent. Check the Nous account before delegating again.${run.models.length > 1 ? ` Models used: ${modelsText()}.` : ''}` }
        }
        usd += ((data.usage?.prompt_tokens ?? 0) * (config.price_in ?? 0) + (data.usage?.completion_tokens ?? 0) * (config.price_out ?? 0)) / 1e6
        messages.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls?.length && { tool_calls: msg.tool_calls }) })
        if (!msg.tool_calls?.length) return { ok: true, summary: scrub(naming(clip(msg.content ?? '', 1500))), usd, sessionId }
        for (const call of msg.tool_calls) {
          let result
          try { result = await useTool(call.function?.name, JSON.parse(call.function?.arguments || '{}'), ctx) } catch (err) { result = `error: ${err.message}` }
          messages.push({ role: 'tool', tool_call_id: call.id, content: scrub(clip(result, OUT_CHARS)) })
        }
        if (usd >= budgetUsd) return { ok: true, summary: naming('Stopped: the dollar cap for this attempt is spent.'), usd, sessionId }
      }
      return { ok: true, summary: naming(`Stopped after ${config.max_turns ?? 40} tool rounds without a finishing line.`), usd, sessionId }
    } catch (err) {
      if (err?.rateLimited) {
        // Plain words, no raw JSON, and none of the transient words the runner retries on: the wait budget is spent, so retrying now would only wait again.
        const kept = head() && head() !== startHead ? ' The builder had already committed work in the worktree; it is kept.' : ''
        const who = run.models.length > 1 ? `every free model tried (${modelsText()})` : 'this model'
        return { ok: false, usd, summary: `Nous Portal is rate limiting ${who}; waited ${err.waited} seconds; delegate the issue again later.${kept}` }
      }
      return { ok: false, summary: scrub(clip(err?.name === 'AbortError' ? 'Nous Portal request timed out (network error).' : (err?.message ?? err), 400)) + (run.models.length > 1 ? ` Models used: ${modelsText()}.` : ''), usd }
    }
  }
}

/** The system message: how to use the tools and what the runner will accept. */
function systemText(lists) {
  return ['You are a coding agent working in one git worktree. Use the tools to read, edit and test. Make small, exact edits.',
    'The `run` tool takes argv (a list), runs no shell, and accepts only these commands (* matches anything):',
    ...lists.allow.filter(p => p.startsWith('Bash(') && !/^Bash\((gh|git push)/.test(p)).map(p => `- ${p.slice(5, -1)}`),
    'Work through the tools. End your final reply, with no tool call, with the finishing line the task describes.'].join('\n')
}
