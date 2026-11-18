// NUXT_BOARD_BACKEND to an adapter (server/utils/backend.ts). SQLite is the default; a typo stops the server. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickBackend } from '../server/utils/backend.ts'

test('unset or reference keeps the board in SQLite', () => {
  assert.equal(pickBackend(undefined), 'reference')
  assert.equal(pickBackend(''), 'reference')
  assert.equal(pickBackend('reference'), 'reference')
})

test('n8n-gateway picks the gateway adapter', () => {
  assert.equal(pickBackend('n8n-gateway'), 'n8n-gateway')
})

test('any other value throws instead of serving an empty board', () => {
  assert.throws(() => pickBackend('n8n'), /reference or n8n-gateway/)
  assert.throws(() => pickBackend('gateway'), /reference or n8n-gateway/)
})
