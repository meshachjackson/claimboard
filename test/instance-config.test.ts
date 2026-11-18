// Instance values (agent targets, avatars, orchestrator, project colors, owner name, vault folder) come from runtime config.
// This file does NOT import instance-setup.ts, so it sees the core defaults first, then the owner's values (the parity check).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { jsonConfig, jsonObject, stringList } from '../app/utils/jsonConfig.ts'
import * as types from '../app/types/board.ts'
import * as dispatch from '../app/utils/dispatch.ts'

// The `~/` alias the app uses, the same loader hook the other tests register.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))

const config = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')

test('core defaults: no agent, avatar, project or owner name of any instance is built in', () => {
  assert.equal(types.boardOwnerName(), 'Owner')
  assert.equal(types.orchestratorId(), 'agt-orchestrator')
  assert.equal(types.vaultFolderName(), '')
  assert.deepEqual(Object.keys(dispatch.AGENT_TARGETS), [])
  assert.equal(dispatch.targetOf({ assignee: 'agt-anything' }), '')
  assert.deepEqual(Object.keys(types.AVATARS), [types.SYSTEM])
  assert.match(config, /unscopedAgents: ''/)
  assert.match(config, /repoSlug: ''/)
  assert.match(config, /boardTokenFormUrl: ''/)
  assert.match(config, /boardOwnerName: 'Owner'/)
})

test('JSON config accepts text or an object, treats blank as unset and fails loudly on a typo', () => {
  assert.equal(jsonConfig('X', ''), undefined)
  assert.deepEqual(jsonObject('X', '{"a":"b"}'), { a: 'b' })
  assert.deepEqual(jsonObject('X', { a: 'b' }), { a: 'b' })
  assert.throws(() => jsonObject('X', '{oops'), /X must be valid JSON/)
  assert.throws(() => jsonObject('X', '["a"]'), /X must be a JSON object/)
  assert.deepEqual(stringList('X', ''), [])
  assert.deepEqual(stringList('X', '["a","b"]'), ['a', 'b'])
  assert.deepEqual(stringList('X', ['a', 'b']), ['a', 'b'])
  assert.deepEqual(stringList('X', 'a, b'), ['a', 'b'])
  assert.throws(() => stringList('X', '[1]'), /list of strings/)
})

test('project colors: with no list the board fills slots in the order it first shows projects; past eight is Other', () => {
  assert.equal(types.projectColor('', ['a']), types.PROJECT_NONE_COLOR)
  assert.equal(types.projectColor('a', ['a', 'b']), 'var(--ab-proj-1)')
  assert.equal(types.projectColor('b', ['a', 'b']), 'var(--ab-proj-2)')
  const nine = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']
  assert.equal(types.projectColor('p9', nine), types.PROJECT_OTHER_COLOR)
})

test('applyInstanceConfig reads every value in string or object form, and the values set land in the tables the code reads', async () => {
  const { applyInstanceConfig } = await import('../app/utils/instanceConfig.ts')
  applyInstanceConfig({
    boardOwner: 'person:alex', boardOwnerName: 'Alex', defaultRunner: '',
    orchestratorAgentId: 'agt-coordinator', orchestratorName: 'Coordie',
    registrarAgentId: 'agt-keeper', registrarName: 'Keeper',
    vaultFolder: 'Notes', vaultPersonalFolders: '["Private-Notes"]',
    agentTargets: '{"agt-claude-code-macbook":"laptop","agt-claude-code-cloud":"cloud"}',
    agentAvatars: { 'agt-coordinator': { mono: 'CO', color: '#7C3AED' } },
    projectColors: '["agent-board","ops-repo","registry","governance","harness","marketing-team"]'
  })
  assert.equal(types.orchestratorId(), 'agt-coordinator')
  assert.equal(types.orchestratorName(), 'Coordie')
  assert.deepEqual(types.registrarAgent(), { id: 'agt-keeper', name: 'Keeper' })
  assert.deepEqual(types.vaultPersonalFolders(), ['Private-Notes'])
  assert.equal(types.vaultFolderName(), 'Notes')
  assert.equal(dispatch.targetOf({ assignee: 'agt-claude-code-macbook' }), 'laptop')
  assert.equal(dispatch.targetOf({ assignee: 'agt-claude-code-cloud' }), 'cloud')
  assert.equal(dispatch.targetOf({ assignee: 'pool:builder' }), 'laptop')
  assert.deepEqual(types.avatarFor('agt-coordinator', 'Coordie'), { mono: 'CO', color: '#7C3AED' })
  assert.equal(types.projectColor('agent-board'), 'var(--ab-proj-1)')
  assert.equal(types.projectColor('marketing-team'), 'var(--ab-proj-6)')
  assert.equal(types.projectColor('newer', ['agent-board', 'newer']), 'var(--ab-proj-7)')
  assert.equal(types.projectColor('newest', ['newer', 'newest']), 'var(--ab-proj-8)')
})

test('bad values throw at startup: a target that is not laptop, cloud or actions, an avatar with no color, an orchestrator id', () => {
  assert.throws(() => dispatch.setAgentTargets({ 'agt-x': 'moon' }), /laptop, cloud or actions/)
  assert.throws(() => types.setAgentAvatars({ 'agt-x': { mono: 'X' } }), /needs/)
  assert.throws(() => types.setOrchestrator('orchestrator'), /agt-<name>/)
})

test('links: an empty repo slug or form URL gives no link, a set one gives the full address', async () => {
  const { repoLink, configuredUrl } = await import('../app/utils/links.ts')
  assert.equal(repoLink('', 'pull/5'), '')
  assert.equal(repoLink(undefined, 'pull/5'), '')
  assert.equal(repoLink(' me/board ', 'pull/5'), 'https://github.com/me/board/pull/5')
  assert.equal(configuredUrl(undefined), '')
  assert.equal(configuredUrl('  '), '')
  assert.equal(configuredUrl(' https://forms.example/token '), 'https://forms.example/token')
})
