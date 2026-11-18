#!/usr/bin/env node
// Checks board-cleanup change sheets (docs/board-cleanup/<cluster>.json) against the frozen taxonomy and a board file.
// Read-only: it never writes the board or any table.
//
//   node scripts/board-cleanup-check.mjs --board <board.json> --registry <registry.json> --cluster gov
//   node scripts/board-cleanup-check.mjs --board <board.json> --registry <registry.json> --all
//
// Exits 0 when every check passes, 1 when any fails. Prints one line per failure.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'board-cleanup')
// Agents that pick up work today. A retired agent and pool:advisor are not listed.
const ASSIGNABLE = ['agt-claude-code-macbook', 'agt-claude-code-cloud', process.env.NUXT_PUBLIC_ORCHESTRATOR_AGENT_ID || 'agt-orchestrator', 'agt-builder-local', 'agt-api-anthropic', 'agt-codex-macbook']
// The board owner is assignable too. It comes from NUXT_PUBLIC_BOARD_OWNER (person:<name>); run with node --env-file=.env.
const OWNER = process.env.NUXT_PUBLIC_BOARD_OWNER
if (!OWNER) throw new Error('NUXT_PUBLIC_BOARD_OWNER is not set (person:<name>); run with node --env-file=.env')
ASSIGNABLE.push(OWNER)
const LIVE = ['awaiting_start', 'awaiting_pull', 'dispatched', 'needs_input']
const FIELDS = ['task_id', 'title_now', 'title_new', 'disposition', 'survivor', 'project_id', 'epic', 'milestone', 'assignee', 'step_actions', 'next_action', 'reason']

const args = process.argv.slice(2)
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : '' }
const read = p => JSON.parse(readFileSync(p, 'utf8'))

const tax = read(join(DIR, 'taxonomy.json'))
const clusters = read(join(DIR, 'clusters.json'))
const board = read(opt('--board'))
const agents = new Set(read(opt('--registry')).registry.map(r => r.agent_id))
const tasks = new Map(board.tasks.map(t => [t.task_id, t]))
const isLive = s => LIVE.includes(s.step_state) && !s.cancelled
const tagsOf = t => String(t.tags || '').split(',').filter(Boolean)

const fails = []
const fail = (id, msg) => fails.push(`${id}: ${msg}`)

function checkSheet(name) {
  const file = join(DIR, `${name}.json`)
  if (!existsSync(file)) { fail(name, `missing ${file}`); return [] }
  const sheet = read(file)
  if (!Array.isArray(sheet)) { fail(name, 'sheet is not a JSON array'); return [] }
  const want = clusters[name]
  const seen = sheet.map(e => e.task_id)

  // 1. Every cluster ID exactly once, nothing else.
  for (const id of want) if (seen.filter(x => x === id).length !== 1) fail(id, `appears ${seen.filter(x => x === id).length} times (want 1)`)
  for (const id of seen) if (!want.includes(id)) fail(id, `not in cluster ${name}`)

  for (const e of sheet) {
    const id = e.task_id
    const t = tasks.get(id)
    if (!t) { fail(id, 'not on the board'); continue }
    // 7. Only the agreed fields: nothing that could reach gov_registry or gov_access.
    for (const k of Object.keys(e)) if (!FIELDS.includes(k)) fail(id, `unexpected field ${k}`)
    if (!tax.dispositions.includes(e.disposition)) fail(id, `bad disposition ${e.disposition}`)
    if (e.title_now !== t.title) fail(id, 'title_now does not match the board')
    if (e.title_new && e.title_new.length > 60) fail(id, `title_new is ${e.title_new.length} chars (max 60)`)
    if (!e.reason) fail(id, 'no reason')

    const live = board.steps.filter(s => s.task_id === id && isLive(s))
    const actions = Array.isArray(e.step_actions) ? e.step_actions : []
    if (!Array.isArray(e.step_actions)) fail(id, 'step_actions must be an array')
    const cancels = new Set(actions.filter(a => a.op === 'cancel').map(a => a.step_id))
    const creates = actions.filter(a => a.op === 'create')
    for (const a of actions) {
      if (!['cancel', 'create'].includes(a.op)) fail(id, `bad step op ${a.op}`)
      if (a.op === 'cancel' && !live.some(s => s.step_id === a.step_id)) fail(id, `cancel ${a.step_id} is not a live step on this card`)
      if (a.op === 'create') {
        if (!tax.step_roles.includes(a.role)) fail(id, `bad step role ${a.role}`)
        if (!ASSIGNABLE.includes(a.assignee)) fail(id, `step assignee ${a.assignee} is not assignable`)
        if (!a.instruction) fail(id, 'create step has no instruction')
      }
    }
    // Live steps that will never be picked up must be cancelled.
    for (const s of live) {
      const dead = String(s.assignee || '').startsWith('pool:') || (s.assignee && !s.assignee.startsWith('person:') && !agents.has(s.assignee)) || s.assignee === 'agt-advisor-local'
      if (dead && !cancels.has(s.step_id)) fail(id, `live step ${s.step_id} on ${s.assignee} must be cancelled`)
    }

    if (e.disposition === 'keep') {
      // 2 and 3. One project, one epic of that project, one milestone.
      const epics = tax.projects[e.project_id]
      if (!epics) fail(id, `bad project_id ${e.project_id}`)
      else if (!epics.includes(e.epic)) fail(id, `epic ${e.epic} is not in project ${e.project_id}`)
      if (!tax.milestones.includes(e.milestone)) fail(id, `bad milestone ${e.milestone}`)
      if (e.project_id === 'outside' && e.milestone !== 'ms-post-beta') fail(id, 'outside cards take ms-post-beta')
      // 4. A real owner.
      if (!ASSIGNABLE.includes(e.assignee)) fail(id, `assignee ${e.assignee} is not assignable`)
      // 6. Beta cards have a live step left or a new one; every kept card has a next action.
      const liveLeft = live.filter(s => !cancels.has(s.step_id)).length
      if (tax.beta_milestones.includes(e.milestone) && !liveLeft && !creates.length) fail(id, `${e.milestone} card has no live step and no create`)
      if (!e.next_action) fail(id, 'kept card has no next_action')
      if (e.survivor) fail(id, 'kept card should not name a survivor')
    } else {
      // Closed, merged or archived cards leave nothing live behind.
      for (const s of live) if (!cancels.has(s.step_id)) fail(id, `live step ${s.step_id} must be cancelled when the card goes`)
      if (creates.length) fail(id, `${e.disposition} card should not create steps`)
      if (e.disposition === 'merge' && !e.survivor) fail(id, 'merge names no survivor')
    }
    // 8. Catalyst cards carry no card content: short reason and next action only.
    if (tagsOf(t).includes('class-catalyst')) {
      for (const k of ['reason', 'next_action']) if (String(e[k] || '').length > 120) fail(id, `class-catalyst card: ${k} over 120 chars`)
    }
  }
  return sheet
}

const names = args.includes('--all') ? Object.keys(clusters) : [opt('--cluster')]
const all = names.flatMap(n => checkSheet(n).map(e => ({ ...e, cluster: n })))
const byId = new Map(all.map(e => [e.task_id, e]))

// 5. Every survivor is a kept card. Across clusters only when every sheet is loaded.
for (const e of all.filter(x => x.disposition === 'merge' && x.survivor)) {
  const s = byId.get(e.survivor)
  if (s) { if (s.disposition !== 'keep') fail(e.task_id, `survivor ${e.survivor} is ${s.disposition}, not keep`) }
  else if (args.includes('--all')) fail(e.task_id, `survivor ${e.survivor} is not in any sheet`)
  else if (!tasks.has(e.survivor)) fail(e.task_id, `survivor ${e.survivor} is not on the board`)
}

const counts = all.reduce((c, e) => ({ ...c, [e.disposition]: (c[e.disposition] || 0) + 1 }), {})
console.log(`${names.join(', ')}: ${all.length} entries ${JSON.stringify(counts)}`)
console.log(fails.length ? fails.join('\n') + `\nFAIL: ${fails.length} problems` : 'PASS: every check holds')
process.exit(fails.length ? 1 : 0)
