#!/usr/bin/env node
// Applies the board-cleanup change sheets (docs/board-cleanup/<cluster>.json) to a local board file, through the board's
// own op rules (app/utils/boardOps.ts, the fixture port of gw.gov-board-write), as the board owner. Each op checks what the
// gateway checks: stale rows, archived cards, live leases, Done rules. A refusal is reported, never forced.
// It writes only the --out file. Push it to hosted with board-sync (plan --file <out>, then apply), after Meshach says go.
//
//   node scripts/board-cleanup-apply.mjs --board .data/board.json --registry .data/registry.json --out <candidate.json>
//
// Ops per card:
//   keep:              cancel_step for each cancel, update_task (title, project_id, tags), assign, then a step create:
//                      architect = move_task to architecture, builder = start_task. Other roles are reported for a hand Start.
//   merge/close/archive: cancel_step for each cancel, one comment note saying why (and on the survivor, what merged in),
//                      done_no_steps, archive_task.
// The ops refuse an archived card. The few open cards that are already archived get archived_at cleared first and set
// again after, and the report marks that as a direct field write.
import { register } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
register('./lib/ts-alias-hook.mjs', import.meta.url)
const { applyOp, holdsCardOut } = await import(join(HERE, '..', 'app', 'utils', 'boardOps.ts'))
const { setBoardOwner } = await import(join(HERE, '..', 'app', 'types', 'board.ts'))

const args = process.argv.slice(2)
const opt = (name, dflt = '') => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt }
const read = p => JSON.parse(readFileSync(p, 'utf8'))
const DIR = opt('--sheets', join(HERE, '..', 'docs', 'board-cleanup'))
const out = opt('--out')
if (!out) throw new Error('--out <file> is required; this script never writes the board file in place')

// Cards whose builder step waits for Meshach's go (hold): the card is tagged, the step isn't opened.
const HOLD = new Set(opt('--hold').split(',').filter(Boolean))
// The owner is a setting, not code: NUXT_PUBLIC_BOARD_OWNER (person:<name>), e.g. node --env-file=.env scripts/board-cleanup-apply.mjs ...
const OWNER = process.env.NUXT_PUBLIC_BOARD_OWNER
if (!OWNER) throw new Error('NUXT_PUBLIC_BOARD_OWNER is not set (person:<name>); run with node --env-file=.env')
setBoardOwner(OWNER, process.env.NUXT_PUBLIC_BOARD_OWNER_NAME || undefined)
const caller = { person: OWNER }
const saved = read(opt('--board', '.data/board.json'))
const board = {
  tasks: saved.tasks, steps: saved.steps, notes: saved.notes,
  columns: read(join(HERE, '..', 'mock', 'board_columns.json')),
  registry: read(opt('--registry', '.data/registry.json')).registry
}
const sheets = Object.keys(read(join(DIR, 'clusters.json'))).flatMap(n => read(join(DIR, `${n}.json`)))
const byId = new Map(sheets.map(e => [e.task_id, e]))
const task = id => board.tasks.find(t => t.task_id === id)
const step = id => board.steps.find(s => s.step_id === id)
const STAMP = 'Board cleanup, 11/02/2026 (approved by Meshach, applied by Claude Code)'

const log = []
let refused = 0
function op(id, name, a) {
  const r = applyOp(board, name, a, caller)
  log.push(`${id} ${name}${a.step_id ? ` ${a.step_id}` : ''}: ${r.ok ? 'ok' : `REFUSED ${r.reason}`}`)
  if (!r.ok) refused++
  return r
}
const ts = id => task(id).updated_at

// New tags: the card's tags minus any old epic/milestone/release tag, plus the sheet's epic and milestone.
function tagsFor(t, e) {
  const keep = String(t.tags || '').split(',').filter(x => x && !/^(epic|ms|rel)-/.test(x))
  return [...keep, e.epic, e.milestone].join(',')
}

for (const e of sheets) {
  const id = e.task_id
  const t = task(id)
  if (!t) { log.push(`${id}: not on the board`); refused++; continue }
  const wasArchived = !!t.archived_at
  const archivedAt = t.archived_at
  if (wasArchived) { t.archived_at = null; log.push(`${id}: direct write, archived_at cleared so the ops can run`) }
  const wasBlocked = t.work_state === 'blocked'
  // A card with stage done but an open work_state is half-closed; no op can finish it, so set work_state.
  if (t.stage === 'done' && t.work_state !== 'done' && e.disposition !== 'keep') { t.work_state = 'done'; log.push(`${id}: direct write, work_state done to match stage done`) }

  for (const a of e.step_actions.filter(x => x.op === 'cancel')) op(id, 'cancel_step', { step_id: a.step_id, updated_at: step(a.step_id)?.updated_at })

  // A kept card that is already archived (the regression fixtures and 128, which the ops repo's regression
  // reads) is left exactly as it is: no tags, no owner, no state change.
  if (e.disposition === 'keep' && wasArchived) { t.archived_at = archivedAt; log.push(`${id}: kept and archived, left unchanged`); continue }

  if (e.disposition === 'keep') {
    const fields = { project_id: e.project_id, tags: tagsFor(t, e) }
    if (e.title_new) fields.title = e.title_new
    if (t.work_state !== 'done') op(id, 'update_task', { task_id: id, updated_at: ts(id), ...fields })
    // Never hand a card to someone else while an agent holds one of its steps.
    const held = board.steps.find(s => s.task_id === id && s.step_state === 'dispatched' && !s.cancelled)
    if (held && e.assignee && t.assignee !== e.assignee) log.push(`${id}: kept assignee ${t.assignee}; ${held.step_id} is dispatched to ${held.assignee}`)
    else if (e.assignee && t.assignee !== e.assignee) op(id, 'assign', { task_id: id, updated_at: ts(id), assignee: e.assignee })
    // One new step per card: a second create would move the card again and cancel the first. Builder steps on --hold cards
    // wait for Meshach's go and are not created.
    const creates = e.step_actions.filter(x => x.op === 'create' && !(x.role === 'builder' && HOLD.has(id)))
    for (const a of e.step_actions.filter(x => x.op === 'create' && !creates.includes(x))) log.push(`${id}: held ${a.role} step for ${a.assignee}, waiting on Meshach's go`)
    for (const a of creates.slice(1)) log.push(`${id}: skipped a second ${a.role} create (one new step per card)`)
    for (const a of creates.slice(0, 1)) {
      const before = new Set(board.steps.map(s => s.step_id))
      const here = task(id).stage
      if (a.role === 'builder') {
        // Start works from Backlog or Build; a card in Architecture moves to Build, which opens the builder step.
        if (here === 'architecture') op(id, 'move_task', { task_id: id, stage: 'build', updated_at: ts(id) })
        else op(id, 'start_task', { task_id: id, updated_at: ts(id) })
      } else {
        // Every other role is a read-only look (the sheet's auditor checks): the board opens those as an architect step.
        // A card already in Architecture whose architect step ended or was cancelled gets a fresh one the way Meshach would:
        // back to Backlog, then into Architecture again.
        if (a.role !== 'architect') log.push(`${id}: ${a.role} step opened as an architect (read-only) step`)
        if (here === 'architecture') op(id, 'move_task', { task_id: id, stage: 'backlog', updated_at: ts(id) })
        op(id, 'move_task', { task_id: id, stage: 'architecture', updated_at: ts(id) })
      }
      for (const s of board.steps.filter(x => !before.has(x.step_id) && x.task_id === id)) {
        // The op picks the assignee by the board's rule; the sheet's pick wins, and the step's goal carries the instruction.
        s.assignee = a.assignee
        s.goal = `${s.goal}. ${a.instruction}`.slice(0, 600)
        log.push(`${id}: created ${s.step_id} ${s.role} for ${s.assignee}`)
      }
    }
    // Cancelling a dead step can leave a card blocked by the rollup. A card the cleanup blocked goes back to Backlog, parked
    // on purpose with its next action in the sheet. A card that was blocked before stays as it was.
    if (task(id).work_state === 'blocked' && !wasBlocked) op(id, 'move_task', { task_id: id, stage: 'backlog', updated_at: ts(id) })
    continue
  }

  // merge, close, archive
  const survivor = e.survivor ? task(e.survivor) : null
  const why = e.disposition === 'merge'
    ? `${STAMP}: merged into ${e.survivor} (${survivor?.title ?? 'unknown'}). ${e.reason}`
    : e.disposition === 'close' ? `${STAMP}: closed. ${e.reason}` : `${STAMP}: archived as a test or throwaway card. ${e.reason}`
  op(id, 'add_note', { task_id: id, body: why.slice(0, 2000), kind: 'comment' })
  if (survivor) op(e.survivor, 'add_note', { task_id: e.survivor, body: `${STAMP}: ${id} (${t.title}) was merged into this card. ${e.reason}`.slice(0, 2000), kind: 'comment' })
  // done_no_steps refuses while any step still holds the card (a failed or stalled one the sheet didn't list): cancel those too.
  for (const s of board.steps.filter(x => x.task_id === id && holdsCardOut(x))) op(id, 'cancel_step', { step_id: s.step_id, updated_at: s.updated_at })
  if (t.work_state !== 'done') op(id, 'done_no_steps', { task_id: id, updated_at: ts(id) })
  op(id, 'archive_task', { task_id: id, updated_at: ts(id) })
  if (wasArchived && !task(id).archived_at) { task(id).archived_at = new Date().toISOString(); log.push(`${id}: direct write, archived_at set again`) }
}

// Live steps left on Done cards (outside every sheet): cancel them. The op refuses an archived card, so those get a direct write.
const LIVE = ['awaiting_start', 'awaiting_pull', 'dispatched', 'needs_input']
for (const s of board.steps.filter(x => LIVE.includes(x.step_state) && !x.cancelled && task(x.task_id)?.work_state === 'done')) {
  if (task(s.task_id).archived_at) { s.cancelled = true; log.push(`${s.task_id}: direct write, cancelled stray live step ${s.step_id} on a Done, archived card`) }
  else op(s.task_id, 'cancel_step', { step_id: s.step_id, updated_at: s.updated_at })
}

writeFileSync(out, JSON.stringify({ tasks: board.tasks, steps: board.steps, notes: board.notes }, null, 2))
writeFileSync(`${out}.log`, log.join('\n') + '\n')
console.log(`${sheets.length} cards, ${log.length} actions, ${refused} refused. Wrote ${out} and ${out}.log`)
process.exit(refused ? 1 : 0)
