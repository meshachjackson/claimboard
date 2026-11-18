// Claude CLI login for the Linear runner and the Architect (docs/linear-runner-login.md).
// The interactive login expires. `claude setup-token` makes a long-lived token the CLI reads from CLAUDE_CODE_OAUTH_TOKEN.
// This file does two small things: lets that one variable through to the claude child, and checks the CLI is logged in
// before work starts. The token value is never printed, logged or put in a comment: only the variable's name appears.
import { spawnSync } from 'node:child_process'

export const TOKEN_VAR = 'CLAUDE_CODE_OAUTH_TOKEN'

/**
 * The environment for a claude child. `base` is childEnv's result (it strips every name containing TOKEN, which would drop
 * this one too); the token is added back by name from `env`, only when set and not empty.
 */
export function withClaudeToken(base, env) {
  return env[TOKEN_VAR] ? { ...base, [TOKEN_VAR]: env[TOKEN_VAR] } : base
}

const defaultRun = (cmd, args, env) => { const r = spawnSync(cmd, args, { env, encoding: 'utf8', timeout: 20_000 }); return { status: r.status, stdout: r.stdout ?? '', error: r.error } }

/**
 * Asks the CLI whether it has a login: `claude auth status` prints JSON and exits 1 with none. This is a local check. It sees
 * no login, but NOT a revoked or expired token (the CLI only sees that a token is set); that
 * shows up at the first real call, which isLoginError() recognizes. `run(cmd, args, env)` is swappable for tests.
 * Returns { ok, reason, method } where method is the CLI's authMethod word (oauth_token, claude.ai, ...), never a value.
 */
export function checkLogin({ run = defaultRun, env = process.env, childEnv = e => e } = {}) {
  let r
  try { r = run('claude', ['auth', 'status'], withClaudeToken(childEnv(env), env)) } catch (err) { r = { error: err } }
  // A missing program is not "logged out": say which it is.
  if (r.error) return { ok: false, reason: `the claude program did not run (${String(r.error?.message ?? r.error).slice(0, 100)})` }
  let info = {}
  try { info = JSON.parse(r.stdout || '{}') } catch { /* not JSON: treated as not logged in */ }
  return r.status === 0 && info.loggedIn === true ? { ok: true, reason: '', method: String(info.authMethod ?? '') } : { ok: false, reason: 'the claude program is not logged in' }
}

/** True when a claude reply says the login or token was refused. Texts seen from claude 2.1.318: "Not logged in · Please run /login" and "Failed to authenticate. API Error: 401 Invalid bearer token". */
export const isLoginError = text => /not logged in|please run \/login|failed to authenticate|invalid bearer token|oauth token.*(expired|revoked)/i.test(String(text ?? ''))

export const WAITING = '**Waiting for Meshach (claude login)'

/**
 * Call before each issue. `state` is a plain object the caller keeps ({}). Returns true when work may start. When the CLI has no
 * login (or an earlier call set state.down), it writes one log line per change, comments once on each delegated issue in `queue`
 * (an earlier comment, kept in issue.notes, survives a restart), and returns false (the caller starts nothing). The delegate stays set, so the issues start
 * by themselves after the login is fixed. `check` is swappable for tests.
 */
export async function loginGate({ check = checkLogin, linear, queue, name, warn, state }) {
  const r = state.down ? { ok: false, reason: state.down } : check()
  if (r.ok) {
    if (state.announced) { state.announced = false; warn(`${name}: claude login is back, work resumes.`) }
    if (!state.method) { state.method = r.method || 'unknown'; warn(`${name}: claude login method is ${state.method}${state.method === 'oauth_token' ? '' : ` (the ${TOKEN_VAR} token is not the one in use)`}.`) }
    return true
  }
  if (!state.announced) { state.announced = true; warn(`${name}: not picking up work, ${r.reason}. Fix: docs/linear-runner-login.md (claude setup-token, set ${TOKEN_VAR} in the secrets file (BOARD_SECRETS_FILE), reload the service).`) }
  // Told once: the fetch shows only the last 10 comments, so an in-memory set backs up the marker that survives a restart.
  state.told ??= new Set()
  for (const issue of queue) {
    if (state.told.has(issue.id) || (issue.notes ?? []).some(n => n.startsWith(WAITING))) continue
    state.told.add(issue.id)
    try { await linear.note(issue.id, `${WAITING}):** ${r.reason}, so ${name} did not start this. It stays delegated and starts by itself once the login is fixed (docs/linear-runner-login.md).`) } catch (err) { warn(`${name}: could not comment on ${issue.identifier}: ${String(err?.message ?? err).slice(0, 200)}`) }
  }
  return false
}

/** Wraps a launch function: a reply that says the login was refused marks the gate down (until a restart), so the rest of the queue is not tried. The result passes through unchanged. */
export function watchLogin(launch, state) {
  return async (...args) => {
    const r = await launch(...args)
    if (r && !r.ok && isLoginError(r.summary)) state.down = 'the claude login or token was refused'
    return r
  }
}
