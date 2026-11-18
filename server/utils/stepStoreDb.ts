// Opens the Postgres connection for the step store and adapts it to the small `Db` shape (pgStepStore.ts).
// @neondatabase/serverless (approved by the owner 11/6/2026) is imported only here, and only when the flag is on.
import type { Db } from './pgStepStore'

type PgResult = { rows: Record<string, unknown>[], rowCount?: number | null }
type PgClient = { query: (sql: string, params?: unknown[]) => Promise<PgResult>, release?: () => void }
type PgPool = PgClient & { connect: () => Promise<PgClient> }

const adapt = (c: PgClient): Db => ({
  query: async (sql, params) => { const r = await c.query(sql, params); return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length } },
  exec: async sql => c.query(sql),
  // A transaction needs one connection for BEGIN..COMMIT; only the pool hands those out.
  transaction: async () => { throw new Error('transaction needs a pooled connection') }
})

/** The few driver settings we touch (the driver's own `neonConfig`). */
export type WsConfig = {
  wsProxy?: unknown, useSecureWebSocket?: boolean, pipelineTLS?: boolean, pipelineConnect?: unknown, webSocketConstructor?: unknown
}

/**
 * Point the Neon driver at a plain Postgres through a WebSocket proxy (NUXT_STEP_STORE_WS_URL, a wss:// URL whose path is the proxy's
 * secret). Empty `wsUrl` leaves the config alone, so Neon URLs work as before. Errors never repeat the URL: its path is a secret.
 */
export function applyWsProxy(config: WsConfig, wsUrl: string, ws: unknown = globalThis.WebSocket) {
  if (!wsUrl) return
  let u: URL
  try { u = new URL(wsUrl) } catch { throw new Error('NUXT_STEP_STORE_WS_URL is not a valid URL') }
  if (u.protocol !== 'wss:') throw new Error('NUXT_STEP_STORE_WS_URL must start with wss://')
  // The driver builds wss://<return value>, so hand back host plus the secret path; the proxy knows the one database it fronts.
  config.wsProxy = () => u.host + u.pathname
  config.useSecureWebSocket = true
  // A plain Postgres has no TLS handshake to pipeline and does not take the pipelined password message.
  config.pipelineTLS = false
  config.pipelineConnect = false
  // Node 24 has a global WebSocket; only fill the driver's slot if it has none.
  config.webSocketConstructor ??= ws
}

/** A Db over a pooled Postgres client. `url` is the connection string from NUXT_STEP_STORE_URL; it is never logged. */
export async function openStepDb(url: string, wsUrl = ''): Promise<Db> {
  if (!url) throw new Error('NUXT_STEP_STORE_URL is not set')
  const { Pool, neonConfig } = await import('@neondatabase/serverless') as unknown as {
    Pool: new (o: { connectionString: string }) => PgPool, neonConfig: WsConfig
  }
  applyWsProxy(neonConfig, wsUrl)
  const pool = new Pool({ connectionString: url })
  return {
    ...adapt(pool),
    transaction: async (work) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = await work(adapt(client))
        await client.query('COMMIT')
        return out
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release?.()
      }
    }
  }
}
