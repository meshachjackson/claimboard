// Waits for a merge to deploy, by reading the commit status the platform posts on the merge commit (for a Vercel project, a
// status named "Vercel"). Agents never deploy: the platform deploys on merge, and this only reads the result.
// Which status to watch is `deploy_on_merge.<repo>.status_context` in the authority file. Node built-ins only.

/** The status name to watch for this repo, or '' when the authority file names none. */
export const statusContext = (authority, repo) => {
  const v = authority.deploy_on_merge?.[repo]?.status_context
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Polls `gh api repos/{owner}/{repo}/commits/<sha>/status` (gh fills owner and repo from the checkout in `cwd`) until the
 * status named `context` succeeds or fails, or `timeoutMs` passes (10 minutes by default). Returns { state: 'success' | 'failure'
 * | 'timeout', url }. A failed read is treated like "not there yet", so a GitHub hiccup does not end the wait early.
 */
export async function deployStatus({ context, sha, gh, cwd, sleep, timeoutMs = 600_000, everyMs = 20_000 }) {
  for (let waited = 0; ; waited += everyMs) {
    const r = gh(['api', `repos/{owner}/{repo}/commits/${sha}/status`], cwd)
    if (r.status === 0) {
      let found
      try { found = (JSON.parse(r.stdout).statuses ?? []).find(s => s.context === context) } catch { found = null }
      if (found?.state === 'success') return { state: 'success', url: String(found.target_url ?? '') }
      if (found && ['failure', 'error'].includes(found.state)) return { state: 'failure', url: String(found.target_url ?? '') }
    }
    if (waited >= timeoutMs) return { state: 'timeout', url: '' }
    await sleep(everyMs)
  }
}
