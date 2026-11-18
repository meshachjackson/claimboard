// The board manager (server/utils/boardManager.ts): its tools run against the fixtures-mode stand-in (applyOp), and a
// scripted model plays the demo: a blank board, a bulk create, a duplicate merge, a split, a move. No network.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

const root = JSON.stringify(new URL('../', import.meta.url).href)
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~~/')) spec = new URL('./' + spec.slice(3) + '.ts', ${root}).href
  else if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${root}).href
  return next(spec, ctx)
}`))
;(await import('../app/types/board.ts')).setBoardOwner('person:meshach', 'Meshach')

let mgr: typeof import('../server/utils/boardManager.ts')
let applyOp: typeof import('../app/utils/boardOps.ts').applyOp
before(async () => {
  mgr = await import('../server/utils/boardManager.ts');
  ({ applyOp } = await import('../app/utils/boardOps.ts'))
})

// A blank board keeps the real columns, so the move rules have their stage rows.
const columns = JSON.parse(readFileSync(new URL('../mock/board_columns.json', import.meta.url), 'utf8'))
const blank = () => ({ tasks: [], steps: [], notes: [], registry: [], columns }) as any
const depsFor = (board: any) => ({
  read: () => board,
  write: async (op: string, args: Record<string, unknown>) => applyOp(board, op, args, { person: 'person:meshach' })
})
const use = (name: string, input: unknown, id = name) => ({ type: 'tool_use', id, name, input })

/** A model that answers from a list: each call returns the next scripted content, and records what it was sent. */
function script(...steps: any[][]) {
  const seen: any[] = []
  let i = 0
  return {
    seen,
    call: async (body: any) => {
      seen.push(structuredClone(body.messages))
      const content = steps[i++] ?? [{ type: 'text', text: 'end' }]
      return { content, stop_reason: content.some(c => c.type === 'tool_use') ? 'tool_use' : 'end_turn' }
    }
  }
}

test('demo: blank board, bulk create, merge a duplicate, split, move', async () => {
  const board = blank()
  const model = script(
    [use('create_cards', { cards: [{ title: 'Login page' }, { title: 'login page ' }, { title: 'Reports' }, { title: 'Billing' }] })],
    [use('find_duplicates', {})],
    [use('list_cards', {})]
  )
  const first = await mgr.runManager([{ role: 'user', content: 'open tickets' }], depsFor(board), model.call, 'm')
  // Only text ends a turn, so the scripted tool-only content runs three tools, then the default text ends it.
  assert.equal(first.reply, 'end')
  assert.equal(board.tasks.length, 4)
  assert.ok(first.actions.some(a => a.summary === 'Created 4 of 4 cards'))
  const ids = board.tasks.map((t: any) => t.task_id)

  const second = script(
    [use('merge_cards', { keeper: ids[0], duplicates: [ids[1]] })],
    [use('split_card', { task_id: ids[2], parts: [{ title: 'Reports: daily' }, { title: 'Reports: weekly' }], archive_original: true })],
    [use('move_cards', { task_ids: [ids[3]], stage: 'architecture' })],
    [{ type: 'text', text: 'All done.' }]
  )
  const r = await mgr.runManager([{ role: 'user', content: 'tidy up' }], depsFor(board), second.call, 'm')
  assert.equal(r.reply, 'All done.')
  const byId = (id: string) => board.tasks.find((t: any) => t.task_id === id)
  assert.ok(byId(ids[1]).archived_at, 'the duplicate is archived')
  assert.ok(!byId(ids[0]).archived_at, 'the keeper stays')
  assert.ok(byId(ids[2]).archived_at, 'the split original is archived')
  assert.ok(board.tasks.some((t: any) => t.title === 'Reports: weekly'))
  assert.equal(byId(ids[3]).stage, 'architecture', JSON.stringify(second.seen.at(-1)?.at(-1)))
  assert.ok(board.notes.some((n: any) => n.task_id === ids[0] && /Merged duplicates/.test(n.body)))
  assert.ok(board.notes.some((n: any) => n.task_id === ids[2] && /Split into/.test(n.body)))
})

test('a refused move comes back to the model as text, not an error', async () => {
  const board = blank()
  await mgr.runManager([{ role: 'user', content: 'x' }], depsFor(board), script([use('create_cards', { cards: [{ title: 'A' }] })]).call, 'm')
  const m = script([use('move_cards', { task_ids: ['TSK-NOPE'], stage: 'build' })], [{ type: 'text', text: 'ok' }])
  await mgr.runManager([{ role: 'user', content: 'x' }], depsFor(board), m.call, 'm')
  const result = JSON.stringify(m.seen[1])
  assert.match(result, /unknown card TSK-NOPE/)
})

test('the tool result is sent back to the model with the matching id', async () => {
  const board = blank()
  const m = script([use('list_cards', {}, 'toolu_1')], [{ type: 'text', text: 'ok' }])
  await mgr.runManager([{ role: 'user', content: 'x' }], depsFor(board), m.call, 'm')
  const last = m.seen[1].at(-1)
  assert.equal(last.role, 'user')
  assert.equal(last.content[0].tool_use_id, 'toolu_1')
  assert.deepEqual(JSON.parse(last.content[0].content), { total: 0, cards: [] })
})

test('a pinned duplicate is left alone by merge_cards', async () => {
  const board = blank()
  await mgr.runManager([{ role: 'user', content: 'x' }], depsFor(board), script([use('create_cards', { cards: [{ title: 'Same' }, { title: 'Same' }] })]).call, 'm')
  const [a, b] = board.tasks.map((t: any) => t.task_id)
  await applyOp(board, 'pin_task', { task_id: b, updated_at: board.tasks[1].updated_at }, { person: 'person:meshach' })
  const m = script([use('merge_cards', { keeper: a, duplicates: [b] })], [{ type: 'text', text: 'ok' }])
  await mgr.runManager([{ role: 'user', content: 'x' }], depsFor(board), m.call, 'm')
  assert.match(JSON.stringify(m.seen[1]), /left alone \(pinned\)/)
  assert.ok(!board.tasks[1].archived_at)
})

test('the loop ends after too many model calls', async () => {
  const board = blank()
  const forever = async () => ({ content: [use('list_cards', {})], stop_reason: 'tool_use' })
  const r = await mgr.runManager([{ role: 'user', content: 'x' }], depsFor(board), forever, 'm')
  assert.match(r.reply, /too many steps/)
})

test('a card no agent can take shows no_taker in list_cards, and list_agents shows the switch', async () => {
  const board = blank()
  board.registry = [{ agent_id: 'agt-adv', name: 'Advy', agent_type: 'advisor', lifecycle_status: 'active', switch: 'off' }]
  board.tasks = [{ task_id: 'TSK-9', title: 'Plan it', stage: 'architecture', work_state: 'awaiting_start', assignee: '', tags: '', original_request: 'x', updated_at: '2026-11-01T00:00:00Z' }]
  board.steps = [{ step_id: 'STP-9', task_id: 'TSK-9', step_no: 1, role: 'advisor', assignee: 'pool:advisor', step_state: 'awaiting_pull', cancelled: false }]
  const b = new mgr.ManagerBoard(depsFor(board))
  await b.load()
  const cards = JSON.parse(await mgr.runTool(b, 'list_cards', {})).cards
  assert.equal(cards[0].no_taker, 'Every advisor agent is switched off')
  const agents = JSON.parse(await mgr.runTool(b, 'list_agents', {})).agents
  assert.equal(agents[0].switch, 'off')
})
