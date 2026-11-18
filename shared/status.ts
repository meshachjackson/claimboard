// Header status: the latest production build and the open PR count.
// Pure mappers, so `pnpm test` can run them without Nuxt.

export type BuildState = 'building' | 'ready' | 'error' | 'canceled'

export interface BoardStatus {
  deploy: { state: BuildState, url: string, createdAt: string, branch: string, sha: string } | null
  prs: { open: number, url: string } | null
}

/** Vercel's readyState values folded into the four the header shows. Queued and initializing count as building. */
export function buildState(readyState: string | undefined): BuildState {
  switch (readyState) {
    case 'READY': return 'ready'
    case 'ERROR': return 'error'
    case 'CANCELED': return 'canceled'
    default: return 'building'
  }
}

/** The first deployment of a Vercel `GET /v6/deployments` answer, or null when there is none. */
export function parseDeploy(body: any): BoardStatus['deploy'] {
  const d = body?.deployments?.[0]
  if (!d || typeof d.url !== 'string') return null
  return {
    state: buildState(d.readyState ?? d.state),
    url: `https://${d.url}`,
    createdAt: new Date(Number(d.created)).toISOString(),
    branch: String(d.meta?.githubCommitRef ?? ''),
    sha: String(d.meta?.githubCommitSha ?? '').slice(0, 7)
  }
}

/** The open PR count of a GitHub issue search answer, or null when the answer has no count. */
export function parsePrs(body: any, repo: string): BoardStatus['prs'] {
  if (typeof body?.total_count !== 'number') return null
  return { open: body.total_count, url: `https://github.com/${repo}/pulls` }
}
