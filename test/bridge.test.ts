// The bridge's "Verify and Route" Code node (bridge/linear-agent.workflow.js).
// The workflow file imports the n8n SDK, which is not installed here, so the test pulls the
// node's JavaScript out of the file text and runs it with fake n8n globals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../bridge/linear-agent.workflow.js', import.meta.url), 'utf8')
const code = src.match(/jsCode: `([\s\S]*?)`,\n/)![1]!
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction('require', '$input', '$env', code)

const ROUTES = JSON.stringify(JSON.parse(readFileSync(new URL('../bridge/routes.json', import.meta.url), 'utf8')))
const body = (over = {}) => ({ action: 'created', webhookTimestamp: Date.now(), agentSession: { id: 'ses-1' }, ...over })

/** Run the node as n8n would: parsed body in json, raw bytes behind this.helpers. */
async function go(agent: string, b: object, env: Record<string, string>, sig?: string) {
  const raw = Buffer.from(JSON.stringify(b))
  const secret = env['LINEAR_WEBHOOK_SECRET_' + agent.toUpperCase().replace(/-/g, '_')] ?? env.LINEAR_WEBHOOK_SECRET_DEFAULT ?? ''
  const signature = sig ?? createHmac('sha256', secret).update(raw).digest('hex')
  const input = { first: () => ({ json: { query: { agent }, headers: { 'linear-signature': signature }, body: b } }) }
  const helpers = { getBinaryDataBuffer: async () => raw }
  // The node uses `this.helpers`, so bind it.
  return (run as Function).call({ helpers }, (m: string) => require(m), input, env)
}
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const ENV = { LINEAR_WEBHOOK_SECRET_BUILDER_CLOUD: 's1', LINEAR_WEBHOOK_SECRET_DEFAULT: 'sd', LINEAR_TOKEN_DEFAULT: 't', LINEAR_BRIDGE_ROUTES: ROUTES }

test('a signed event for a cloud agent is forwarded and gets a queued thought', async () => {
  const [out] = await go('builder-cloud', body(), ENV)
  assert.equal(out.json.hasRoute, true)
  assert.equal(out.json.forward, true)
  assert.equal(out.json.tokenEnv, 'LINEAR_TOKEN_BUILDER_CLOUD')
  assert.equal(out.json.queuedPayload.variables.input.agentSessionId, 'ses-1')
  assert.equal(out.json.queuedPayload.variables.input.content.type, 'thought')
})

test('a laptop-poll agent gets the queued thought but is not forwarded', async () => {
  const [out] = await go('builder-laptop', body(), { ...ENV, LINEAR_WEBHOOK_SECRET_BUILDER_LAPTOP: 's2' })
  assert.equal(out.json.hasRoute, true)
  assert.equal(out.json.forward, false)
})

test('a prompted event says follow-up', async () => {
  const [out] = await go('builder-cloud', body({ action: 'prompted' }), ENV)
  assert.match(out.json.queuedPayload.variables.input.content.body, /^Follow-up received/)
})

test('an unknown agent with a valid default signature ends in one error activity', async () => {
  const [out] = await go('nobody', body(), ENV)
  assert.equal(out.json.hasRoute, false)
  assert.equal(out.json.forward, false)
  assert.equal(out.json.tokenEnv, 'LINEAR_TOKEN_DEFAULT')
  assert.equal(out.json.errorPayload.variables.input.content.type, 'error')
})

test('a wrong signature, a stale timestamp or a missing session is dropped', async () => {
  assert.deepEqual(await go('builder-cloud', body(), ENV, 'a'.repeat(64)), [])
  assert.deepEqual(await go('builder-cloud', body({ webhookTimestamp: Date.now() - 120000 }), ENV), [])
  assert.deepEqual(await go('builder-cloud', body({ agentSession: {} }), ENV), [])
})

test('a signature that is not 64 hex characters is dropped, not thrown', async () => {
  for (const bad of ['', 'zz'.repeat(32), 'g'.repeat(64), 'ab'.repeat(31)]) {
    assert.deepEqual(await go('builder-cloud', body(), ENV, bad), [])
  }
})

test('no secret set at all drops the event', async () => {
  assert.deepEqual(await go('builder-cloud', body(), { LINEAR_BRIDGE_ROUTES: ROUTES }), [])
})

test('routes.json names the four agents with a kind', () => {
  const r = JSON.parse(ROUTES)
  for (const k of ['architect', 'builder-laptop', 'builder-cloud', 'verifier']) assert.ok(r[k]?.kind && r[k]?.target, k)
})
