// The orchestrator connector's OAuth 2.1 authorization server (option B).
// Stateless: the client id, the consent cookie, the code and both tokens are sealed values (seal.ts).
// Each one carries the board token the owner filed through form.gov-board-token, so /mcp can send that
// token on to the gateway exactly as a Phase A caller would. Revoking the hash in the form ends every grant.
// The pure helpers come first and are tested with `node --test`; the last section needs Nuxt.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { seal, unseal } from './seal.ts'
import type { SealPayload } from './seal.ts'

/** claude.ai, Claude Desktop and the mobile apps all come back here. */
export const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

export const PENDING_SECONDS = 10 * 60 // consent: time to file the hash and press Continue
export const CODE_SECONDS = 5 * 60
export const ACCESS_SECONDS = 60 * 60
export const REFRESH_SECONDS = 30 * 24 * 60 * 60

const MAX_REDIRECTS = 5

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

// ---------- Redirect allowlist ----------

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/** claude.ai's callback, or a plain-http loopback URI (Claude Code listens on a port of its choosing, RFC 8252 7.3). */
export function allowedRedirect(uri: unknown): boolean {
  if (typeof uri !== 'string') return false
  if (uri === CLAUDE_CALLBACK) return true
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  return url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname) && !url.username && !url.password && !url.hash
}

// ---------- PKCE (S256 only) ----------

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/ // base64url of a SHA-256, no padding

export function validChallenge(challenge: unknown): challenge is string {
  return typeof challenge === 'string' && CHALLENGE.test(challenge)
}

/** True when base64url(SHA-256(verifier)) equals the challenge sent with the authorization request. */
export function pkceOk(verifier: unknown, challenge: unknown): boolean {
  if (typeof verifier !== 'string' || !VERIFIER.test(verifier) || !validChallenge(challenge)) return false
  const expected = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  return timingSafeEqual(Buffer.from(expected), Buffer.from(challenge))
}

// ---------- Board tokens (the same shape as scripts/board-token.mjs) ----------

export function newBoardToken(): string {
  return randomBytes(32).toString('base64url')
}

/** The SHA-256 hex that form.gov-board-token files and the gateway looks up. */
export function tokenSha256(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

// ---------- Dynamic client registration (RFC 7591), stateless ----------

/** A client id is a sealed copy of the redirect URIs it registered. It doesn't expire. */
export function registerClient(redirectUris: unknown, key: string): { client_id: string, redirect_uris: string[] } | { error: string } {
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) return { error: 'redirect_uris must be a non-empty list' }
  if (redirectUris.length > MAX_REDIRECTS) return { error: `at most ${MAX_REDIRECTS} redirect_uris` }
  const refused = redirectUris.find(uri => !allowedRedirect(uri))
  if (refused !== undefined) return { error: `redirect URI not allowed: ${String(refused).slice(0, 100)}` }
  const uris = [...new Set(redirectUris as string[])]
  return { client_id: seal({ kind: 'client', exp: 0, redirect_uris: uris }, key), redirect_uris: uris }
}

/** The redirect URIs a client id registered, or null when it isn't one of ours. */
export function clientRedirects(clientId: unknown, key: string): string[] | null {
  const client = unseal(String(clientId ?? ''), 'client', key, nowSeconds())
  return client && Array.isArray(client.redirect_uris) ? client.redirect_uris as string[] : null
}

// ---------- Authorization request and consent ----------

export interface AuthorizeRequest {
  client_id: string
  redirect_uri: string
  code_challenge: string
  state: string
  aud: string // the resource the tokens are for: <origin>/mcp
}

/**
 * Checks the query of GET /oauth/authorize. Every failure is shown on the consent page rather than sent to the
 * redirect URI, so a request that doesn't check out never leaves agent-board.
 */
export function checkAuthorizeRequest(query: Record<string, unknown>, resource: string, key: string): { ok: true, req: AuthorizeRequest } | { ok: false, reason: string } {
  const redirects = clientRedirects(query.client_id, key)
  if (!redirects) return { ok: false, reason: 'Unknown client. Remove the connector and add it again.' }
  if (typeof query.redirect_uri !== 'string' || !redirects.includes(query.redirect_uri)) return { ok: false, reason: 'The redirect URI doesn\'t match the one this client registered.' }
  if (query.response_type !== 'code') return { ok: false, reason: 'response_type must be code.' }
  if (query.code_challenge_method !== 'S256' || !validChallenge(query.code_challenge)) return { ok: false, reason: 'A PKCE S256 code_challenge is required.' }
  if (query.resource !== undefined && query.resource !== resource) return { ok: false, reason: `This server only issues tokens for ${resource}.` }
  return {
    ok: true,
    req: {
      client_id: query.client_id as string,
      redirect_uri: query.redirect_uri,
      code_challenge: query.code_challenge,
      state: typeof query.state === 'string' ? query.state : '',
      aud: resource
    }
  }
}

/** The consent cookie: the request, the chosen identity and the new board token, sealed for PENDING_SECONDS. */
export function sealPending(req: AuthorizeRequest, agentId: string, boardToken: string, key: string, now: number): string {
  return seal({ kind: 'pending', exp: now + PENDING_SECONDS, agent_id: agentId, board_token: boardToken, ...req }, key)
}

export function readPending(value: unknown, key: string, now: number): (SealPayload & AuthorizeRequest) | null {
  return unseal(String(value ?? ''), 'pending', key, now) as (SealPayload & AuthorizeRequest) | null
}

/** The redirect that hands Claude its code: redirect_uri?code&state&iss (RFC 9207). */
export function codeRedirect(pending: SealPayload & AuthorizeRequest, issuer: string, key: string, now: number): string {
  const code = seal({
    kind: 'code',
    exp: now + CODE_SECONDS,
    agent_id: pending.agent_id,
    board_token: pending.board_token,
    client_id: pending.client_id,
    redirect_uri: pending.redirect_uri,
    code_challenge: pending.code_challenge,
    aud: pending.aud
  }, key)
  const url = new URL(pending.redirect_uri)
  url.searchParams.set('code', code)
  if (pending.state) url.searchParams.set('state', pending.state)
  url.searchParams.set('iss', issuer)
  return url.toString()
}

// ---------- Token endpoint ----------

/** What a code or refresh token grants: one identity's board token, for one client and one resource. */
export interface Grant {
  agent_id: string
  board_token: string
  client_id: string
  aud: string
}

export type TokenError = { error: string, error_description: string }

function grantOf(p: SealPayload): Grant {
  return { agent_id: String(p.agent_id), board_token: String(p.board_token), client_id: String(p.client_id), aud: String(p.aud) }
}

/** authorization_code: the code must be ours and unexpired, and match the client, redirect URI, PKCE verifier and resource. */
export function redeemCode(form: Record<string, unknown>, key: string, now: number): Grant | TokenError {
  const code = unseal(String(form.code ?? ''), 'code', key, now)
  if (!code) return { error: 'invalid_grant', error_description: 'The code is invalid or expired.' }
  if (form.client_id !== code.client_id) return { error: 'invalid_grant', error_description: 'The code was issued to another client.' }
  if (form.redirect_uri !== code.redirect_uri) return { error: 'invalid_grant', error_description: 'redirect_uri doesn\'t match the authorization request.' }
  if (!pkceOk(form.code_verifier, code.code_challenge)) return { error: 'invalid_grant', error_description: 'The PKCE code_verifier doesn\'t match.' }
  if (form.resource !== undefined && form.resource !== code.aud) return { error: 'invalid_target', error_description: `Tokens here are only for ${String(code.aud)}.` }
  return grantOf(code)
}

/** refresh_token: ours, unexpired, and for this client. The caller still asks the gateway (whoami) before issuing. */
export function readRefresh(form: Record<string, unknown>, key: string, now: number): Grant | TokenError {
  const refresh = unseal(String(form.refresh_token ?? ''), 'refresh', key, now)
  if (!refresh) return { error: 'invalid_grant', error_description: 'The refresh token is invalid or expired.' }
  if (form.client_id !== undefined && form.client_id !== refresh.client_id) return { error: 'invalid_grant', error_description: 'The refresh token was issued to another client.' }
  return grantOf(refresh)
}

/** A fresh access token (1 hour) and refresh token (30 days) for a grant. */
export function issueTokens(grant: Grant, key: string, now: number) {
  return {
    access_token: seal({ kind: 'access', exp: now + ACCESS_SECONDS, ...grant }, key),
    token_type: 'Bearer',
    expires_in: ACCESS_SECONDS,
    refresh_token: seal({ kind: 'refresh', exp: now + REFRESH_SECONDS, ...grant }, key)
  }
}

/** /mcp: the grant in a sealed access token, or null when it's not ours, expired, or for another resource. */
export function readAccess(token: string, aud: string, key: string, now: number): Grant | null {
  const access = unseal(token, 'access', key, now)
  return access && access.aud === aud ? grantOf(access) : null
}

// ---------- Runtime (needs Nuxt) ----------

/** NUXT_CONNECTOR_SEAL_KEY, or a 503 when it isn't set: the connector's sign-in is off until it is. */
export function connectorSealKey(): string {
  const key = String(useRuntimeConfig().connectorSealKey ?? '')
  if (key.length < 32) throw createError({ statusCode: 503, statusMessage: 'Connector sign-in is not configured' })
  return key
}

/** This deployment's origin, which is also the OAuth issuer. Vercel sets x-forwarded-proto. */
export function publicOrigin(event: H3Event): string {
  return getRequestURL(event, { xForwardedProto: true }).origin
}

/** The protected resource, and every token's audience. */
export function mcpResource(event: H3Event): string {
  return `${publicOrigin(event)}/mcp`
}
