// CSV import and export for the board. Pure functions, no network: the import dialog calls them to match
// columns, check rows and build the file, and the store's createTask does the writing. The CSV rules live in shared/csv.ts.
import type { CardView, TicketFields } from '~/stores/board'
import type { GovTask, ImportField } from '~/types/board'
import { EXPORT_COLUMNS, IMPORT_FIELDS, boardOwner, MAX_IMPORT_ROWS, PRIORITY_SYNONYMS } from '~/types/board'
import type { Mapping } from '~/utils/csvProposal'
import { normalizeTitle } from '~/utils/dupes'
import { coerce, toCsv } from '~~/shared/csv'

/**
 * One CSV data row, checked. `fields` holds only the non-blank values, ready for createTask or updateTask. `errors` is empty
 * when the row can be imported. A row whose Task ID cell names a card is an update of that card; any other row creates one.
 */
export interface ImportRow {
  line: number // the row's line number in the file, counting the header as line 1
  cells: string[]
  action: 'create' | 'update'
  taskId: string // the card an update row changes; '' on a create row
  duplicate: string // create rows only: the id of a card on the board with the same title (case and spacing folded), else ''
  fields: Partial<TicketFields>
  errors: string[]
}

/** What buildRows needs to know about the cards already on the board. GovTask fits; tests pass the four fields. */
export type ExistingCard = Pick<GovTask, 'task_id' | 'title' | 'work_state'> & { archived_at?: string | null }

/** update_task's fields (app/utils/boardOps.ts), plus assignee, which the store sends as a second op, assign. */
const UPDATE_FIELDS: readonly ImportField[] = ['title', 'acceptance_requirements', 'task_type', 'priority', 'project_id', 'tags', 'due_at', 'assignee']

const letters = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The first guess, from header names alone: a header that equals a field's name or alias fills that field, and each CSV column
 * fills at most one field. The board manager agent reads the whole export and proposes a better one (applyProposal, loaded in
 * CsvImport.vue); the user approves either before any card is created.
 */
export function suggestMapping(headers: string[]): Mapping {
  const mapping = Object.fromEntries(IMPORT_FIELDS.map(f => [f.field, -1])) as Mapping
  const taken = new Set<number>()
  const names = headers.map(letters)
  // Exact field names win over aliases, so a "task_type" column beats an "Issue Type" column.
  for (const exact of [true, false]) {
    for (const f of IMPORT_FIELDS) {
      if (mapping[f.field] !== -1) continue
      // Aliases are tried in the order listed, so "project" beats "epic" when a file has both.
      const wanted: readonly string[] = exact ? [letters(f.field)] : f.aliases
      const found = wanted.map(w => names.findIndex((name, i) => name === w && !taken.has(i))).find(i => i !== -1) ?? -1
      if (found !== -1) { mapping[f.field] = found; taken.add(found) }
    }
  }
  return mapping
}

/** What the board manager agent returns: card field -> the CSV header it fills, plus a few words on why (epics, milestones). */
/** Why the table cannot be imported at all, or ''. */
export function tableProblem(table: string[][]): string {
  if (table.length < 2) return 'The file has no data rows.'
  if (table.length - 1 > MAX_IMPORT_ROWS) return `The file has ${table.length - 1} rows. Import at most ${MAX_IMPORT_ROWS} at a time.`
  return ''
}

/** Tags are lowercase slugs (create_task refuses anything else). Fix the easy cases, as the ticket editor does. */
const toTags = (value: string) => value.split(/[,;]/).map(t => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean)

/**
 * Applies the mapping to every data row and checks each row against the same rules create_task and update_task enforce, so
 * the preview can show the errors before anything is written. `assignees` are the ids an assign will accept. `existing` are
 * the board's cards: a Task ID must name one of them, and a create row whose title matches a live card is marked a duplicate.
 * The gateway still has the last word.
 */
export function buildRows(table: string[][], mapping: Mapping, assignees: string[], existing: ExistingCard[] = []): ImportRow[] {
  const byId = new Map(existing.map(c => [c.task_id, c]))
  // Archived cards are off the board, so a new card with their title is not a duplicate.
  const byTitle = new Map<string, string>()
  for (const c of existing) if (!c.archived_at && !byTitle.has(normalizeTitle(c.title))) byTitle.set(normalizeTitle(c.title), c.task_id)

  return table.slice(1).map((cells, n) => {
    const get = (field: ImportField) => (mapping[field] === -1 ? '' : (cells[mapping[field]] ?? '').trim())
    const fields: Record<string, string> = {}
    const errors: string[] = []
    // Ids are stored upper case; a typed-in lower case id still finds the card.
    const taskId = get('task_id').toUpperCase()
    const action = taskId ? 'update' : 'create'
    for (const { field } of IMPORT_FIELDS) {
      if (field === 'task_id') continue
      // create-only fields (never edited after creation): a board export carries them, so they are dropped, not refused.
      if (action === 'update' && !UPDATE_FIELDS.includes(field)) continue
      let v = get(field)
      if (field === 'task_type' || field === 'approval_state') v = v.toLowerCase()
      if (field === 'priority') v = PRIORITY_SYNONYMS[v.toLowerCase()] ?? v.toLowerCase()
      if (field === 'tags') {
        const tags = toTags(v)
        const bad = tags.find(t => !/^[a-z0-9_-]+$/.test(t))
        if (bad) errors.push(`tag "${bad}" has characters other than letters, digits, - and _`)
        v = tags.join(',')
      }
      if (field === 'due_at') v = String(coerce(v, 'date') ?? '')
      if (v) fields[field] = v
    }
    // An update row keeps the card's title when the cell is blank; a create row needs one.
    if (!fields.title && action === 'create') errors.push('title is blank')
    else if (fields.title && fields.title.length > 200) errors.push('title is over 200 characters')
    if (fields.task_type && !['operational', 'build'].includes(fields.task_type)) errors.push(`task type "${fields.task_type}" is not operational or build`)
    if (fields.approval_state && !['not_required', 'pending'].includes(fields.approval_state)) errors.push(`approval "${fields.approval_state}" is not not_required or pending`)
    if (fields.due_at && Number.isNaN(Date.parse(fields.due_at))) errors.push(`due date "${fields.due_at}" is not a date`)
    if (fields.assignee && !assignees.includes(fields.assignee)) errors.push(`assignee "${fields.assignee}" is not an active agent or ${boardOwner()}`)

    let duplicate = ''
    if (action === 'update') {
      // The same refusals update_task gives (boardOps.ts), shown before the write instead of after.
      const card = byId.get(taskId)
      if (!card) errors.push(`no card ${taskId}`)
      else if (card.archived_at) errors.push(`${taskId} is archived`)
      else if (card.work_state === 'done') errors.push(`${taskId} is done`)
      else if (!Object.keys(fields).length) errors.push(`${taskId} has nothing to update`)
    } else if (fields.title) {
      duplicate = byTitle.get(normalizeTitle(fields.title)) ?? ''
    }
    return { line: n + 2, cells, action, taskId, duplicate, fields: fields as Partial<TicketFields>, errors }
  })
}

/** The cards as CSV text: one header row of EXPORT_COLUMNS, then one row per card, in the order given. */
export function cardsToCsv(cards: CardView[]): string {
  const rows = cards.map((c) => {
    const row: Record<string, string> = {
      ...Object.fromEntries(Object.entries(c.task).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])),
      stage: c.stage,
      work_state: c.workState
    }
    return EXPORT_COLUMNS.map(column => row[column] ?? '')
  })
  return toCsv([[...EXPORT_COLUMNS], ...rows])
}

// The agent's proposal (applyProposal) lives in csvProposal.ts so the server can check it without importing this file's store types.
