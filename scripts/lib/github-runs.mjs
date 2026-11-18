// The GitHub Actions calls the cloud worker and its sweep make (scripts/linear-job.mjs): how many linear-agent.yml runs started
// today, which ones are still queued or running, and starting a new one. Node built-ins only (fetch). The token is passed in
// and never printed or put in an error.
export const WORKFLOW = 'linear-agent.yml'
const API = 'https://api.github.com'

/**
 * `repo` is owner/name (GITHUB_REPOSITORY in a job). `token` needs Actions read for the counts and Actions write to dispatch.
 * Every call throws with the HTTP status only when GitHub refuses it.
 */
export function makeGitHubRuns({ repo, token, fetch: send = globalThis.fetch, workflow = WORKFLOW }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo ?? ''))) throw new Error('GITHUB_REPOSITORY must be owner/name.')
  if (!token) throw new Error('No GitHub token is set for the run count (GITHUB_TOKEN).')
  const call = async (method, path, body) => {
    const res = await send(`${API}/repos/${repo}/actions/workflows/${workflow}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body && { 'content-type': 'application/json' }) },
      ...(body && { body: JSON.stringify(body) })
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${method} ${workflow}${path.split('?')[0]}`)
    return res.status === 204 ? null : res.json()
  }
  return {
    /** Runs of the workflow created on `day` (YYYY-MM-DD, UTC) or later. This job's own run counts too. */
    runsSince: async (day) => (await call('GET', `/runs?created=%3E%3D${day}&per_page=1`)).total_count ?? 0,

    /** Queued, waiting and running runs, as their titles. The run-name is "<role> <issue>", so a title names its issue. */
    activeTitles: async () => (await Promise.all(['queued', 'waiting', 'in_progress'].map(status => call('GET', `/runs?status=${status}&per_page=100`))))
      .flatMap(page => (page.workflow_runs ?? []).map(r => String(r.display_title ?? ''))),

    /** Starts one run on `ref` with these inputs (all strings). */
    dispatch: (inputs, ref = 'main') => call('POST', '/dispatches', { ref, inputs })
  }
}

/** True when one of the titles is a run for this issue (the run-name is "<role> <issue>"). */
export const hasActiveRun = (titles, identifier) => titles.some(t => t.split(/\s+/).includes(identifier))
