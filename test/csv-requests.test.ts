// The hand-off between the CSV import dialog and the board manager agent (csvRequests.ts). Every row here is invented.
// Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  const root = ${JSON.stringify(new URL('../', import.meta.url).href)}
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', root).href
  if (spec.startsWith('~~/')) spec = new URL('./' + spec.slice(3) + '.ts', root).href
  return next(spec, ctx)
}`))

const { createCsvRequest, getCsvRequest, pendingCsvRequests, answerCsvRequest, SAMPLE_ROWS } = await import('../server/utils/csvRequests.ts')

const jira = [['Summary', 'Epic Name', 'Fix Version/s'], ['Fix login', 'Auth', 'v2']]

test('a posted CSV is waiting for the agent with its headers and sample rows', async () => {
  const id = await createCsvRequest(jira)
  const waiting = (await pendingCsvRequests()).find(r => r.id === id)
  assert.deepEqual(waiting?.headers, jira[0])
  assert.deepEqual(waiting?.rows, [jira[1]])
})

test('only the first sample rows are kept, and an empty file makes no request', async () => {
  const big = [['Summary'], ...Array.from({ length: 100 }, (_, i) => [`row ${i}`])]
  const id = await createCsvRequest(big)
  assert.equal((await getCsvRequest(id))?.rows.length, SAMPLE_ROWS)
  assert.equal(await createCsvRequest([]), '')
})

test('the agent\'s answer reaches the dialog and the request stops waiting', async () => {
  const id = await createCsvRequest(jira)
  const proposal = { mapping: { title: 'Summary', project_id: 'Epic Name', tags: 'Fix Version/s' }, notes: 'Epic to Project' }
  assert.deepEqual(await answerCsvRequest(id, proposal), { ok: true })
  assert.deepEqual(JSON.parse((await getCsvRequest(id))?.proposal ?? 'null'), proposal)
  assert.ok(!(await pendingCsvRequests()).some(r => r.id === id))
})

test('an answer that is not a mapping, or for an unknown request, is refused', async () => {
  const id = await createCsvRequest(jira)
  assert.equal((await answerCsvRequest(id, { notes: 'no mapping' })).ok, false)
  assert.equal((await answerCsvRequest('csv-nope', { mapping: {} })).ok, false)
})
