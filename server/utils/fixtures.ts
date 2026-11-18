// Fixtures mode: mock/*.json in the gw.gov-board-read contract shape.
// Synthetic rows come first so the prototype's states stay visible at the top of each column.
// The rows live in memory for the life of the server, so REST and MCP writes in fixtures mode
// change them the way gw.gov-board-write would change the live tables. A restart resets them,
// unless NUXT_BOARD_FILE names a JSON file: then every good write is saved there and the next start
// loads it. To reset to the seed rows, stop the server and delete that file.
// The repo has no @types/node and takes no new dependencies, so TypeScript can't type these two Node imports.
// Nitro runs on Node, so they resolve at run time. Adding @types/node as a devDependency would let these comments go.
// @ts-ignore
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
// @ts-ignore
import { dirname } from 'node:path'
import type { BoardData } from '~~/app/types/board'

import synthTasks from '~~/mock/gov_tasks.synthetic.json'
import synthSteps from '~~/mock/gov_task_steps.synthetic.json'
import notes from '~~/mock/gov_task_notes.json'
import columns from '~~/mock/board_columns.json'
import registry from '~~/mock/gov_registry.json'

let state: BoardData | null = null

// The tables the board's writes change. The registry and the columns always come from mock/: the board never writes them.
const SAVED_KEYS = ['tasks', 'steps', 'notes'] as const

/** The seed rows from mock/, as a fresh copy. */
export function seedBoard(): BoardData {
  return JSON.parse(JSON.stringify({
    generated_at: new Date().toISOString(),
    tasks: synthTasks,
    steps: synthSteps,
    notes,
    columns,
    registry
  })) as BoardData
}

/** The seed rows with the saved tasks, steps and notes laid over them. A damaged file throws; it is never overwritten. */
function loadBoardFile(file: string): BoardData {
  const board = seedBoard()
  let saved: Record<string, unknown>
  try {
    saved = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return board // first run: the file appears on the first write
    throw new Error(`NUXT_BOARD_FILE ${file} is not readable JSON. Fix it or delete it to start from the seed rows.`)
  }
  for (const key of SAVED_KEYS) {
    if (!Array.isArray(saved[key])) throw new Error(`NUXT_BOARD_FILE ${file} has no "${key}" list. Fix it or delete it to start from the seed rows.`)
    ;(board[key] as unknown[]) = saved[key] as unknown[]
  }
  return board
}

/** The board's rows. `file` is NUXT_BOARD_FILE: empty keeps the rows in memory only; set, the first call loads it. */
export function fixtureBoard(file = ''): BoardData {
  if (!state) state = file ? loadBoardFile(file) : seedBoard()
  return { ...state, generated_at: new Date().toISOString() }
}

/** Saves the tasks, steps and notes to `file`; does nothing when `file` is empty. Writes a temp file first, so a crash never leaves half a file. */
export function saveFixtureBoard(file = ''): void {
  if (!file || !state) return
  const saved = Object.fromEntries(SAVED_KEYS.map(key => [key, state![key]]))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify(saved, null, 2))
  renameSync(`${file}.tmp`, file)
}

// Fixture tokens are "fixture:<agent_id>". They mean nothing outside fixtures mode, where the
// gateway resolves real tokens against board_tokens. They are not secrets.
export const FIXTURE_TOKEN_PREFIX = 'fixture:'
