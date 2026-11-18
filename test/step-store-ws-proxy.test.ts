// applyWsProxy (server/utils/stepStoreDb.ts): env-selected WebSocket proxy settings for the Neon driver. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyWsProxy, type WsConfig } from '../server/utils/stepStoreDb.ts'

test('no proxy URL leaves the driver config untouched (Neon path)', () => {
  const config: WsConfig = {}
  applyWsProxy(config, '')
  assert.deepEqual(config, {})
})

test('a proxy URL sets host + secret path, secure websocket, no pipelining', () => {
  const config: WsConfig = {}
  const fakeWs = class {}
  applyWsProxy(config, 'wss://db.example.test/secret123/', fakeWs)
  const proxy = config.wsProxy as (host: string, port: number) => string
  const target = proxy('ignored.host', 5432)
  assert.ok(target.startsWith('db.example.test'), 'host')
  assert.ok(target.endsWith('/secret123/'), 'path')
  assert.equal(target, 'db.example.test/secret123/')
  assert.equal(config.useSecureWebSocket, true)
  assert.equal(config.pipelineTLS, false)
  assert.equal(config.pipelineConnect, false)
  assert.equal(config.webSocketConstructor, fakeWs)
})

test('an existing WebSocket constructor is kept', () => {
  const mine = class {}
  const config: WsConfig = { webSocketConstructor: mine }
  applyWsProxy(config, 'wss://db.example.test/secret123/', class {})
  assert.equal(config.webSocketConstructor, mine)
})

test('bad URLs throw without repeating the URL or its secret', () => {
  for (const bad of ['not a url with secret123', 'ws://db.example.test/secret123/', 'https://user:pw0rd@db.example.test/secret123/']) {
    const config: WsConfig = {}
    assert.throws(() => applyWsProxy(config, bad), (e: Error) => {
      assert.ok(!e.message.includes('secret123') && !e.message.includes('pw0rd') && !e.message.includes('db.example.test'), e.message)
      return true
    })
    assert.deepEqual(config, {}, 'config untouched on error')
  }
})
