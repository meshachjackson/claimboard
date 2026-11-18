// Which agents' reads may come from the cache (server/utils/classScope.ts).: Codex's token, which holds only
// board:class:general and board:class:personal, read a catalyst card and an untagged card through get_task. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readsNeedClassRule, unscopedAgentList } from '../server/utils/classScope.ts'

const UNSCOPED = unscopedAgentList('agt-claude-code-macbook')

test('the setting is a comma list, trimmed, with blanks dropped', () => {
  assert.deepEqual(unscopedAgentList(' agt-a , agt-b ,, '), ['agt-a', 'agt-b'])
  assert.deepEqual(unscopedAgentList('agt-claude-code-macbook'), ['agt-claude-code-macbook'])
})

test('an empty, missing or non-text setting names nobody', () => {
  assert.deepEqual(unscopedAgentList(''), [])
  assert.deepEqual(unscopedAgentList(undefined), [])
  assert.deepEqual(unscopedAgentList(null), [])
})

test('an agent named as unscoped reads from the cache', () => {
  assert.equal(readsNeedClassRule('agt-claude-code-macbook', UNSCOPED), false)
})

test('Codex and any other agent not named goes to the gateway (fails closed)', () => {
  assert.equal(readsNeedClassRule('agt-codex-macbook', UNSCOPED), true)
  assert.equal(readsNeedClassRule('agt-api-anthropic', UNSCOPED), true)
  assert.equal(readsNeedClassRule('agt-claude-code-cloud', UNSCOPED), true)
})

test('a similar-looking id is not a match', () => {
  assert.equal(readsNeedClassRule('agt-claude-code-macbook2', UNSCOPED), true)
  assert.equal(readsNeedClassRule('AGT-CLAUDE-CODE-MACBOOK', UNSCOPED), true)
})

test('with an empty setting every agent goes to the gateway', () => {
  assert.equal(readsNeedClassRule('agt-claude-code-macbook', []), true)
})

test('a blank agent id is never trusted with the cache', () => {
  assert.equal(readsNeedClassRule('', UNSCOPED), true)
})
