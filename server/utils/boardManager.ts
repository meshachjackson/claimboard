// The board manager: a chat agent that runs the board in bulk for the owner.
// It is the Messages API plus a tool loop. Every tool writes through boardStore().write as the board owner (the same ops
// the UI uses), so the gateway's rules still apply and a refusal comes back to the model as text. The model never
// sees tokens or secrets. The conversation is kept by the browser; each request carries it.
import type { BoardData, GovTask, GovTaskStep, RegistryAgent, WriteResult } from '~~/app/types/board'
import { CHAT_ROLE, STAGES } from '~~/app/types/board'
import { classMismatch } from '~~/app/utils/agentLane'
import { findDupes, planMerge, suggestKeeper } from '~~/app/utils/dupes'
import { activeSteps, primaryStep } from '~~/app/utils/rollup'
import { noTaker } from '~~/app/utils/whoseMove'

export interface ManagerDeps {
  /** The board's rows, fresh. */
  read(): Promise<BoardData> | BoardData
  /** One owner op, as boardStore().write does it. */
  write(op: string, args: Record<string, unknown>): Promise<WriteResult>
  /** The error log, grouped (errorLog.ts readErrors). Absent in tests that do not need it. */
  errors?(q: { since?: string, until?: string }): Promise<unknown>
}

export interface ChatMessage { role: 'user' | 'assistant', content: string }
/** One line of what the agent did, shown under its answer. */
export interface ManagerAction { tool: string, summary: string, ok: boolean }

type Input = Record<string, any>
const MAX_CARDS_PER_CALL = 50
const MAX_TURNS = 12 // model calls per user message, so a confused loop ends
const text = (v: unknown) => String(v ?? '').trim()
const stageOf = (t: GovTask) => t.stage ?? 'backlog'
const refusal = (r: WriteResult) => (r.ok ? '' : r.reason)

/** The working copy of the board for one request. Writes return the changed rows, which are merged in, so updated_at stays current. */
export class ManagerBoard {
  tasks = new Map<string, GovTask>()
  steps: GovTaskStep[] = []
  notes: BoardData['notes'] = []
  registry: RegistryAgent[] = []
  actions: ManagerAction[] = []

  private deps: ManagerDeps
  constructor(deps: ManagerDeps) { this.deps = deps }

  async load() {
    const data = await this.deps.read()
    this.tasks = new Map(data.tasks.map(t => [t.task_id, t]))
    this.steps = data.steps
    this.notes = data.notes
    this.registry = data.registry ?? []
  }

  /** Why no agent can take this card, the same rule the board marks it by (utils/whoseMove noTaker), or ''. */
  noTaker(t: GovTask): string {
    const steps = activeSteps(this.steps.filter(s => s.task_id === t.task_id && s.role !== CHAT_ROLE))
    const tags = (t.tags ?? '').split(',').map(x => x.trim()).filter(Boolean)
    const classWarning = classMismatch(tags, this.registry.find(a => a.agent_id === t.assignee))
    return noTaker({ workState: t.work_state, stage: stageOf(t), archived: !!t.archived_at, primary: primaryStep(steps), classWarning }, this.registry)
  }

  private merge(r: WriteResult) {
    if (!r.ok) return
    for (const t of r.rows.tasks ?? []) this.tasks.set(t.task_id, t)
    for (const s of r.rows.steps ?? []) this.steps = [...this.steps.filter(x => x.step_id !== s.step_id), s]
    for (const n of r.rows.notes ?? []) this.notes = [...this.notes.filter(x => x.note_id !== n.note_id), n]
  }

  /** The error log, or null when this manager has none wired in. */
  errors(q: { since?: string, until?: string }): Promise<unknown> | null {
    return this.deps.errors ? this.deps.errors(q) : null
  }

  async op(op: string, args: Record<string, unknown>): Promise<WriteResult> {
    const r = await this.deps.write(op, args)
    this.merge(r)
    return r
  }

  /** An op on an existing card: adds the card's current updated_at. */
  async onTask(op: string, taskId: string, args: Record<string, unknown> = {}): Promise<WriteResult> {
    const t = this.tasks.get(taskId)
    if (!t) return { ok: false, reason: `unknown card ${taskId}` }
    return this.op(op, { task_id: taskId, ...args, updated_at: t.updated_at })
  }

  async move(taskId: string, stage: string): Promise<string> {
    const t = this.tasks.get(taskId)
    if (!t) return `unknown card ${taskId}`
    if (stageOf(t) === stage) return ''
    // Done on a card with no open steps and no passing verification goes through done_no_steps, as the UI does.
    const open = this.steps.some(s => s.task_id === taskId && s.cancelled !== true && !s.acked_at)
    if (stage === 'done' && !open && !/^pass/.test(t.internal_verification ?? '')) return refusal(await this.onTask('done_no_steps', taskId))
    return refusal(await this.onTask('move_task', taskId, { stage }))
  }

  log(tool: string, summary: string, ok = true) {
    this.actions.push({ tool, summary, ok })
  }
}

const compact = (t: GovTask, b: ManagerBoard) => ({
  id: t.task_id, title: t.title, stage: stageOf(t), work_state: t.work_state, priority: t.priority, assignee: t.assignee || undefined,
  project: t.project_id || undefined, tags: t.tags || undefined, pinned: t.pinned_at ? true : undefined,
  open_steps: b.steps.filter(s => s.task_id === t.task_id && s.cancelled !== true && !s.acked_at).length,
  no_taker: b.noTaker(t) || undefined
})

const UPDATE_FIELDS = ['title', 'priority', 'project_id', 'tags', 'due_at', 'acceptance_requirements', 'task_type'] as const
const CREATE_FIELDS = ['title', 'original_request', 'acceptance_requirements', 'task_type', 'priority', 'project_id', 'tags', 'due_at'] as const
const pick = (src: Input, keys: readonly string[]) =>
  Object.fromEntries(keys.map(k => [k, text(src[k])]).filter(([, v]) => v !== ''))

/** Runs one tool call and returns the text the model reads back. Refusals are text, not exceptions. */
export async function runTool(b: ManagerBoard, name: string, input: Input): Promise<string> {
  const ids = (key: string): string[] => (Array.isArray(input[key]) ? input[key].map(text).filter(Boolean) : []).slice(0, MAX_CARDS_PER_CALL)
  switch (name) {
    case 'list_cards': {
      const q = text(input.text).toLowerCase()
      const rows = [...b.tasks.values()].filter(t =>
        (input.include_archived === true || !t.archived_at)
        && (!input.stage || stageOf(t) === input.stage)
        && (!input.assignee || t.assignee === input.assignee)
        && (!input.project_id || t.project_id === input.project_id)
        && (!input.tag || (t.tags ?? '').split(',').map(x => x.trim()).includes(text(input.tag)))
        && (!q || `${t.title} ${t.original_request}`.toLowerCase().includes(q)))
      const limit = Math.min(Number(input.limit) || 100, 200)
      return JSON.stringify({ total: rows.length, cards: rows.slice(0, limit).map(t => compact(t, b)) })
    }
    case 'recent_errors': {
      // Read only: what the board logged as faults, so the owner can ask "what just happened?" and get cards for what is wrong.
      const log = b.errors({ since: text(input.since), until: text(input.until) })
      if (!log) return 'the error log is not available here'
      try {
        return JSON.stringify(await log)
      } catch (e) {
        return e instanceof Error ? e.message : 'could not read the error log'
      }
    }
    case 'list_agents': {
      // Read only: who can take work, so the manager can suggest a reassignment for a card no agent can take.
      const agents = b.registry.filter(a => a.agent_type !== 'gateway').map(a => ({
        id: a.agent_id, name: a.name, type: a.agent_type || undefined, status: a.lifecycle_status,
        switch: a.switch || 'on', classes: a.classes
      }))
      return JSON.stringify({ agents, note: 'Only active agents with the switch on or auto take work. person:<name> is a person.' })
    }
    case 'get_card': {
      const t = b.tasks.get(text(input.task_id))
      if (!t) return `unknown card ${text(input.task_id)}`
      const steps = b.steps.filter(s => s.task_id === t.task_id).map(s => ({ id: s.step_id, role: s.role, state: s.step_state, assignee: s.assignee, cancelled: s.cancelled || undefined }))
      const notes = b.notes.filter(n => n.task_id === t.task_id).slice(-6).map(n => ({ kind: n.kind, by: n.author_id, body: String(n.body).slice(0, 400) }))
      return JSON.stringify({ card: { ...compact(t, b), original_request: t.original_request, acceptance_requirements: t.acceptance_requirements, due_at: t.due_at }, steps, notes })
    }
    case 'create_cards': {
      const cards: Input[] = Array.isArray(input.cards) ? input.cards.slice(0, MAX_CARDS_PER_CALL) : []
      const out: string[] = []
      for (const c of cards) {
        const args = pick(c, CREATE_FIELDS)
        if (!args.title) { out.push('skipped a card with no title'); continue }
        args.original_request ||= args.title
        const r = await b.op('create_task', args)
        const made = r.ok ? r.rows.tasks?.[0] : undefined
        if (made && text(c.assignee)) await b.onTask('assign', made.task_id, { assignee: text(c.assignee) })
        if (made && text(c.stage) && c.stage !== 'backlog') await b.move(made.task_id, text(c.stage))
        out.push(made ? `${made.task_id} created: ${made.title}` : `refused "${args.title}": ${refusal(r)}`)
      }
      b.log(name, `Created ${out.filter(x => x.includes(' created: ')).length} of ${cards.length} cards`)
      return out.join('\n') || 'no cards given'
    }
    case 'move_cards': {
      const stage = text(input.stage)
      if (!(STAGES as readonly string[]).includes(stage)) return `stage must be one of ${STAGES.join(', ')}`
      const out: string[] = []
      for (const id of ids('task_ids')) out.push(`${id}: ${(await b.move(id, stage)) || `now in ${stage}`}`)
      b.log(name, `Moved ${out.filter(x => x.endsWith(`now in ${stage}`)).length} of ${out.length} cards to ${stage}`)
      return out.join('\n') || 'no cards given'
    }
    case 'update_cards': {
      const updates: Input[] = Array.isArray(input.updates) ? input.updates.slice(0, MAX_CARDS_PER_CALL) : []
      const out: string[] = []
      for (const u of updates) {
        const id = text(u.task_id)
        const fields = pick(u, UPDATE_FIELDS)
        let why = ''
        if (Object.keys(fields).length) why = refusal(await b.onTask('update_task', id, fields))
        if (!why && text(u.assignee)) why = refusal(await b.onTask('assign', id, { assignee: text(u.assignee) }))
        out.push(`${id}: ${why || 'updated'}`)
      }
      b.log(name, `Updated ${out.filter(x => x.endsWith('updated')).length} of ${updates.length} cards`)
      return out.join('\n') || 'no updates given'
    }
    case 'find_duplicates': {
      const groups = findDupes([...b.tasks.values()]).map(g => ({ keeper: suggestKeeper(g), cards: g.map(t => compact(t, b)) }))
      return JSON.stringify({ note: 'Exact title matches only. Judge near-matches yourself with list_cards.', groups })
    }
    case 'merge_cards': {
      // Same steps as the Find duplicates dialog: note, cancel open steps, move to Done, archive, then a note on the keeper.
      const keeper = text(input.keeper)
      const group = [keeper, ...ids('duplicates')].map(id => b.tasks.get(id)).filter((t): t is GovTask => !!t)
      if (group.length < 2 || group[0]!.task_id !== keeper) return 'give a keeper and at least one duplicate, all real cards'
      const plan = planMerge(group, b.steps, keeper)
      const done: string[] = []
      const out: string[] = plan.kept.map(k => `${k.task.task_id}: left alone (${k.reason})`)
      for (const { task, cancel } of plan.remove) {
        let why = refusal(await b.op('add_note', { task_id: task.task_id, kind: 'comment', body: `Merged into ${keeper}. Closed as a duplicate.` }))
        for (const s of cancel) if (!why) why = refusal(await b.op('cancel_step', { step_id: s.step_id, updated_at: s.updated_at }))
        if (!why) why = await b.move(task.task_id, 'done')
        if (!why) why = refusal(await b.onTask('archive_task', task.task_id))
        out.push(`${task.task_id}: ${why || `merged into ${keeper}`}`)
        if (!why) done.push(task.task_id)
      }
      if (done.length) await b.op('add_note', { task_id: keeper, kind: 'comment', body: `Merged duplicates: ${done.join(', ')}.` })
      b.log(name, `Merged ${done.length} duplicate${done.length === 1 ? '' : 's'} into ${keeper}`, done.length > 0)
      return out.join('\n')
    }
    case 'split_card': {
      const src = b.tasks.get(text(input.task_id))
      const parts: Input[] = Array.isArray(input.parts) ? input.parts.slice(0, 20) : []
      if (!src) return `unknown card ${text(input.task_id)}`
      if (parts.length < 2) return 'a split needs at least two parts'
      const made: string[] = []
      for (const p of parts) {
        const args = pick(p, CREATE_FIELDS)
        if (!args.title) continue
        args.original_request ||= `Split from ${src.task_id}: ${src.title}`
        args.project_id ||= src.project_id
        args.priority ||= src.priority
        const r = await b.op('create_task', args)
        if (r.ok && r.rows.tasks?.[0]) made.push(r.rows.tasks[0].task_id)
      }
      if (made.length) await b.op('add_note', { task_id: src.task_id, kind: 'comment', body: `Split into ${made.join(', ')}.` })
      // The original is archived only when asked, and only if it can be closed cleanly.
      let closed = ''
      if (made.length && input.archive_original === true) {
        closed = (await b.move(src.task_id, 'done')) || refusal(await b.onTask('archive_task', src.task_id))
      }
      b.log(name, `Split ${src.task_id} into ${made.length} cards`, made.length === parts.length)
      return `created ${made.join(', ') || 'nothing'}${input.archive_original === true ? (closed ? `; original not archived: ${closed}` : '; original archived') : ''}`
    }
    case 'archive_cards': {
      const out: string[] = []
      for (const id of ids('task_ids')) {
        let why = await b.move(id, 'done')
        if (!why) why = refusal(await b.onTask('archive_task', id))
        out.push(`${id}: ${why || 'archived'}`)
      }
      b.log(name, `Archived ${out.filter(x => x.endsWith('archived')).length} of ${out.length} cards`)
      return out.join('\n') || 'no cards given'
    }
    case 'add_note': {
      const r = await b.op('add_note', { task_id: text(input.task_id), kind: 'comment', body: text(input.body).slice(0, 2000) })
      b.log(name, `Noted ${text(input.task_id)}`, r.ok)
      return r.ok ? 'noted' : refusal(r)
    }
    default:
      return `unknown tool ${name}`
  }
}

const str = (description: string) => ({ type: 'string', description })
const strList = (description: string) => ({ type: 'array', items: { type: 'string' }, description })
const cardProps = {
  title: str('Short card title'),
  original_request: str('What is wanted, in plain words. Defaults to the title.'),
  acceptance_requirements: str('Checkable outcomes separated by " | "'),
  task_type: { type: 'string', enum: ['build', 'operational'] },
  priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
  project_id: str('Project, for example agent-board'),
  tags: str('Comma-separated lowercase slugs'),
  due_at: str('YYYY-MM-DD')
}

export const MANAGER_TOOLS = [
  { name: 'list_cards', description: 'List cards, compact. Filter by stage, assignee, project_id, tag or text in the title or request. Start here to see the board.',
    input_schema: { type: 'object', properties: { stage: { type: 'string', enum: [...STAGES] }, assignee: str('agt-… or person:…'), project_id: str('Project'), tag: str('One tag'), text: str('Words to find'), include_archived: { type: 'boolean' }, limit: { type: 'number' } } } },
  { name: 'recent_errors', description: 'Faults the board logged (server errors, gateway failures, failed rollups) in a window, grouped with counts. Blank since means the last hour. Use it for "what just happened?" or "something is wrong", then offer one card per fault with create_cards.',
    input_schema: { type: 'object', properties: { since: str('ISO timestamp, start of the window'), until: str('ISO timestamp, end of the window') } } },
  { name: 'list_agents', description: 'Every agent on the board: id, name, type, status, the owner\'s on/off switch and classes. Use it before suggesting who should take a card, above all a card whose no_taker is set.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'get_card', description: 'One card with its request, steps and latest notes. Use to check context before merging, splitting or moving.',
    input_schema: { type: 'object', properties: { task_id: str('TSK-…') }, required: ['task_id'] } },
  { name: 'create_cards', description: 'Create many cards in one call (up to 50). They land in Backlog unless stage is set.',
    input_schema: { type: 'object', properties: { cards: { type: 'array', items: { type: 'object', properties: { ...cardProps, assignee: str('Optional agt-… or person:…'), stage: { type: 'string', enum: [...STAGES] } }, required: ['title'] } } }, required: ['cards'] } },
  { name: 'move_cards', description: 'Move many cards to one stage. The board refuses moves its rules forbid; the answer says which.',
    input_schema: { type: 'object', properties: { task_ids: strList('Card IDs'), stage: { type: 'string', enum: [...STAGES] } }, required: ['task_ids', 'stage'] } },
  { name: 'update_cards', description: 'Edit fields on many cards. Each update names the card and only the fields that change.',
    input_schema: { type: 'object', properties: { updates: { type: 'array', items: { type: 'object', properties: { task_id: str('TSK-…'), ...cardProps, assignee: str('agt-… or person:…') }, required: ['task_id'] } } }, required: ['updates'] } },
  { name: 'find_duplicates', description: 'Groups of cards with the same title, each with a suggested keeper. Exact matches only; look for near-matches with list_cards.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'merge_cards', description: 'Merge duplicates into a keeper: each duplicate gets a note, loses its open steps, and is archived; the keeper gets a note. Pinned cards and cards an agent is running are left alone. Read both cards first when the titles only look alike.',
    input_schema: { type: 'object', properties: { keeper: str('TSK-… that stays'), duplicates: strList('TSK-… to close') }, required: ['keeper', 'duplicates'] } },
  { name: 'split_card', description: 'Split one card into two or more new cards (each part inherits project and priority). The original gets a note listing them, and is archived only if archive_original is true.',
    input_schema: { type: 'object', properties: { task_id: str('TSK-… to split'), parts: { type: 'array', items: { type: 'object', properties: cardProps, required: ['title'] } }, archive_original: { type: 'boolean' } }, required: ['task_id', 'parts'] } },
  { name: 'archive_cards', description: 'Take cards off the board: each is closed as Done first, then archived. Rows stay in the tables. Do this only when the owner asked for it.',
    input_schema: { type: 'object', properties: { task_ids: strList('Card IDs') }, required: ['task_ids'] } },
  { name: 'add_note', description: 'Add a comment to a card. No agent is woken.',
    input_schema: { type: 'object', properties: { task_id: str('TSK-…'), body: str('The note') }, required: ['task_id', 'body'] } }
]

export const MANAGER_SYSTEM = [
  'You are the board manager for the owner\'s agent board: a product manager who runs the whole board for him, in bulk, from this chat.',
  'You can list and read cards, create many at once, move, edit, merge duplicates, split a card, archive, and add notes. Use the tools; never claim a change you did not make.',
  'Stages, left to right: backlog, architecture, build, review, done. Cards you create go to Backlog. You do not start agents or approve plans; the owner does that on the card.',
  'Look before you change: list_cards first on any request about existing cards, and get_card before a merge or split. Do bulk work in one call, not one card at a time.',
  'Archiving or merging removes cards from the board, so do it only on a clear request, and say which cards went. If a request is vague, ask one short question.',
  'Write in plain, short sentences. Give every card ID a short title. After acting, report what changed, what the board refused and why, and what you suggest next.',
  'A card with no_taker set has an open step no agent can take (no agent of that type in service, the agent switched off, or a class tag that rules it out). The owner has to decide. Help him: read the card and list_agents, then give two or three options (reassign with update_cards, fix its tags, he takes it himself, or close it) and say which you would pick. Change it only when he says which.',
  'When the owner says something broke, or asks what just happened, call recent_errors and explain the faults in plain words. Only create cards for them when he asks; one card per fault, with the count and when it started.',
  'Never put secrets or client data in a card. Dates use American format.'
].join('\n')

export type ModelCall = (body: Record<string, unknown>) => Promise<{ content: any[], stop_reason: string }>

/** The Messages API over fetch. The key comes from the server's settings, never the browser. */
export function anthropicCall(apiKey: string): ModelCall {
  return async (body) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`The model service answered ${res.status}`)
    return res.json()
  }
}

/** One user turn: runs the model and its tools until it answers in text. Returns the answer and what it did. */
export async function runManager(
  messages: ChatMessage[],
  deps: ManagerDeps,
  call: ModelCall,
  model: string
): Promise<{ reply: string, actions: ManagerAction[] }> {
  const board = new ManagerBoard(deps)
  await board.load()
  const convo: any[] = messages.map(m => ({ role: m.role, content: m.content }))
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await call({ model, max_tokens: 4096, system: MANAGER_SYSTEM, tools: MANAGER_TOOLS, messages: convo })
    const uses = res.content.filter(c => c.type === 'tool_use')
    if (!uses.length) {
      const reply = res.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim()
      return { reply: reply || 'Done.', actions: board.actions }
    }
    convo.push({ role: 'assistant', content: res.content })
    const results = []
    for (const u of uses) {
      let out: string
      try { out = await runTool(board, u.name, u.input ?? {}) } catch (e) { out = `error: ${(e as Error).message}` }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out.slice(0, 20000) })
    }
    convo.push({ role: 'user', content: results })
  }
  return { reply: 'I stopped after too many steps. Tell me what to do next.', actions: board.actions }
}
