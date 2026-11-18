// GET /api/status: the latest production build (Vercel) and the open PR count (GitHub) for the header.
// Cached 60 seconds, so the header poll costs at most one call a minute per service. A service whose env
// is unset, or that fails, comes back null and the header leaves it out. Tokens stay on the server.
import { parseDeploy, parsePrs, type BoardStatus } from '~~/shared/status'

const KEY = 'status'
const TTL_SECONDS = 60

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  try {
    return await $fetch(url, { headers, timeout: 5000 })
  } catch (err) {
    console.error(`[status] ${new URL(url).host} failed: ${(err as Error).message}`)
    return null
  }
}

export default defineEventHandler(async (event): Promise<BoardStatus> => {
  await requireAllowedUser(event)

  const cached = await cacheGet<BoardStatus>(KEY)
  if (cached) return cached

  const { vercelToken, vercelProjectId, vercelTeamId, githubToken, public: { repoSlug } } = useRuntimeConfig(event)
  const REPO = String(repoSlug ?? '') // owner/name; empty leaves the PR count out

  const [deployBody, prsBody] = await Promise.all([
    vercelToken && vercelProjectId
      ? getJson(
        `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(vercelProjectId)}&target=production&limit=1`
        + (vercelTeamId ? `&teamId=${encodeURIComponent(vercelTeamId)}` : ''),
        { Authorization: `Bearer ${vercelToken}` }
      )
      : null,
    githubToken && REPO
      ? getJson(
        `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${REPO} is:pr is:open`)}&per_page=1`,
        { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' }
      )
      : null
  ])

  const status: BoardStatus = { deploy: parseDeploy(deployBody), prs: REPO ? parsePrs(prsBody, REPO) : null }
  await cacheSet(KEY, status, TTL_SECONDS)
  return status
})
