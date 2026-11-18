// Mints a Linear app token with the client credentials grant, for one cloud job (scripts/linear-job.mjs). The same request
// scripts/linear-token.mjs makes by hand, without the prompts and the secrets file: the token lives only in this process.
// The client secret and the token are never printed or put in an error. Node built-ins only (fetch).
export const TOKEN_URL = 'https://api.linear.app/oauth/token'
export const SCOPE = 'read,write,app:assignable,app:mentionable'

/** The env names for a role's app credentials: LINEAR_<ROLE>_CLIENT_ID and LINEAR_<ROLE>_CLIENT_SECRET. */
export const credentialNames = role => ({ id: `LINEAR_${role.toUpperCase()}_CLIENT_ID`, secret: `LINEAR_${role.toUpperCase()}_CLIENT_SECRET` })

/** Resolves with the access token. Throws with Linear's error name and HTTP status only. */
export async function mintAppToken({ clientId, clientSecret, fetch: send = globalThis.fetch }) {
  const res = await send(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: SCOPE }).toString()
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new Error(`Linear refused the token request (HTTP ${res.status}): ${String(body.error ?? 'no error name').slice(0, 80)}`)
  return body.access_token
}
