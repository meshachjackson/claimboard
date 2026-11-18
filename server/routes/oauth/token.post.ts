// POST /oauth/token: authorization_code (PKCE S256) and refresh_token grants. Takes form-urlencoded.
// Every refresh asks the gateway's whoami first, so an identity whose hash was revoked in form.gov-board-token
// can't refresh. Answers never carry a token in a log line: the gateway logs only the op and outcome.

// Codes are stateless and so can't be made strictly single-use. This instance remembers the codes it has
// redeemed until they expire, which stops a replay here; PKCE stops anyone without the verifier anywhere.
const redeemed = new Map<string, number>()

function rememberCode(code: string, now: number): boolean {
  for (const [hash, exp] of redeemed) if (exp <= now) redeemed.delete(hash)
  const hash = tokenSha256(code)
  if (redeemed.has(hash)) return false
  redeemed.set(hash, now + CODE_SECONDS)
  return true
}

export default defineEventHandler(async (event) => {
  setResponseHeaders(event, { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' })
  const refuse = (status: number, error: string, description: string) => {
    setResponseStatus(event, status)
    return { error, error_description: description }
  }

  const key = connectorSealKey()
  if (!getHeader(event, 'content-type')?.includes('application/x-www-form-urlencoded')) {
    return refuse(400, 'invalid_request', 'The body must be application/x-www-form-urlencoded')
  }
  const form = (await readBody(event).catch(() => null) ?? {}) as Record<string, unknown>
  const now = nowSeconds()

  if (form.grant_type === 'authorization_code') {
    const grant = redeemCode(form, key, now)
    if ('error' in grant) return refuse(400, grant.error, grant.error_description)
    if (!rememberCode(String(form.code), now)) return refuse(400, 'invalid_grant', 'The code was already used.')
    return issueTokens(grant, key, now)
  }

  if (form.grant_type === 'refresh_token') {
    const grant = readRefresh(form, key, now)
    if ('error' in grant) return refuse(400, grant.error, grant.error_description)
    const who = await boardStore().write('whoami', {}, { token: grant.board_token })
    if (!who.ok) return refuse(400, 'invalid_grant', `The board refused this identity: ${who.reason}`)
    if (who.agent_id !== grant.agent_id) return refuse(400, 'invalid_grant', 'The board token no longer belongs to this identity.')
    return issueTokens(grant, key, now)
  }

  return refuse(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token')
})
