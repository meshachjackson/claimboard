// POST /api/oauth/consent: the steps behind the consent page (app/pages/oauth/authorize.vue). The owner only.
//   start     check the authorization request and list the identities a connector may sign in as: doors (the owner, through
//             this account;) first, then agent identities
//   choose    make a board token for one identity, keep it only sealed in a short-lived cookie, show its hash
//   continue  once the hash is filed, ask the gateway's whoami; issue a code only if it answers that identity
//   deny      send Claude back with access_denied
// The raw board token never leaves the server: the page sees its SHA-256 and nothing else.
import { connectorIdentities } from '../../utils/door'
import { configuredUrl } from '../../../app/utils/links'

const PENDING_COOKIE = 'vc_pending'

type Body = { step?: string, query?: Record<string, unknown>, agent_id?: string }

/** Active doors and agent identities with a board:class:* row (doors first). */
async function listIdentities() {
  const data = await boardStore().readRegistry()
  return connectorIdentities(data.registry, data.access)
}

export default defineEventHandler(async (event) => {
  await requireAllowedUser(event)
  const key = connectorSealKey()
  const body = (await readBody(event).catch(() => null) ?? {}) as Body
  const now = nowSeconds()

  if (body.step === 'continue') {
    const pending = readPending(getCookie(event, PENDING_COOKIE), key, now)
    if (!pending) return { ok: false, reason: 'This sign-in expired. Start again from Claude.' }
    const who = await boardStore().write('whoami', {}, { token: pending.board_token as string })
    if (!who.ok) return { ok: false, reason: `The board refused the token: ${who.reason}. File the hash, then press Continue again.` }
    if (who.agent_id !== pending.agent_id) return { ok: false, reason: `The token belongs to ${who.agent_id ?? 'another identity'}, not ${pending.agent_id}.` }
    deleteCookie(event, PENDING_COOKIE, { path: '/api/oauth' })
    return { ok: true, redirect: codeRedirect(pending, publicOrigin(event), key, now) }
  }

  const check = checkAuthorizeRequest(body.query ?? {}, mcpResource(event), key)
  if (!check.ok) return { ok: false, reason: check.reason }
  const req = check.req

  if (body.step === 'start') {
    return { ok: true, redirect_host: new URL(req.redirect_uri).host, identities: await listIdentities() }
  }

  if (body.step === 'choose') {
    const identity = (await listIdentities()).find(i => i.agent_id === body.agent_id)
    if (!identity) return { ok: false, reason: `${String(body.agent_id)} isn't an active identity with a board:class row.` }
    // Fixtures mode has no board_tokens table: its gateway stand-in knows only fixture:<agent_id> tokens (fixtures.ts).
    const token = boardStore().source() === 'fixtures' ? `${FIXTURE_TOKEN_PREFIX}${identity.agent_id}` : newBoardToken()
    setCookie(event, PENDING_COOKIE, sealPending(req, identity.agent_id, token, key, now), {
      path: '/api/oauth',
      httpOnly: true,
      sameSite: 'lax',
      secure: publicOrigin(event).startsWith('https:'),
      maxAge: PENDING_SECONDS
    })
    return { ok: true, ...identity, token_sha256: tokenSha256(token), form_url: configuredUrl(useRuntimeConfig(event).boardTokenFormUrl), fixtures: boardStore().source() === 'fixtures' }
  }

  if (body.step === 'deny') {
    const url = new URL(req.redirect_uri)
    url.searchParams.set('error', 'access_denied')
    if (req.state) url.searchParams.set('state', req.state)
    url.searchParams.set('iss', publicOrigin(event))
    return { ok: true, redirect: url.toString() }
  }

  throw createError({ statusCode: 400, statusMessage: 'Unknown step' })
})
