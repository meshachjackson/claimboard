// Which adapter holds the board's rows (server/utils/store.ts). Pure, tested in test/backend-choice.test.ts.
// The default is the reference backend: one SQLite file, no other service. The n8n gateway is an optional adapter.

export type BackendName = 'reference' | 'n8n-gateway'

/** NUXT_BOARD_BACKEND to an adapter name. Unset or 'reference' is SQLite; 'n8n-gateway' is the gateway. A typo throws,
 * so a deployment never quietly serves an empty SQLite board in place of its real one. */
export function pickBackend(value: unknown): BackendName {
  const v = String(value ?? '').trim()
  if (v === '' || v === 'reference') return 'reference'
  if (v === 'n8n-gateway') return 'n8n-gateway'
  throw new Error(`NUXT_BOARD_BACKEND must be reference or n8n-gateway, not "${v}"`)
}
