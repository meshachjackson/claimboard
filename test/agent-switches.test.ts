// Agent on/off switches (app/utils/availability.ts, server/utils/agentSwitches.ts). Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySwitch, lastSeen, overlayPending, presence } from '../app/utils/availability.ts'
import { isSwitchedOff, parseSwitches, readSwitches, writeSwitch } from '../server/utils/agentSwitches.ts'

// boardOps.ts imports with the app's `~/` alias, which plain Node does not know.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))
let canWake: typeof import('../app/utils/boardOps.ts').canWake
let takesMessages: typeof import('../app/utils/boardOps.ts').takesMessages
before(async () => {
  ({ canWake, takesMessages } = await import('../app/utils/boardOps.ts'))
})

const NOW = Date.parse('2026-10-29T18:00:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const step = (extra: Record<string, unknown>) => ({ assignee: 'agt-codex', heartbeat_at: null, dispatched_at: null, acked_at: null, ...extra }) as never
const note = (author_id: string, created_at: string) => ({ author_id, created_at }) as never

test('last seen is the newest heartbeat, claim, ack or note from that agent only', () => {
  const seen = lastSeen('agt-codex',
    [step({ heartbeat_at: ago(50), dispatched_at: ago(90) }), step({ assignee: 'agt-other', heartbeat_at: ago(1) })],
    [note('agt-codex', ago(20)), note('agt-other', ago(2))])
  assert.equal(seen, NOW - 20 * 60_000)
  assert.ok(Number.isNaN(lastSeen('agt-new', [], [])))
})

test('presence says active within 30 minutes, then how long ago', () => {
  assert.deepEqual(presence(NOW - 10 * 60_000, NOW), { active: true, text: 'active now' })
  assert.equal(presence(NOW - 45 * 60_000, NOW).text, 'last seen 45 minutes ago')
  assert.equal(presence(NOW - 3 * 3_600_000, NOW).text, 'last seen 3 hours ago')
  assert.equal(presence(NOW - 72 * 3_600_000, NOW).text, 'last seen 3 days ago')
  assert.deepEqual(presence(Number.NaN, NOW), { active: false, text: 'no activity yet' })
})

test('the switch file keeps off and auto, drops on and junk', () => {
  assert.deepEqual(parseSwitches('{"agt-a":"off","agt-b":"auto","agt-c":"on","agt-d":"maybe","nope":"off"}'), { 'agt-a': 'off', 'agt-b': 'auto' })
  assert.deepEqual(parseSwitches('not json'), {})
  assert.deepEqual(parseSwitches('[]'), {})
})

test('writeSwitch saves, and on removes the entry', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'sw-')), 'nested', 'agent-switches.json')
  assert.deepEqual(readSwitches(file), {})
  writeSwitch(file, 'agt-codex', 'off')
  assert.equal(isSwitchedOff(file, 'agt-codex'), true)
  assert.equal(isSwitchedOff(file, 'agt-other'), false)
  assert.equal(isSwitchedOff(file, ''), false)
  writeSwitch(file, 'agt-codex', 'auto')
  assert.equal(isSwitchedOff(file, 'agt-codex'), false, 'auto never blocks')
  writeSwitch(file, 'agt-codex', 'on')
  assert.equal(JSON.parse(readFileSync(file, 'utf8'))['agt-codex'], undefined)
  writeFileSync(file, '{"agt-codex":"off"}')
  assert.equal(isSwitchedOff(file, 'agt-codex'), true, 'a hand edit applies at once')
})

test('a switched-off agent gets no messages and cannot be woken; auto changes nothing', () => {
  const row = { agent_id: 'agt-codex', lifecycle_status: 'active', request_types: 'board_reply', runtime: 'n8n_cloud', host: 'hosted', reachability: '' }
  assert.equal(takesMessages('agt-codex', [row] as never), true)
  assert.equal(takesMessages('agt-codex', [{ ...row, switch: 'auto' }] as never), true)
  assert.equal(takesMessages('agt-codex', [{ ...row, switch: 'off' }] as never), false)
  assert.equal(canWake('agt-codex', [{ ...row, switch: 'off' }] as never), false)
})

test('the assignee picker label says when an agent is switched off', async () => {
  const { pickerLabel } = await import('../app/utils/agentLane.ts')
  const row = { agent_id: 'agt-codex', runtime: 'local', deploy_ref: '', classes: [] }
  assert.equal(pickerLabel('Codex', row as never), 'Codex')
  assert.equal(pickerLabel('Codex', { ...row, switch: 'auto' } as never), 'Codex')
  assert.equal(pickerLabel('Codex', { ...row, switch: 'off' } as never), 'Codex · switched off')
})

test('applySwitch sets one agent and leaves the old rows alone, so a failed save can roll back', () => {
  const rows = [{ agent_id: 'agt-a', switch: 'on' as const }, { agent_id: 'agt-b' }]
  const next = applySwitch(rows, 'agt-b', 'off')
  assert.equal(next[1].switch, 'off')
  assert.equal(next[0].switch, 'on')
  assert.equal(rows[1].switch, undefined, 'input is not changed')
  assert.equal(applySwitch(next, 'agt-b', 'on')[1].switch, 'on')
})

test('a read that lands while a switch is pending keeps the pending mode', () => {
  const fresh = [{ agent_id: 'agt-a', switch: 'on' as const }, { agent_id: 'agt-b', switch: 'off' as const }]
  const out = overlayPending(fresh, new Map([['agt-a', 'off' as const]]))
  assert.equal(out[0].switch, 'off')
  assert.equal(out[1].switch, 'off')
  assert.equal(overlayPending(fresh, new Map()), fresh, 'nothing pending returns the rows as they are')
})
