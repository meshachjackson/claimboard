// Pure helpers of the orchestrator connector's OAuth front door. Run with `pnpm test` (Node 24 strips the types).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { seal, unseal, SEAL_PREFIX } from '../server/utils/seal.ts'
import {
  allowedRedirect, pkceOk, registerClient, clientRedirects, checkAuthorizeRequest, sealPending, readPending,
  codeRedirect, redeemCode, readRefresh, issueTokens, readAccess, newBoardToken, tokenSha256,
  CLAUDE_CALLBACK, CODE_SECONDS, ACCESS_SECONDS, REFRESH_SECONDS, PENDING_SECONDS, nowSeconds
} from '../server/utils/oauth.ts'

// A throwaway key made per run. Never a real one.
const KEY = randomBytes(32).toString('base64')
const OTHER_KEY = randomBytes(32).toString('base64')
const AUD = 'https://board.example/mcp'
const NOW = nowSeconds()

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

test('seal round-trips and starts with vc1.', () => {
  const sealed = seal({ kind: 'access', exp: NOW + 60, agent_id: 'agt-x' }, KEY)
  assert.ok(sealed.startsWith(SEAL_PREFIX))
  assert.equal(unseal(sealed, 'access', KEY, NOW)?.agent_id, 'agt-x')
})

test('unseal refuses another kind, another key, a tampered value and a raw token', () => {
  const sealed = seal({ kind: 'access', exp: NOW + 60 }, KEY)
  assert.equal(unseal(sealed, 'refresh', KEY, NOW), null)
  assert.equal(unseal(sealed, 'access', OTHER_KEY, NOW), null)
  const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), 'base64url')
  raw[raw.length - 1] ^= 1 // one bit of the ciphertext
  assert.equal(unseal(SEAL_PREFIX + raw.toString('base64url'), 'access', KEY, NOW), null)
  assert.equal(unseal(newBoardToken(), 'access', KEY, NOW), null)
})

test('unseal refuses an expired value; exp 0 never expires', () => {
  assert.equal(unseal(seal({ kind: 'code', exp: NOW - 1 }, KEY), 'code', KEY, NOW), null)
  assert.equal(unseal(seal({ kind: 'code', exp: NOW }, KEY), 'code', KEY, NOW), null)
  assert.ok(unseal(seal({ kind: 'client', exp: 0 }, KEY), 'client', KEY, NOW + 10 ** 9))
})

test('seal needs a key of at least 32 characters', () => {
  assert.throws(() => seal({ kind: 'access', exp: 0 }, 'short'))
})

test('redirect allowlist: claude.ai callback and loopback http only', () => {
  assert.ok(allowedRedirect(CLAUDE_CALLBACK))
  assert.ok(allowedRedirect('http://localhost:54321/callback'))
  assert.ok(allowedRedirect('http://127.0.0.1:8080/'))
  assert.ok(allowedRedirect('http://[::1]:9000/cb'))
  for (const bad of [
    'https://claude.ai/api/mcp/auth_callback/x', 'https://evil.example/cb', 'http://localhost.evil.example/cb',
    'https://localhost:3000/cb', 'http://user@localhost/cb', 'http://localhost/cb#frag', 'javascript:alert(1)', '', 42
  ]) assert.equal(allowedRedirect(bad), false, String(bad))
})

test('PKCE S256: the right verifier passes, anything else fails', () => {
  const { verifier, challenge } = pkcePair()
  assert.ok(pkceOk(verifier, challenge))
  assert.equal(pkceOk(pkcePair().verifier, challenge), false)
  assert.equal(pkceOk('short', challenge), false)
  assert.equal(pkceOk(verifier, verifier), false) // plain method is not accepted
})

test('registration seals the redirect URIs and refuses a foreign one', () => {
  const ok = registerClient([CLAUDE_CALLBACK], KEY)
  assert.ok('client_id' in ok)
  assert.deepEqual(clientRedirects(ok.client_id, KEY), [CLAUDE_CALLBACK])
  assert.equal(clientRedirects(ok.client_id, OTHER_KEY), null)
  assert.ok('error' in registerClient(['https://evil.example/cb'], KEY))
  assert.ok('error' in registerClient([], KEY))
  assert.ok('error' in registerClient('not a list', KEY))
})

function authorized() {
  const client = registerClient([CLAUDE_CALLBACK], KEY) as { client_id: string }
  const { verifier, challenge } = pkcePair()
  const query = { client_id: client.client_id, redirect_uri: CLAUDE_CALLBACK, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's1', resource: AUD }
  return { client, verifier, challenge, query }
}

test('authorize request: checks client, redirect URI, PKCE and resource', () => {
  const { query } = authorized()
  assert.ok(checkAuthorizeRequest(query, AUD, KEY).ok)
  assert.equal(checkAuthorizeRequest({ ...query, redirect_uri: 'http://localhost:1/cb' }, AUD, KEY).ok, false)
  assert.equal(checkAuthorizeRequest({ ...query, code_challenge_method: 'plain' }, AUD, KEY).ok, false)
  assert.equal(checkAuthorizeRequest({ ...query, resource: 'https://other.example/mcp' }, AUD, KEY).ok, false)
  assert.equal(checkAuthorizeRequest({ ...query, client_id: 'made-up' }, AUD, KEY).ok, false)
})

function codeFor(now = NOW) {
  const a = authorized()
  const check = checkAuthorizeRequest(a.query, AUD, KEY)
  assert.ok(check.ok)
  const pending = readPending(sealPending(check.req, 'agt-x', 'raw-board-token', KEY, now), KEY, now)
  assert.ok(pending)
  const url = new URL(codeRedirect(pending, 'https://board.example', KEY, now))
  assert.equal(url.searchParams.get('state'), 's1')
  assert.equal(url.searchParams.get('iss'), 'https://board.example')
  return { ...a, code: url.searchParams.get('code') as string }
}

test('pending consent expires after PENDING_SECONDS', () => {
  const { query } = authorized()
  const check = checkAuthorizeRequest(query, AUD, KEY)
  assert.ok(check.ok)
  const cookie = sealPending(check.req, 'agt-x', 'raw', KEY, NOW)
  assert.ok(readPending(cookie, KEY, NOW + PENDING_SECONDS - 1))
  assert.equal(readPending(cookie, KEY, NOW + PENDING_SECONDS), null)
})

test('code redeems once the client, redirect URI and verifier match', () => {
  const { code, client, verifier } = codeFor()
  const form = { grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: CLAUDE_CALLBACK, code_verifier: verifier }
  const grant = redeemCode(form, KEY, NOW)
  assert.deepEqual(grant, { agent_id: 'agt-x', board_token: 'raw-board-token', client_id: client.client_id, aud: AUD })
  assert.equal((redeemCode({ ...form, code_verifier: pkcePair().verifier }, KEY, NOW) as { error: string }).error, 'invalid_grant')
  assert.equal((redeemCode({ ...form, redirect_uri: 'http://localhost:1/cb' }, KEY, NOW) as { error: string }).error, 'invalid_grant')
  assert.equal((redeemCode({ ...form, client_id: 'other' }, KEY, NOW) as { error: string }).error, 'invalid_grant')
  assert.equal((redeemCode(form, KEY, NOW + CODE_SECONDS) as { error: string }).error, 'invalid_grant')
})

test('tokens: access expires in an hour, checks audience; refresh lasts 30 days', () => {
  const grant = { agent_id: 'agt-x', board_token: 'raw', client_id: 'c', aud: AUD }
  const tokens = issueTokens(grant, KEY, NOW)
  assert.equal(tokens.expires_in, ACCESS_SECONDS)
  assert.deepEqual(readAccess(tokens.access_token, AUD, KEY, NOW), grant)
  assert.equal(readAccess(tokens.access_token, 'https://other.example/mcp', KEY, NOW), null)
  assert.equal(readAccess(tokens.access_token, AUD, KEY, NOW + ACCESS_SECONDS), null)
  assert.equal(readAccess(tokens.refresh_token, AUD, KEY, NOW), null) // a refresh token isn't an access token
  assert.deepEqual(readRefresh({ refresh_token: tokens.refresh_token, client_id: 'c' }, KEY, NOW + REFRESH_SECONDS - 1), grant)
  assert.ok('error' in readRefresh({ refresh_token: tokens.refresh_token, client_id: 'c' }, KEY, NOW + REFRESH_SECONDS))
  assert.ok('error' in readRefresh({ refresh_token: tokens.refresh_token, client_id: 'other' }, KEY, NOW))
  assert.ok('error' in readRefresh({ refresh_token: tokens.access_token }, KEY, NOW))
})

test('board token: 32 bytes base64url, hashed like scripts/board-token.mjs', () => {
  const token = newBoardToken()
  assert.equal(Buffer.from(token, 'base64url').length, 32)
  assert.match(tokenSha256(token), /^[0-9a-f]{64}$/)
  assert.equal(tokenSha256(token), createHash('sha256').update(token, 'utf8').digest('hex'))
})
