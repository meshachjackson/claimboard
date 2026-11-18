// Agent registration on the reference install (docs/design/open-source.md): a request is pending with no registry
// row and no token; approval writes the registry row and the access.json entry and shows the token once; rejection writes
// neither. On the n8n deployment nothing changes: registration stays form.gov-register-agent. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'

const root = new URL('../', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~~/')) spec = new URL(spec.slice(3) + (spec.endsWith('.json') ? '' : '.ts'), ${JSON.stringify(root)}).href
  else if (spec.startsWith('~/')) spec = new URL('app/' + spec.slice(2) + '.ts', ${JSON.stringify(root)}).href
  const out = await next(spec, ctx)
  return out.url.endsWith('.json') ? { ...out, importAttributes: { type: 'json' } } : out
}`))
;(await import('../app/types/board.ts')).setBoardOwner('person:ada', 'Ada')

const { createSqliteStore } = await import('../server/utils/sqliteStore.ts')
const { starterSeed } = await import('../server/utils/starterSeed.ts')
const { checkRequest } = await import('../server/utils/registration.ts')
const repo = new URL('../', import.meta.url).pathname
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'registration-'))
  const accessFile = join(dir, 'access.json')
  writeFileSync(accessFile, JSON.stringify({ agents: [] }))
  const store = createSqliteStore({ file: join(dir, 'b.sqlite'), accessFile, seed: starterSeed })
  const access = () => JSON.parse(readFileSync(accessFile, 'utf8')).agents as Array<{ agent_id: string, token_sha256: string }>
  return { dir, store, access, registration: store.registration! }
}
const REQUEST = { agent_id: 'agt-helper', name: 'Helper', webhook_url: 'https://example.com/hook', classes: ['general'] }

test('a filed request is pending: no registry row, no access entry, no working token', async () => {
  const { dir, store, access, registration } = fresh()
  const r = registration.file(REQUEST, 'person:ada')
  assert.equal(r.ok && r.request.status, 'pending')
  assert.equal((await store.read()).registry.length, 0)
  assert.deepEqual(access(), [])
  assert.equal(registration.list().length, 1)
  const guess = await store.write('whoami', {}, { token: 'anything' })
  assert.equal(guess.ok, false)
  rmSync(dir, { recursive: true })
})

test('approval writes the registry row and the access entry, and the token works', async () => {
  const { dir, store, access, registration } = fresh()
  const filed = registration.file({ ...REQUEST, classes: ['general', 'ops'] }, 'person:ada')
  assert.ok(filed.ok)
  const done = registration.decide(filed.ok ? filed.request.request_id : '', 'approve', 'ok')
  assert.ok(done.ok && done.token)
  const token = done.ok ? done.token! : ''
  const row = (await store.read()).registry.find(a => a.agent_id === 'agt-helper')!
  assert.equal(row.name, 'Helper')
  assert.equal(row.lifecycle_status, 'active')
  assert.deepEqual(row.classes, ['general', 'ops'])
  assert.equal(row.reachability, 'https://example.com/hook')
  assert.deepEqual(access(), [{ agent_id: 'agt-helper', token_sha256: sha(token) }])
  assert.ok(!readFileSync(join(dir, 'access.json'), 'utf8').includes(token), 'only the hash is kept')
  const who = await store.write('whoami', {}, { token })
  assert.equal(who.ok && who.agent_id, 'agt-helper')
  assert.equal(registration.list()[0].status, 'approved')
  rmSync(dir, { recursive: true })
})

test('rejection writes neither, and a decided request cannot be decided again', async () => {
  const { dir, store, access, registration } = fresh()
  const filed = registration.file(REQUEST, 'person:ada')
  const id = filed.ok ? filed.request.request_id : ''
  const no = registration.decide(id, 'reject', 'not now')
  assert.ok(no.ok && !no.token)
  assert.equal((await store.read()).registry.length, 0)
  assert.deepEqual(access(), [])
  const again = registration.decide(id, 'approve', '')
  assert.deepEqual(again.ok ? null : again.reason, `${id} is already rejected`)
  assert.equal(registration.decide('REQ-999999', 'approve', '').ok, false)
  // A rejected id can be requested again.
  assert.equal(registration.file(REQUEST, 'person:ada').ok, true)
  rmSync(dir, { recursive: true })
})

test('an existing access entry is kept when another agent is approved', () => {
  const { dir, access, registration } = fresh()
  const a = registration.file(REQUEST, 'person:ada')
  const b = registration.file({ ...REQUEST, agent_id: 'agt-second', name: 'Second' }, 'person:ada')
  registration.decide(a.ok ? a.request.request_id : '', 'approve', '')
  registration.decide(b.ok ? b.request.request_id : '', 'approve', '')
  assert.deepEqual(access().map(x => x.agent_id), ['agt-helper', 'agt-second'])
  rmSync(dir, { recursive: true })
})

test('a damaged access.json stops an approval and is left as it was; nothing is registered', async () => {
  const { dir, store, registration } = fresh()
  writeFileSync(join(dir, 'access.json'), '{ not json')
  const filed = registration.file(REQUEST, 'person:ada')
  assert.throws(() => registration.decide(filed.ok ? filed.request.request_id : '', 'approve', ''))
  assert.equal(readFileSync(join(dir, 'access.json'), 'utf8'), '{ not json')
  assert.equal((await store.read()).registry.length, 0)
  assert.equal(registration.list()[0].status, 'pending')
  rmSync(dir, { recursive: true })
})

test('requests are checked: id, name, webhook, classes, duplicates, credentials in the URL', () => {
  const no = (patch: object, taken: string[] = []) => { const r = checkRequest({ ...REQUEST, ...patch }, taken); return typeof r === 'string' ? r : '' }
  assert.match(no({ agent_id: 'Helper' }), /agent_id/)
  assert.match(no({ agent_id: 'agt-' }), /agent_id/)
  assert.match(no({ name: '  ' }), /name/)
  assert.match(no({ webhook_url: 'not a url' }), /not a URL/)
  assert.match(no({ webhook_url: 'http://example.com/hook' }), /https/)
  assert.equal(no({ webhook_url: 'http://localhost:9000/hook' }), '')
  assert.match(no({ webhook_url: 'https://u:p@example.com/hook' }), /credential/)
  assert.match(no({ webhook_url: 'https://example.com/hook?token=abc' }), /credential/)
  assert.match(no({ classes: ['Bad Class'] }), /slugs/)
  assert.match(no({}, ['agt-helper']), /already/)
  assert.deepEqual(checkRequest({ ...REQUEST, classes: [] }, []), { ...REQUEST, classes: ['general'] })
  assert.match(String(checkRequest(null, [])), /object/)
})

test('a registered id cannot be requested again', async () => {
  const { dir, registration } = fresh()
  const a = registration.file(REQUEST, 'person:ada')
  registration.decide(a.ok ? a.request.request_id : '', 'approve', '')
  const again = registration.file(REQUEST, 'person:ada')
  assert.deepEqual(again.ok ? null : again.reason, 'agt-helper is already registered or requested')
  rmSync(dir, { recursive: true })
})

test('on the n8n deployment nothing changes: no approval path of its own, the wizard still names form.gov-register-agent', () => {
  const store = readFileSync(join(repo, 'server/utils/store.ts'), 'utf8')
  const gateway = store.slice(store.indexOf('const n8nGateway'), store.indexOf('let reference'))
  assert.ok(!/registration/.test(gateway), 'the n8n-gateway adapter has no registration')
  assert.ok(/form\.gov-register-agent/.test(readFileSync(join(repo, 'app/pages/registry/new.vue'), 'utf8')))
})

test('the registry the page reads has every part the Registry store indexes, once an agent is registered', async () => {
  const { dir, store, registration } = fresh()
  const a = registration.file(REQUEST, 'person:ada')
  registration.decide(a.ok ? a.request.request_id : '', 'approve', '')
  const data = await store.readRegistry()
  assert.equal(data.registry.length, 1)
  // The Registry store reads deployed.agents[agent_id] for every row; a missing map crashed the page after the first approval.
  assert.deepEqual([typeof data.deployed.agents, typeof data.deployed.containers, Array.isArray(data.deployed.sources)], ['object', 'object', true])
  assert.equal(data.deployed.agents['agt-helper'], undefined)
  rmSync(dir, { recursive: true })
})
