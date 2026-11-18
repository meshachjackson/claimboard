// The hand-off between the CSV import dialog and the board manager agent. The dialog posts the file's headers
// and a few sample rows; the agent reads them, then posts a mapping (docs/csv-mapping-proposal.md); the dialog picks it up.
// Requests live in the shared Runtime Cache for an hour, so any function instance can answer. Only headers and the first
// SAMPLE_ROWS rows are kept, never the whole file. The user still approves every match in the dialog.
import { applyProposal } from '~~/app/utils/csvProposal'
import { cacheGet, cacheSet } from './runtimeCache.ts'

export const SAMPLE_ROWS = 25
const TTL_SECONDS = 60 * 60
const INDEX = 'csv-requests'

export interface CsvRequest { id: string, headers: string[], rows: string[][], proposal: string | null }

/** Strings only, capped: the body comes from the browser and is shown to an agent. */
function clean(table: unknown): string[][] {
  if (!Array.isArray(table)) return []
  return table.slice(0, SAMPLE_ROWS + 1).map(r => (Array.isArray(r) ? r : []).slice(0, 100).map(c => String(c ?? '').slice(0, 500)))
}

/** Stores a request from the first row (headers) and up to SAMPLE_ROWS rows after it. Returns its id, or '' for an empty file. */
export async function createCsvRequest(table: unknown): Promise<string> {
  const [headers = [], ...rows] = clean(table)
  if (!headers.length) return ''
  const id = `csv-${crypto.randomUUID().slice(0, 8)}`
  await cacheSet(id, { id, headers, rows, proposal: null } satisfies CsvRequest, TTL_SECONDS)
  const ids = (await cacheGet<string[]>(INDEX)) ?? []
  await cacheSet(INDEX, [...ids.slice(-19), id], TTL_SECONDS)
  return id
}

export const getCsvRequest = (id: string) => cacheGet<CsvRequest>(id)

/** Requests still waiting for a proposal. */
export async function pendingCsvRequests(): Promise<CsvRequest[]> {
  const found = await Promise.all(((await cacheGet<string[]>(INDEX)) ?? []).map(getCsvRequest))
  return found.filter((r): r is CsvRequest => !!r && !r.proposal)
}

/** Saves the agent's proposal. Refuses one that is not a mapping object; header mismatches are left for the dialog to show. */
export async function answerCsvRequest(id: string, proposal: unknown): Promise<{ ok: boolean, reason?: string }> {
  const request = await getCsvRequest(id)
  if (!request) return { ok: false, reason: 'unknown or expired request' }
  const text = JSON.stringify(proposal ?? null)
  const check = applyProposal(text, request.headers)
  if (check.problems.some(p => p.includes('"mapping"') || p.includes('valid JSON'))) return { ok: false, reason: check.problems.join('; ') }
  await cacheSet(id, { ...request, proposal: text }, TTL_SECONDS)
  return { ok: true }
}
