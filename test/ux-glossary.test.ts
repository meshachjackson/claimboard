// Keeps wording and docs in step: every on-screen label in app/types/board.ts has a row in docs/ux/glossary.md,
// and /help lists each work state and stage.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as B from '../app/types/board.ts'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

type Label = { code: string, label: string }

/** A table of `key: 'Label'`. */
const plain = (name: string): Label[] =>
  Object.entries((B as Record<string, any>)[name] as Record<string, string>).map(([k, v]) => ({ code: `${name}.${k}`, label: v }))
/** A table of `key: { label }`. */
const labeled = (name: string): Label[] =>
  Object.entries((B as Record<string, any>)[name] as Record<string, { label: string }>).map(([k, v]) => ({ code: `${name}.${k}`, label: v.label }))
const single = (name: string): Label => ({ code: name, label: (B as Record<string, any>)[name] as string })

/**
 * Rule: a label is a word the board prints that has a fixed value in app/types/board.ts. That means every `*_LABELS`
 * table, every table whose entries carry a `label` field, and the single `*_LABEL` constants.
 * Left out on purpose: help sentences (*_HELP, BOARD_QUIRKS, NO_RESPONSE_REASONS), hints (*_HINTS, *_HINT), SHORTCUTS,
 * and labels built from data (stepSummaryLabel, statusFoldLabel, chatStepsLabel, classMismatchLabel).
 */
function allLabels(): Label[] {
  return [
    ...['WORK_STATE_LABELS', 'STEP_STATE_LABELS', 'STAGE_LABELS', 'TASK_TYPE_LABELS', 'APPROVAL_LABELS', 'PRIORITY_LABELS',
      'TRIAGE_ACTION_LABELS', 'TRIAGE_RULE_LABELS', 'SORT_LABELS', 'OP_LABELS', 'TABLE_SORT_LABELS', 'BULK_LABELS',
      'BOARD_VIEW_LABELS', 'DENSITY_LABELS', 'LANE_LABELS', 'ROLE_LABELS', 'REQUEST_TYPE_LABELS', 'REFUSAL_LABELS'].flatMap(plain),
    ...['WORK_STATE_PILLS', 'NOTE_KIND_STYLES', 'MOVE_SIGNALS', 'REPORT_TOOL_LOOKS'].flatMap(labeled),
    // MOVE_SIGNALS also carries the button word `open`.
    ...Object.entries(B.MOVE_SIGNALS).map(([k, v]) => ({ code: `MOVE_SIGNALS.${k}.open`, label: v.open })),
    ...B.IMPORT_FIELDS.map(f => ({ code: `IMPORT_FIELDS.${f.field}`, label: f.label })),
    ...B.BOARD_PILLS.map(p => ({ code: `BOARD_PILLS.${p.value}`, label: p.label })),
    { code: 'OPEN_PILL', label: B.OPEN_PILL.label },
    { code: 'ATTENTION_DOT', label: B.ATTENTION_DOT.label },
    ...['LOCAL_FILE_LABEL', 'QUESTION_NOTE_LABEL', 'QUESTION_REPLY_LABEL', 'REGISTER_API_AGENT_LABEL', 'BUDGET_USED_LABEL',
      'AGENT_NOTE_LABEL', 'PLAN_LABEL'].map(single),
    ...plain('NAV_BADGE_WHAT')
  ]
}

/** Glossary rows as code name -> UI word. A row is `| UI word | `CODE` | where | meaning |`. */
function glossaryRows(): Map<string, string> {
  const rows = new Map<string, string>()
  for (const line of read('docs/ux/glossary.md').split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    const code = cells[1]?.match(/^`([^`]+)`$/)?.[1]
    if (code) rows.set(code, cells[0]!)
  }
  return rows
}

test('every label in app/types/board.ts has a glossary row with the same word', (t) => {
  const labels = allLabels()
  const rows = glossaryRows()
  const wrong: string[] = []
  for (const { code, label } of labels) {
    if (!rows.has(code)) wrong.push(`${code} ("${label}") has no row in docs/ux/glossary.md`)
    else if (rows.get(code) !== label) wrong.push(`${code} says "${rows.get(code)}" in the glossary but "${label}" in board.ts`)
  }
  t.diagnostic(`checked ${labels.length} labels against ${rows.size} glossary rows`)
  console.log(`ux-glossary: checked ${labels.length} labels`)
  assert.ok(labels.length > 100, 'the label list looks too short')
  assert.deepEqual(wrong, [])
})

test('the glossary has no row for a label that is gone', () => {
  const known = new Set(allLabels().map(l => l.code))
  const stale = [...glossaryRows().keys()].filter(code => !known.has(code))
  assert.deepEqual(stale, [], 'remove these rows from docs/ux/glossary.md')
})

/**
 * Work states that /help does not list yet. Remove an entry when /help covers it; the test fails if a listed gap is
 * already covered, so this array only shrinks.
 */
const KNOWN_HELP_GAPS: string[] = [
  // /help lists statuses from WORK_STATE_PILLS, and `backlog` has no pill (a Backlog card shows no status). The word
  // "Backlog" still appears on /help as a column, but the status itself is not explained under "What a card's status means".
  'backlog'
]

test('/help lists each work state and each stage', () => {
  const help = read('app/pages/help.vue')
  // /help builds both lists from the label tables, so the check is that it still reads them and what those tables hold.
  assert.match(help, /WORK_STATE_PILLS/, '/help should list statuses from WORK_STATE_PILLS')
  assert.match(help, /STAGES\.map\([^)]*STAGE_LABELS/, '/help should list columns from STAGES and STAGE_LABELS')
  const listed = new Set(Object.keys(B.WORK_STATE_PILLS))
  const missing = B.WORK_STATES.filter(s => !listed.has(s))
  assert.deepEqual(missing.sort(), [...KNOWN_HELP_GAPS].sort(), 'update KNOWN_HELP_GAPS (or /help) so they match')
  for (const s of B.STAGES) assert.ok(B.STAGE_LABELS[s], `stage ${s} has no label for /help`)
  for (const s of listed) assert.ok(B.WORK_STATE_HELP[s as keyof typeof B.WORK_STATE_HELP], `/help has no text for ${s}`)
})
