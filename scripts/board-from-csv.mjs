#!/usr/bin/env node
// Turns Meshach's CSV export of the hosted tables into the board file that NUXT_BOARD_FILE points at.
// Node built-ins plus shared/csv.ts (the CSV reader the board's import uses too).
// Reads gov_tasks.csv, gov_task_steps.csv and gov_task_notes.csv from <csv-dir> and writes
// { tasks, steps, notes }, the same keys the board saves. Field names and types come from the registry schema.
// It prints counts and paths, never card text, and it never overwrites a file without --force.
// A duplicate key stops the run. --renumber-duplicates gives each later copy the next unused key instead (the local file only).
//
//   node scripts/board-from-csv.mjs <csv-dir> --schema <the registry repo/schema/tables.json> [--out .data/board.json] [--force] [--renumber-duplicates]
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
// Node 24 runs TypeScript directly, so the script shares the board's own CSV reader and type rules.
import { coerce, parseCsv } from '../shared/csv.ts'

const USAGE = 'usage: node scripts/board-from-csv.mjs <csv-dir> --schema <tables.json> [--out <file>] [--force] [--renumber-duplicates]'
// [key in the board file, table name, the table's key column]
const TABLES = [['tasks', 'gov_tasks', 'task_id'], ['steps', 'gov_task_steps', 'step_id'], ['notes', 'gov_task_notes', 'note_id']]

/** One line on stderr, then exit 1. `key` is the row's key value, or "header" for a missing column. */
function fail(table, key, column, reason) {
  console.error(`board-from-csv: ${table}: ${key} ${column}: ${reason}`)
  process.exit(1)
}

/** One cell as the schema's type (rules in shared/csv.ts). A bad cell stops the run with the table, key and column. */
function typed(value, type, table, key, column) {
  try { return coerce(value, type) } catch (err) { fail(table, key, column, err.message) }
}

/** One table's rows with the schema's columns only. n8n's own id, createdAt and updatedAt columns are dropped. */
function convertTable(table, keyColumn, schemaColumns, text, renumber) {
  const [header, ...data] = parseCsv(text)
  for (const [column] of schemaColumns) {
    if (!header.includes(column)) fail(table, 'header', column, 'missing from the CSV header')
  }
  const seen = new Set()
  const last = Math.max(...data.map(cells => Number(/\d+$/.exec(cells[header.indexOf(keyColumn)])?.[0] ?? 0)))
  let renumbered = 0
  return data.map((cells, n) => {
    if (cells.length !== header.length) fail(table, `row ${n + 1}`, 'cells', `has ${cells.length} cells, the header has ${header.length}`)
    const raw = Object.fromEntries(header.map((name, i) => [name, cells[i]]))
    let key = raw[keyColumn]
    if (seen.has(key)) {
      const parts = /^(.*?)(\d+)$/.exec(key)
      if (!renumber || !parts) fail(table, key, keyColumn, 'duplicate key')
      const fresh = parts[1] + String(last + ++renumbered).padStart(parts[2].length, '0')
      console.log(`board-from-csv: ${table}: ${key} renumbered to ${fresh}`)
      key = raw[keyColumn] = fresh
    }
    seen.add(key)
    return Object.fromEntries(schemaColumns.map(([column, type]) => [column, typed(raw[column], type, table, key, column)]))
  })
}

const args = process.argv.slice(2)
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const csvDir = args[0]
const schemaFile = option('--schema')
const outFile = option('--out') ?? '.data/board.json'
if (!csvDir || csvDir.startsWith('--') || !schemaFile) {
  console.error(USAGE)
  process.exit(2)
}
if (existsSync(outFile) && !args.includes('--force')) {
  console.error(`board-from-csv: ${outFile} already exists. Pass --force to replace it.`)
  process.exit(1)
}

const schema = JSON.parse(readFileSync(schemaFile, 'utf8')).tables
const board = {}
for (const [name, table, keyColumn] of TABLES) {
  let text
  try { text = readFileSync(join(csvDir, `${table}.csv`), 'utf8') } catch { fail(table, 'file', `${table}.csv`, 'cannot be read') }
  board[name] = convertTable(table, keyColumn, schema[table].columns, text, args.includes('--renumber-duplicates'))
}

// Temp file first, then rename, so a crash never leaves half a file.
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(`${outFile}.tmp`, JSON.stringify(board, null, 2))
renameSync(`${outFile}.tmp`, outFile)
console.log(`board-from-csv: wrote ${outFile}: ${TABLES.map(([name]) => `${name} ${board[name].length}`).join(', ')}`)
