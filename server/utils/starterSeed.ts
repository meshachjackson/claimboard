// The rows a new reference install starts from: the board's column presets and nothing else. No cards, no agents,
// no people. mock/board_columns.json is the Stages and States presets, which hold no personal data.
import type { BoardData } from '~~/app/types/board'
import columns from '~~/mock/board_columns.json'

export function starterSeed(): BoardData {
  return {
    generated_at: new Date().toISOString(),
    tasks: [],
    steps: [],
    notes: [],
    columns: JSON.parse(JSON.stringify(columns)) as BoardData['columns'],
    registry: []
  }
}
