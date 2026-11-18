// Checks the board manager agent's CSV mapping proposal. Its own file so server code can import it without pulling in the
// board store's types (boardCsv.ts imports them, and the server project has no browser globals).
import type { ImportField } from '~/types/board'
import { IMPORT_FIELDS } from '~/types/board'

/** For each card field, the index of the CSV column that fills it, or -1 for "not imported". */
export type Mapping = Record<ImportField, number>

export interface MappingProposal { mapping: Record<string, string | null>, notes?: string }

/**
 * Turns the agent's proposal (JSON text) into a Mapping for the file's headers. Nothing here is trusted: unknown fields,
 * headers that are not in the file, and a column named for two fields are dropped and listed in `problems`, and the user
 * still sees and can change every match before importing. Header names compare ignoring case and spacing.
 */
export function applyProposal(text: string, headers: string[]): { mapping: Mapping, notes: string, problems: string[] } {
  const mapping = Object.fromEntries(IMPORT_FIELDS.map(f => [f.field, -1])) as Mapping
  const problems: string[] = []
  let data: unknown
  try { data = JSON.parse(text) } catch { return { mapping, notes: '', problems: ['The suggestion is not valid JSON.'] } }
  const proposal = data as Partial<MappingProposal> | null
  if (!proposal || typeof proposal.mapping !== 'object' || !proposal.mapping) return { mapping, notes: '', problems: ['The suggestion has no "mapping" object.'] }
  const names = headers.map(h => h.trim().toLowerCase())
  const taken = new Set<number>()
  for (const [field, header] of Object.entries(proposal.mapping)) {
    if (!IMPORT_FIELDS.some(f => f.field === field)) { problems.push(`"${field}" is not a card field`); continue }
    if (header === null || header === '') continue // the agent chose "not imported"
    const i = typeof header === 'string' ? names.indexOf(header.trim().toLowerCase()) : -1
    if (i === -1) problems.push(`${field}: the file has no column "${header}"`)
    else if (taken.has(i)) problems.push(`${field}: column "${header}" is already used for another field`)
    else { mapping[field as ImportField] = i; taken.add(i) }
  }
  return { mapping, notes: typeof proposal.notes === 'string' ? proposal.notes : '', problems }
}
