// Helpers both runners share: scripts/linear-run.mjs (Linear) and scripts/board-run.mjs (the frozen board dispatcher) import
// them from here, so the Linear runner depends on no board code. Plain JS, Node built-ins only.

/**
 * The branch a card's worktree starts from. Local main when origin/main is behind it or equal (unpushed work is common here),
 * origin/main when the remote has moved past local main, and main when there is no origin/main.
 */
export function baseFor(repo, git) {
  if (git(['-C', repo, 'rev-parse', '--verify', 'origin/main']).status !== 0) return 'main'
  return git(['-C', repo, 'merge-base', '--is-ancestor', 'origin/main', 'main']).status === 0 ? 'main' : 'origin/main'
}

// What an unattended session may never run: every push is denied (Meshach merges and pushes), and so are publish, deploy and installs.
export const DENIED_TOOLS = ['Bash(git push*)', 'Bash(gh *)', 'Bash(npm publish*)', 'Bash(pnpm publish*)', 'Bash(pnpm -C * publish*)', 'Bash(vercel*)', 'Bash(rm -rf*)',
  'Bash(pnpm * dlx*)', 'Bash(pnpm dlx*)', 'Bash(pnpm * add *)', 'Bash(pnpm add *)', 'Bash(gh pr merge*)']
// grep, wc and cat are what most "done when" checks use; without them a check that says `grep -c` counts as uncheckable.
const VERIFIER_TOOLS = ['Read', 'Glob', 'Grep', 'Bash(git *)', 'Bash(ls *)', 'Bash(grep *)', 'Bash(wc *)', 'Bash(cat *)', 'Bash(head *)', 'Bash(tail *)', 'Bash(diff *)', 'Bash(sort *)', 'Bash(node *)', 'Bash(python3 *)', 'Bash(pytest *)', 'Bash(pnpm test*)',
  'Bash(pnpm typecheck*)', 'Bash(pnpm -C * test*)', 'Bash(pnpm -C * typecheck*)', 'Bash(npm test*)']


export const common = (worktree, maxUsd, extraDirs, resume, mcp = '{"mcpServers":{}}') => [...(resume ? ['--resume', resume] : []), '-p', '--output-format', 'json', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', mcp,
  '--max-budget-usd', String(maxUsd), '--add-dir', worktree, ...extraDirs.flatMap(d => ['--add-dir', d])]

/** The verifier: loop-verifier, read-only tools plus test commands, no Edit or Write. */
export function verifierCommand({ worktree, maxUsd, extraDirs = [] }) {
  return [...common(worktree, maxUsd, extraDirs), '--agent', 'loop-verifier', '--allowedTools', ...VERIFIER_TOOLS, '--disallowedTools', ...DENIED_TOOLS]
}

/** The environment the agent gets: no token, secret, password or key, except the one the claude program needs. */
export function childEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k === 'ANTHROPIC_API_KEY' || !/TOKEN|SECRET|PASSWORD|KEY/i.test(k)))
}

/** True when an agent's reply says it could not run something here (no shell, no API key, permission denied). */
export function blockedByEnvironment(summary) {
  const text = String(summary)
  const cannot = /\b(can'?t|cannot|could not|couldn'?t|unable to|not able to|denied|do(?:es)?n'?t have)\b/i
  const missing = /\b(bash|shell|api key|_API_KEY|credential|token|permission|dev server)\b/i
  return cannot.test(text) && missing.test(text)
}

/** The last "VERDICT: PASS|FAIL" line in a verifier's reply; anything else is FAIL (an uncheckable result counts as failed). */
export function parseVerdict(text) {
  const all = [...String(text).matchAll(/VERDICT:\s*(PASS|FAIL)/gi)]
  return all.length ? all[all.length - 1][1].toUpperCase() : 'FAIL'
}

/** claude --output-format json prints one result object (or a list of events that ends with one). */
export function parseClaudeJson(text) {
  try {
    const data = JSON.parse(text)
    const res = Array.isArray(data) ? data.findLast(x => x?.type === 'result') : data
    return { summary: String(res?.result ?? '').trim(), usd: Number(res?.total_cost_usd) || 0, isError: !!res?.is_error, ...(res?.session_id && { sessionId: String(res.session_id) }) }
  } catch { return { summary: String(text).trim(), usd: 0, isError: false } }
}
