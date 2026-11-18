// withPresetViews (app/utils/rollup.ts): a view the gateway has no board_columns rows for keeps the bundled preset
// columns, so Flow is not blank when the gateway only knows Stages and States. Run with `pnpm test`.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(new URL('../', import.meta.url).href)}).href
  return next(spec, ctx)
}`))

let withPresetViews: typeof import('../app/utils/rollup.ts').withPresetViews
let presets: import('../app/types/board.ts').BoardColumn[]
before(async () => {
  ({ withPresetViews } = await import('../app/utils/rollup.ts'))
  presets = (await import('../mock/board_columns.json', { with: { type: 'json' } })).default as never
})

const viewOf = (rows: { view: string }[], view: string) => rows.filter(c => c.view === view)

test('a gateway with only stages and states rows still gets the five Flow columns', () => {
  const gateway = presets.filter(c => c.view !== 'flow')
  const out = withPresetViews(gateway, presets)
  assert.equal(viewOf(out, 'flow').length, 5)
  assert.equal(out.length, gateway.length + 5)
})

test('no gateway rows at all gives every preset', () => {
  assert.deepEqual(withPresetViews([], presets), presets)
})

test('a view the gateway sends is never mixed with the preset rows', () => {
  const edited = presets.map(c => (c.column_id === 'flow-running' ? { ...c, name: 'Working' } : c)).filter(c => c.column_id !== 'flow-done')
  const out = withPresetViews(edited, presets)
  assert.equal(viewOf(out, 'flow').length, 4)
  assert.equal(out.find(c => c.column_id === 'flow-running')?.name, 'Working')
})
