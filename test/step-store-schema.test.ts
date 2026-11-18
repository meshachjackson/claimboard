// The step store's SQL uses exactly the column names in the schema's tables.json. Set TABLES_JSON to its path to run the check; without it the tests skip. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url).pathname
const tablesPath = process.env.TABLES_JSON && existsSync(process.env.TABLES_JSON) ? process.env.TABLES_JSON : undefined
const sql = readFileSync(`${root}server/db/step-store.sql`, 'utf8')

/** The column names inside the CREATE TABLE block for `table`. */
function sqlColumns(table: string): string[] {
  const block = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? ''
  return block.split('\n').map(l => /^ {2}([a-z_]+)\s+(text|integer|boolean|timestamptz|bigint)/.exec(l)?.[1]).filter(Boolean) as string[]
}

test('tables.json is reachable', { skip: !tablesPath }, () => assert.ok(tablesPath))

for (const table of ['gov_task_steps', 'gov_task_notes', 'board_events']) {
  test(`${table} has every column of tables.json by exact name`, { skip: !tablesPath }, () => {
    const spec = JSON.parse(readFileSync(tablesPath!, 'utf8')).tables[table].columns.map((c: string[]) => c[0])
    const have = sqlColumns(table)
    assert.deepEqual(spec.filter((c: string) => !have.includes(c)), [], `${table} is missing columns`)
    // Extras are allowed only where the plan says so: the event feed's seq.
    assert.deepEqual(have.filter(c => !spec.includes(c)), table === 'board_events' ? ['seq'] : [])
  })
}

test('ids come from sequences', () => {
  for (const seq of ['step_id_seq', 'note_id_seq', 'event_id_seq']) assert.match(sql, new RegExp(`CREATE SEQUENCE IF NOT EXISTS ${seq}`))
  assert.match(sql, /nextval\('step_id_seq'\)/)
})
test('notes and events are append-only', () => {
  assert.match(sql, /gov_task_notes_append_only BEFORE UPDATE OR DELETE/)
  assert.match(sql, /board_events_append_only BEFORE UPDATE OR DELETE/)
})
