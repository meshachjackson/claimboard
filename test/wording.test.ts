// Keeps the board's words in step with docs/ux/glossary.md. It scans the user-facing source and fails when a
// retired word comes back: one name for the work item (card), one word per state, plain words for agent jargon.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as B from '../app/types/board.ts'

const root = new URL('..', import.meta.url).pathname

/** Every file under `dir` whose name ends in one of `exts`. */
function walk(dir: string, exts: string[], deep: boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name)
    if (statSync(join(root, rel)).isDirectory()) { if (deep) out.push(...walk(rel, exts, deep)) } else if (exts.some(e => name.endsWith(e))) out.push(rel)
  }
  return out
}

// The changelog describes old behavior in the words of its day, so it is not scanned.
const files = [
  ...walk('app', ['.vue', '.ts'], true),
  ...walk('shared', ['.ts'], false)
].filter(f => f !== join('app', 'utils', 'changelog.ts'))

/** Retired words. A word boundary keeps API names such as list_claimable and claimableSteps out of the match. */
const BANNED: { name: string, re: RegExp }[] = [
  { name: 'New ticket', re: /New ticket/ },
  { name: 'Ticket panel', re: /Ticket panel/ },
  { name: 'Tickets', re: /\bTickets\b/ },
  { name: 'prose ticket', re: /\b(a|the|this|that|your|open|new|next|previous|each|every|no|any|an|of|per) tickets?\b/i },
  { name: 'Your move', re: /Your move/i },
  { name: 'Logged', re: /\bLogged\b/ },
  { name: 'Awaiting pull', re: /Awaiting pull/i },
  { name: 'Served', re: /\bServed\b/ },
  { name: 'claimable', re: /\bclaimable\b/i },
  { name: 'Needs attention', re: /Needs attention/ },
  { name: 'Run it', re: /\bRun it\b/ },
  { name: 'Roadmap', re: /Roadmap/ },
  { name: 'Plan and sketch', re: /Plan and sketch/ },
  // "task" for the work item, in a sentence: "Search tasks", "Show 3 tasks", "unknown task X".
  { name: 'prose task', re: /\b(a|an|the|this|that|your|these|no|unknown|Unknown|Search|Show|\d+|\}) tasks?\b|\btasks? (needs|ID)\b/ }
]

/**
 * Code-only uses that stay. Each says why. `file` is a path suffix, `text` is the exact phrase on that line.
 * Keep this short: a use that a person can see belongs in the new words, not here.
 */
const ALLOWED: { file: string, text: string, reason: string }[] = [
  { file: 'app/utils/boardOps.ts', text: 'is not claimable', reason: 'refusal text for agents on the claim_step op, not shown on screen' },
  { file: 'app/types/board.ts', text: "'Logged + archived':", reason: 'DATA_TEXT_OVERRIDES key: the old data string the app replaces' },
  { file: 'app/types/board.ts', text: "'Logged':", reason: 'DATA_TEXT_OVERRIDES key: the old data string the app replaces' },
  { file: 'app/types/board.ts', text: "'Claimable by builder agents':", reason: 'DATA_TEXT_OVERRIDES key: the old data string the app replaces' }
]

/** A line that is only a comment. The named-phrase rules scan comments too (stale ones mislead); the prose rules skip them. */
const isComment = (l: string) => /^\s*(\/\/|\*|\/\*|<!--)/.test(l)

/** Every banned hit as `file:line name`. */
function hits(): string[] {
  const found: string[] = []
  for (const f of files) {
    const lines = readFileSync(join(root, f), 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (ALLOWED.some(a => f.endsWith(a.file) && line.includes(a.text))) return
      // Skip an HTML or script comment tail so the task rule does not read code remarks as screen text.
      const code = line.replace(/ \/\/ .*$/, '')
      for (const b of BANNED) {
        // The prose rules read screen text only: code comments may still say ticket or task.
        const prose = b.name.startsWith('prose')
        if (prose && (isComment(line) || /task_id|\.task\b/.test(code))) continue
        if (b.re.test(prose ? code : line)) found.push(`${relative(root, join(root, f))}:${i + 1} ${b.name}: ${line.trim().slice(0, 100)}`)
      }
    })
  }
  return found
}

test('no retired word appears in user-facing source', () => {
  assert.deepEqual(hits(), [])
})

test('the scan reads real files and every allowed use still exists', () => {
  assert.ok(files.length > 100, `only ${files.length} files scanned`)
  for (const a of ALLOWED) {
    const src = readFileSync(join(root, a.file), 'utf8')
    assert.ok(src.includes(a.text), `ALLOWED entry is stale: ${a.file} no longer has "${a.text}"`)
  }
})

test('the banned patterns catch the words they name', () => {
  for (const sample of ['New ticket', 'Ticket panel', 'Tickets', 'Your move', 'Logged 10/25/2026', 'Awaiting pull', 'Served', 'Open · claimable', 'Needs attention', 'Run it', 'Roadmap', 'Plan and sketch', 'Search tasks', 'Show 3 tasks', 'Open the ticket']) {
    assert.ok(BANNED.some(b => b.re.test(sample)), `no banned pattern matches "${sample}"`)
  }
  for (const fine of ['list_claimable', 'claimableSteps', 'task_id', 'Create and start', 'Waiting for an agent', 'New card']) {
    assert.ok(!BANNED.some(b => !b.name.startsWith('prose task') && b.re.test(fine)), `a banned pattern wrongly matches "${fine}"`)
  }
})

test('state labels use the agreed words', () => {
  assert.equal(B.WORK_STATE_LABELS.verifying, 'Ready for review')
  assert.equal(B.WORK_STATE_PILLS.verifying.label, 'Ready for review')
  assert.equal(B.WORK_STATE_LABELS.done, 'Done')
  assert.equal(B.WORK_STATE_PILLS.done.label, 'Done')
  assert.equal(B.STEP_STATE_LABELS.awaiting_pull, 'Waiting for an agent')
  assert.equal(B.STEP_STATE_LABELS.served, 'Done, checking')
  assert.equal(B.OPEN_PILL.label, 'Open to any agent')
})

test('the orchestrator panel names its voice and each reply carries its speaker', () => {
  assert.equal(B.VOICES.orchestrator.role, 'Orchestrator: answers and routes')
  assert.equal(B.VOICES.manager.role, 'Board manager: edits cards in bulk')
  const read = (p: string) => readFileSync(join(root, p), 'utf8')
  // The header shows the active voice's name and role line.
  assert.match(read('app/components/ManagerChat.vue'), /voice\.role/)
  assert.match(read('app/components/ManagerChat.vue'), /VOICES\.manager\.name/)
  // The orchestrator's thread prints the speaker on every reply.
  assert.match(read('app/components/OrchestratorThread.vue'), /orchestratorName\(\)/)
})

test('board data that still carries a retired word is shown in the app\'s own words', () => {
  // The live n8n tables are not ours to edit, so these exact strings are replaced on screen (plainData in board.ts).
  assert.equal(B.plainData('Logged + archived'), 'Done, then archived')
  assert.equal(B.plainData('Claimable by builder agents'), 'Open to any builder agent')
  assert.equal(B.plainData('Needs input'), 'Needs input', 'text with no override passes through')
  for (const [from, to] of Object.entries(B.DATA_TEXT_OVERRIDES)) {
    assert.ok(!BANNED.some(b => !b.name.startsWith('prose') && b.re.test(to)), `the override for "${from}" uses a retired word`)
  }
  // The shipped fixtures already use the new words.
  for (const f of ['mock/board_columns.json', 'mock/gov_task_steps.synthetic.json']) {
    assert.ok(!/Logged|Claimable/.test(readFileSync(join(root, f), 'utf8')), `${f} still has a retired word`)
  }
})

/**
 * Documented exceptions: retired words that stay on purpose because the text is not the app's to change.
 * They are not scanned (they live outside app/ and shared/ or in registry data); this list is the record.
 */
export const DATA_EXCEPTIONS = [
  { where: 'registry agent descriptions (gov_registry, mock/gov_registry.json)', words: 'ticket, tasks', reason: 'registry data is read-only here; it changes only through form.gov-* with the owner\'s approval' },
  { where: 'server/utils/agentOps.ts (tool text for agents)', words: 'ticket', reason: 'agent contract text and argument names (target_ticket_ref); renaming would change what agents are told' },
  { where: 'server/utils/door.ts (ticket_id argument)', words: 'ticket_id', reason: 'field name in the door agents\' contract, not on-screen text' }
]
