// The orchestrator's chat steps answered by the one dispatcher (scripts/board-run.mjs), against the Postgres step store on pglite.
// The agent is a stub: no claude program runs and no money is spent. Run with `pnpm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { NOW, board, step, task } from './board-helpers.ts'

let mod: typeof import('../server/utils/pgStepStore.ts')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let run: any
const opened: PGlite[] = []
after(async () => { for (const pg of opened) await pg.close() })
const sql = readFileSync(new URL('../server/db/step-store.sql', import.meta.url), 'utf8')
before(async () => {
  mod = await import('../server/utils/pgStepStore.ts')
  run = await import('../scripts/board-run.mjs')
  process.env.BOARD_RUN_CONF_DIR = process.env.OS_CONF = mkdtempSync(join(tmpdir(), 'orchestrator-chat-')) // the dispatcher's kill switch and spend file live here
})

function dbOf(pg: PGlite) {
  const wrap = (q: { query: PGlite['query'] }) => ({
    query: async (s: string, p?: unknown[]) => { const r = await q.query(s, p as never[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } },
    exec: async (s: string) => pg.exec(s),
    transaction: async () => { throw new Error('nested') }
  })
  return { ...wrap(pg), transaction: <T>(work: (tx: ReturnType<typeof wrap>) => Promise<T>) => pg.transaction(tx => work(wrap(tx as never))) } as never
}
const q = async (db: { query: (s: string) => Promise<{ rows: Record<string, unknown>[] }> }, s: string) => (await db.query(s)).rows.map(r => ({ ...r }))

/** A store holding a running card whose builder (agt-b) has just asked the orchestrator a question, so the orchestrator has an open chat step. */
async function withChat() {
  const pg = new PGlite()
  opened.push(pg)
  const db = dbOf(pg)
  await mod.applySchema(db, sql)
  const held = step({ step_state: 'dispatched', lease_owner: 'gw.gov-board-write@agt-b', lease_expires_at: '2030-01-01T00:00:00.000Z' })
  await mod.importSnapshot(db, { steps: [held] as never, notes: [] })
  const b = board([task({ stage: 'build', work_state: 'in_progress' })], [held])
  const store = mod.createPgStepStore({ db, context: async () => ({ tasks: b.tasks as never, columns: b.columns as never, registry: b.registry as never, access: [] }), now: () => Date.parse(NOW) + 1000 })
  const asked = await store.write('message_agent', { task_id: 'TSK-1', body: 'The orchestrator, which branch should I use?' }, 'agt-b')
  assert.ok(asked.ok, asked.ok ? '' : asked.reason)
  // The orchestrator's token, shaped like POST /api/agent/:op answers (list_claimable gives `steps`, get_task gives `task` and `notes`).
  const veraApi = async (op: string, args: Record<string, unknown>) => {
    const r = await store.write(op, args, 'agt-orchestrator')
    if (!r.ok) return r
    if (op === 'list_claimable') return { ok: true, steps: r.rows.steps }
    if (op === 'get_task') return { ok: true, task: r.rows.tasks![0], steps: r.rows.steps, notes: r.rows.notes }
    return r
  }
  return { db, store, veraApi }
}

test('a chat step the store made is claimed and answered by the dispatcher, and the answer lands as a comment on the card', async () => {
  const { db, veraApi } = await withChat()
  const prompts: string[] = []
  const quiet = { api: async () => ({ ok: true, steps: [] }) }
  const code = await run.main(['--once'], { ...quiet, veraApi, launchChat: async ({ prompt }: { prompt: string }) => { prompts.push(prompt); return { ok: true, summary: 'Use the board/tsk-1-run branch.\nCOMPLETE: answered', usd: 0.05 } } })
  assert.equal(code, 0)
  assert.match(prompts[0]!, /which branch should I use\?/, 'The orchestrator is shown the message that made the step')
  const chat = (await q(db, "SELECT step_state, assignee, acked_at, output_summary, verdict FROM gov_task_steps WHERE role = 'chat'"))[0]!
  assert.equal(chat.step_state, 'served')
  assert.equal(chat.assignee, 'agt-orchestrator')
  assert.ok(chat.acked_at)
  assert.equal(chat.verdict, '', 'a chat answer needs no verdict')
  assert.equal(chat.output_summary, 'Use the board/tsk-1-run branch.')
  const answer = (await q(db, "SELECT author_id, kind, body FROM gov_task_notes WHERE kind = 'comment' AND author_id = 'agt-orchestrator'"))
  assert.deepEqual(answer, [{ author_id: 'agt-orchestrator', kind: 'comment', body: 'Use the board/tsk-1-run branch.' }])
})

test('a second pass finds nothing left to answer', async () => {
  const { veraApi } = await withChat()
  let turns = 0
  const deps = { api: async () => ({ ok: true, steps: [] }), veraApi, launchChat: async () => { turns++; return { ok: true, summary: 'Done.' } } }
  await run.main(['--once'], deps)
  await run.main(['--once'], deps)
  assert.equal(turns, 1)
})

test('--dry-run lists the chat step and claims nothing', async () => {
  const { db, veraApi } = await withChat()
  let turns = 0
  await run.main(['--dry-run'], { api: async () => ({ ok: true, steps: [] }), veraApi, launchChat: async () => { turns++; return { ok: true, summary: 'x' } } })
  assert.equal(turns, 0)
  assert.equal((await q(db, "SELECT step_state FROM gov_task_steps WHERE role = 'chat'"))[0]!.step_state, 'awaiting_pull')
})

test('a BLOCKED line leaves the step for Meshach with its kind; a failed run writes failed', async () => {
  const blocked = await withChat()
  await run.main(['--once'], { api: async () => ({ ok: true, steps: [] }), veraApi: blocked.veraApi, launchChat: async () => ({ ok: true, summary: 'BLOCKED needs_input: Which repo do you mean?' }) })
  const b = (await q(blocked.db, "SELECT step_state, stop_reason, acked_at FROM gov_task_steps WHERE role = 'chat'"))[0]!
  assert.deepEqual({ ...b }, { step_state: 'needs_input', stop_reason: '[needs_input] Which repo do you mean?', acked_at: null })

  const failed = await withChat()
  await run.main(['--once'], { api: async () => ({ ok: true, steps: [] }), veraApi: failed.veraApi, launchChat: async () => ({ ok: false, summary: 'API Error: 429 rate limit' }) })
  const f = (await q(failed.db, "SELECT step_state, stop_reason FROM gov_task_steps WHERE role = 'chat'"))[0]!
  assert.equal(f.step_state, 'failed')
  assert.match(String(f.stop_reason), /^\[transient\]/)
})

test('pickChat: only open chat steps for agt-orchestrator, oldest first, one at a time', () => {
  const chat = (over: object) => ({ role: 'chat', assignee: 'agt-orchestrator', step_state: 'awaiting_pull', step_id: 'S', task_id: 'T', created_at: '2026-11-06T10:00:00Z', ...over })
  const steps = [chat({ step_id: 'late', created_at: '2026-11-06T12:00:00Z' }), chat({ step_id: 'early' }), chat({ step_id: 'builder', role: 'builder' }), chat({ step_id: 'other', assignee: 'agt-codex' }),
    chat({ step_id: 'done', acked_at: '2026-11-06T09:00:00Z' }), chat({ step_id: 'nudged', step_state: 'awaiting_start', created_at: '2026-11-06T13:00:00Z' })]
  assert.deepEqual(run.pickChat(steps, []).map((s: { step_id: string }) => s.step_id), ['early'])
  assert.deepEqual(run.pickChat(steps, [{ task_id: 'T', chat: true }]), [])
  assert.deepEqual(run.pickChat(steps, [{ task_id: 'T' }]).map((s: { step_id: string }) => s.step_id), ['early'], 'a builder run does not block a chat')
})

test('chatClassRefusal: untagged, personal and general cards may be answered; client and fj cards are left for Meshach', () => {
  assert.equal(run.chatClassRefusal({ tags: '' }), '')
  assert.equal(run.chatClassRefusal({ tags: 'x,class-personal' }), '')
  assert.equal(run.chatClassRefusal({ tags: 'class-general, class-personal' }), '')
  assert.match(run.chatClassRefusal({ tags: 'class-catalyst' }), /catalyst/)
  assert.match(run.chatClassRefusal({ tags: 'class-personal,class-fj' }), /fj/)
})

test('a chat on a client-class card is not answered: the step goes to needs_input and the orchestrator is never launched', async () => {
  const { db, veraApi } = await withChat()
  let turns = 0
  const classed = async (op: string, args: Record<string, unknown>) => {
    const r = await veraApi(op, args)
    return op === 'list_claimable' || op === 'get_task' ? (r.task ? { ...r, task: { ...r.task, tags: 'class-catalyst' } } : r) : r
  }
  await run.main(['--once'], { api: async () => ({ ok: true, steps: [] }), veraApi: classed, launchChat: async () => { turns++; return { ok: true, summary: 'x' } } })
  assert.equal(turns, 0)
  const c = (await q(db, "SELECT step_state, stop_reason FROM gov_task_steps WHERE role = 'chat'"))[0]!
  assert.equal(c.step_state, 'needs_input')
  assert.match(String(c.stop_reason), /catalyst/)
})

test('orchestratorCommand: only the read tools of the local orchestrator server, the given MCP config, no shell or file tools', () => {
  const cmd: string[] = run.veraCommand({ dir: '/tmp/x', maxUsd: 2, mcpConfig: '/cfg/mcp.json' })
  assert.equal(cmd[cmd.indexOf('--mcp-config') + 1], '/cfg/mcp.json')
  const allowed = cmd.slice(cmd.indexOf('--allowedTools') + 1)
  assert.deepEqual(allowed, ['mcp__vera-local__vera_brief', 'mcp__vera-local__recall'], 'life_facts is not allowed: personal facts must not reach a shared card')
  assert.ok(cmd.includes('--strict-mcp-config'))
})

test('the chat prompt carries the card\'s request and acceptance text, not only the hand-off note', () => {
  const prompt = run.buildChatPrompt(
    { task_id: 'TSK-9', title: 'A card', original_request: 'Tell me your focus in one sentence.', acceptance_requirements: 'A note with the focus.' },
    { step_id: 'STP-1', goal: 'Triage hand-off', input_ref: 'NTE-1' },
    [{ note_id: 'NTE-1', author_id: 'agt-x', kind: 'comment', body: 'Hand-off from agt-x.\nclassification: personal' }]
  )
  assert.match(prompt, /What the card asks: Tell me your focus in one sentence\./)
  assert.match(prompt, /Done when: A note with the focus\./)
  const bare = run.buildChatPrompt({ task_id: 'TSK-9', title: 'A card' }, { step_id: 'STP-1', goal: 'g', input_ref: 'NTE-1' }, [])
  assert.doesNotMatch(bare, /What the card asks/)
})
