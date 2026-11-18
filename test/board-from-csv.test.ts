// scripts/board-from-csv.mjs: turns the CSV export of the hosted tables into the board file.
// Every row here is invented. The script runs as a child process, the way Meshach runs it. Run with `pnpm test`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = new URL('../scripts/board-from-csv.mjs', import.meta.url).pathname
let dir = ''
let schema = ''

// A small invented schema with the same shape as the registry repo/schema/tables.json: [column, type, note].
const SCHEMA = {
  tables: {
    gov_tasks: { columns: [['task_id', 'string', ''], ['title', 'string', ''], ['current_step', 'number', ''], ['due_at', 'date', '']] },
    gov_task_steps: { columns: [['step_id', 'string', ''], ['claim_count', 'number', ''], ['cancelled', 'boolean', ''], ['acked_at', 'date', '']] },
    gov_task_notes: { columns: [['note_id', 'string', ''], ['body', 'string', ''], ['created_at', 'date', '']] }
  }
}
// n8n adds id, createdAt and updatedAt to every export.
const TASKS = 'id,task_id,title,current_step,due_at,createdAt,updatedAt\n1,TSK-930001,First,2,,x,y\n2,TSK-930002,Second,,2026-10-01T10:00:00.000Z,x,y\n'
const STEPS = 'id,step_id,claim_count,cancelled,acked_at,createdAt,updatedAt\n1,STP-930001,3,true,,x,y\n2,STP-930002,,,2026-10-02T10:00:00.000Z,x,y\n'
const NOTES = 'id,note_id,body,created_at,createdAt,updatedAt\n1,NTE-930001,hello,2026-10-03T10:00:00.000Z,x,y\n'

/** Writes the three CSVs into a fresh folder under `dir` and returns its path. */
function exportDir(name: string, files: Record<string, string> = {}) {
  const path = join(dir, name)
  mkdirSync(path)
  const all = { gov_tasks: TASKS, gov_task_steps: STEPS, gov_task_notes: NOTES, ...files }
  for (const [table, text] of Object.entries(all)) writeFileSync(join(path, `${table}.csv`), text)
  return path
}

/** Runs the script with the invented schema unless `args` says otherwise. */
function run(args: string[], cwd = dir) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' })
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'board-from-csv-'))
  schema = join(dir, 'tables.json')
  writeFileSync(schema, JSON.stringify(SCHEMA))
})
after(() => rmSync(dir, { recursive: true, force: true }))

test('types: numbers, booleans and dates follow the schema, empty dates and numbers are null', () => {
  const out = join(dir, 'types.json')
  const res = run([exportDir('types'), '--schema', schema, '--out', out])
  assert.equal(res.status, 0, res.stderr)
  const board = JSON.parse(readFileSync(out, 'utf8'))
  assert.deepEqual(board.tasks, [
    { task_id: 'TSK-930001', title: 'First', current_step: 2, due_at: null },
    { task_id: 'TSK-930002', title: 'Second', current_step: null, due_at: '2026-10-01T10:00:00.000Z' }
  ])
  assert.deepEqual(board.steps, [
    { step_id: 'STP-930001', claim_count: 3, cancelled: true, acked_at: null },
    { step_id: 'STP-930002', claim_count: null, cancelled: false, acked_at: '2026-10-02T10:00:00.000Z' }
  ])
})

test('the file holds only tasks, steps and notes, and drops the n8n columns', () => {
  const out = join(dir, 'keys.json')
  assert.equal(run([exportDir('keys'), '--schema', schema, '--out', out]).status, 0)
  const text = readFileSync(out, 'utf8')
  assert.deepEqual(Object.keys(JSON.parse(text)), ['tasks', 'steps', 'notes'])
  assert.ok(!text.includes('createdAt') && !text.includes('updatedAt'))
})

test('the reader handles a BOM, CRLF, commas, doubled quotes and line breaks inside quotes', () => {
  const body = 'a, b "quoted"\nsecond line\r\nthird'
  const tasks = '﻿task_id,title,current_step,due_at\r\nTSK-930001,"' + body.replace(/"/g, '""') + '",1,\r\n'
  const out = join(dir, 'reader.json')
  assert.equal(run([exportDir('reader', { gov_tasks: tasks }), '--schema', schema, '--out', out]).status, 0)
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).tasks[0].title, body)
})

test('string and date values come through unchanged, with spaces and non-ASCII text', () => {
  const title = '  Café 日本語 – naïve  '
  const tasks = `id,task_id,title,current_step,due_at\n1,TSK-930001,"${title}",1,2026-10-09T01:02:03.004Z\n`
  const out = join(dir, 'strings.json')
  assert.equal(run([exportDir('strings', { gov_tasks: tasks }), '--schema', schema, '--out', out]).status, 0)
  const row = JSON.parse(readFileSync(out, 'utf8')).tasks[0]
  assert.equal(row.title, title)
  assert.equal(row.due_at, '2026-10-09T01:02:03.004Z')
})

test('bad input stops with exit 1 and names the table, the row key and the column', () => {
  const cases: [string, Record<string, string>, string[]][] = [
    ['bad number', { gov_tasks: 'task_id,title,current_step,due_at\nTSK-930009,T,abc,\n' }, ['gov_tasks', 'TSK-930009', 'current_step']],
    ['bad boolean', { gov_task_steps: 'step_id,claim_count,cancelled,acked_at\nSTP-930009,1,yes,\n' }, ['gov_task_steps', 'STP-930009', 'cancelled']],
    ['duplicate key', { gov_task_notes: 'note_id,body,created_at\nNTE-930009,a,\nNTE-930009,b,\n' }, ['gov_task_notes', 'NTE-930009', 'note_id']],
    ['missing header', { gov_tasks: 'task_id,title,due_at\nTSK-930009,T,\n' }, ['gov_tasks', 'header', 'current_step']]
  ]
  for (const [name, files, expected] of cases) {
    const out = join(dir, 'bad.json')
    const res = run([exportDir(`bad-${name.replace(' ', '-')}`, files), '--schema', schema, '--out', out])
    assert.equal(res.status, 1, name)
    for (const part of expected) assert.ok(res.stderr.includes(part), `${name}: stderr lacks ${part}: ${res.stderr}`)
    assert.ok(!existsSync(out), `${name}: wrote a file anyway`)
  }
})

test('an existing output file is never replaced without --force', () => {
  const csv = exportDir('overwrite')
  const out = join(dir, 'overwrite.json')
  writeFileSync(out, 'keep me')
  const refused = run([csv, '--schema', schema, '--out', out])
  assert.equal(refused.status, 1)
  assert.equal(readFileSync(out, 'utf8'), 'keep me')
  assert.equal(run([csv, '--schema', schema, '--out', out, '--force']).status, 0)
  assert.ok(JSON.parse(readFileSync(out, 'utf8')).tasks.length > 0)
})

test('with no --out the file lands at .data/board.json in the working directory', () => {
  const cwd = mkdtempSync(join(dir, 'cwd-'))
  const res = run([exportDir('default-out'), '--schema', schema], cwd)
  assert.equal(res.status, 0, res.stderr)
  assert.ok(existsSync(join(cwd, '.data', 'board.json')))
})

test('with no --schema the script prints the usage and exits 2', () => {
  const res = run([exportDir('no-schema')])
  assert.equal(res.status, 2)
  assert.ok(res.stderr.includes('usage'))
})

test('the counts it prints hold no card text', () => {
  const res = run([exportDir('counts'), '--schema', schema, '--out', join(dir, 'counts.json')])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /tasks 2, steps 2, notes 1/)
  assert.ok(!res.stdout.includes('First') && !res.stdout.includes('hello'))
})

test('--renumber-duplicates gives the later copy the next free key and says so', () => {
  const steps = 'step_id,claim_count,cancelled,acked_at\nSTP-930001,1,false,\nSTP-930007,2,true,\nSTP-930001,3,true,\n'
  const csv = exportDir('renumber', { gov_task_steps: steps })
  const out = join(dir, 'renumber.json')
  const res = run([csv, '--schema', schema, '--out', out, '--renumber-duplicates'])
  assert.equal(res.status, 0, res.stderr)
  assert.equal(res.stdout.match(/renumbered to/g)?.length, 1)
  assert.ok(res.stdout.includes('STP-930001 renumbered to STP-930008'))
  const ids = JSON.parse(readFileSync(out, 'utf8')).steps.map((row: { step_id: string }) => row.step_id)
  assert.deepEqual(ids, ['STP-930001', 'STP-930007', 'STP-930008'])
})

test('an empty string cell stays "" and no date or number is ever ""', () => {
  const tasks = 'task_id,title,current_step,due_at\nTSK-930001,,,\n'
  const steps = 'step_id,claim_count,cancelled,acked_at\nSTP-930001,,,\n'
  const notes = 'note_id,body,created_at\nNTE-930001,,\n'
  const out = join(dir, 'empty.json')
  const res = run([exportDir('empty', { gov_tasks: tasks, gov_task_steps: steps, gov_task_notes: notes }), '--schema', schema, '--out', out])
  assert.equal(res.status, 0, res.stderr)
  const board = JSON.parse(readFileSync(out, 'utf8'))
  assert.equal(board.tasks[0].title, '')
  assert.equal(board.notes[0].body, '')
  assert.deepEqual([board.tasks[0].current_step, board.tasks[0].due_at, board.steps[0].acked_at, board.notes[0].created_at], [null, null, null, null])
  assert.equal(board.steps[0].cancelled, false)
})
