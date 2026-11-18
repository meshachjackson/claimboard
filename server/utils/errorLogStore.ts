// The board's error log: one place every board fault is written so the orchestrator (or the board manager) can read it back and
// answer "what just happened?" or file tickets for what is wrong. Pure and Db-based, no Nitro imports, so the server and
// `node --test` share it. Glue that picks the backend and wires the hooks is server/utils/errorLog.ts.
// Plan:.
import type { Db } from './pgStepStore.ts'

/** Where a fault came from. Free text on purpose, but these are the values the board writes today. */
export type ErrorSource = 'http' | 'mcp' | 'gateway' | 'rollup' | string

export interface ErrorInput {
  source: ErrorSource
  message: string
  /** The route that failed, without its query string. */
  path?: string
  status?: number | null
  task_id?: string
  step_id?: string
}

export interface ErrorRow {
  seq: number
  source: string
  message: string
  path: string
  status: number | null
  task_id: string
  step_id: string
  created_at: string
}

export interface ErrorQuery { since?: string, until?: string, limit?: number }

export interface ErrorLog {
  /** Never throws: a log that fails must not fail the request it is describing. */
  record: (e: ErrorInput) => Promise<void>
  /** Newest first. */
  list: (q: { since: string, until: string, limit: number }) => Promise<ErrorRow[]>
  /** Deletes rows older than ERROR_RETENTION_DAYS. Returns how many. */
  prune: () => Promise<number>
}

export const ERROR_RETENTION_DAYS = 30
const MESSAGE_CAP = 500
const PATH_CAP = 200
const MEMORY_CAP = 200
const DEFAULT_WINDOW_MS = 60 * 60_000
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500
const MAX_GROUPS = 30

/**
 * The table. Board-local like task_rollups: it is not in tables.json. It is created on first use (see createPgErrorLog),
 * so the cutover SQL needs no extra run, and it is repeated in server/db/step-store.sql for anyone who sets up a fresh
 * database by hand. test/error-log.test.ts checks the two copies match.
 */
export const ERRORS_DDL = `CREATE TABLE IF NOT EXISTS board_errors (
  seq         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      text NOT NULL,
  message     text NOT NULL,
  path        text NOT NULL DEFAULT '',
  status      integer,
  task_id     text NOT NULL DEFAULT '',
  step_id     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_errors_recent ON board_errors (created_at DESC);`

/**
 * Takes anything credential-shaped out of a string before it is stored: bearer and sealed (vc1.) tokens, connection
 * strings, URLs with a user:password, and long token-like runs. CLAUDE.md forbids secret values in logs, and error
 * messages from drivers and gateways sometimes echo the URL they failed on.
 */
export function scrub(text: string, cap = MESSAGE_CAP): string {
  return String(text ?? '')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [removed]')
    .replace(/\bvc1\.\S+/g, '[removed]')
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/\S+/gi, '[connection string removed]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@\S+/gi, '[url with credentials removed]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap)
}

/** The route without its query string (a query can carry a token), scrubbed and capped. */
export function cleanPath(path: string | undefined): string {
  return scrub(String(path ?? '').split('?')[0]!, PATH_CAP)
}

function cleaned(e: ErrorInput) {
  return {
    source: scrub(e.source, 40) || 'unknown',
    message: scrub(e.message) || 'unknown error',
    path: cleanPath(e.path),
    status: Number.isInteger(e.status) ? Number(e.status) : null,
    task_id: scrub(e.task_id ?? '', 40),
    step_id: scrub(e.step_id ?? '', 40)
  }
}

const iso = (v: unknown): string => new Date(v as string).toISOString()

function rowOf(r: Record<string, unknown>): ErrorRow {
  return {
    seq: Number(r.seq), source: String(r.source), message: String(r.message), path: String(r.path),
    status: r.status === null || r.status === undefined ? null : Number(r.status),
    task_id: String(r.task_id), step_id: String(r.step_id), created_at: iso(r.created_at)
  }
}

/** The log in Postgres (the step store's database). Creates its table once per process, the first time it is used. */
export function createPgErrorLog(db: Db): ErrorLog {
  let ready: Promise<unknown> | null = null
  const ensure = () => (ready ??= db.exec(ERRORS_DDL).catch((err) => { ready = null; throw err }))
  return {
    async record(e) {
      try {
        await ensure()
        const c = cleaned(e)
        await db.query('INSERT INTO board_errors (source, message, path, status, task_id, step_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [c.source, c.message, c.path, c.status, c.task_id, c.step_id])
      } catch (err) {
        // Only the scrubbed text of the failure goes to the console, and nothing here calls record again.
        console.error(`[error-log] could not record an error: ${scrub((err as Error)?.message)}`)
      }
    },
    async list({ since, until, limit }) {
      await ensure()
      const r = await db.query('SELECT * FROM board_errors WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz ORDER BY seq DESC LIMIT $3', [since, until, limit])
      return r.rows.map(rowOf)
    },
    async prune() {
      await ensure()
      const r = await db.query(`DELETE FROM board_errors WHERE created_at < now() - interval '${ERROR_RETENTION_DAYS} days'`)
      return r.rowCount
    }
  }
}

/**
 * The fallback when the step store is off (fixtures, the reference backend, local dev): a ring of the last 200 errors in
 * this process. On a host with several instances each keeps its own, which the read says so (see `store` in readErrors).
 */
export function createMemoryErrorLog(now: () => number = Date.now): ErrorLog {
  const rows: ErrorRow[] = []
  let seq = 0
  return {
    async record(e) {
      rows.push({ seq: ++seq, ...cleaned(e), created_at: new Date(now()).toISOString() })
      if (rows.length > MEMORY_CAP) rows.shift()
    },
    async list({ since, until, limit }) {
      return rows.filter(r => r.created_at >= since && r.created_at <= until).reverse().slice(0, limit)
    },
    async prune() {
      const cutoff = new Date(now() - ERROR_RETENTION_DAYS * 86_400_000).toISOString()
      const before = rows.length
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.created_at < cutoff) rows.splice(i, 1)
      return before - rows.length
    }
  }
}

/** One fault, counted: identical errors (same source, status and message once ids and numbers are ignored) fold together. */
export interface ErrorGroup {
  source: string
  status: number | null
  message: string
  count: number
  first_seen: string
  last_seen: string
  paths: string[]
  task_ids: string[]
}

/** The key two errors share when they are the same fault: numbers and board ids do not tell faults apart. */
const faultKey = (r: ErrorRow) => `${r.source}|${r.status ?? ''}|${r.message.replace(/\b(?:TSK|STP|NTE|EVT)-\d+\b/g, '#').replace(/\d+/g, '#')}`

/** Rows (newest first) folded into groups, most recently seen first. */
export function groupErrors(rows: readonly ErrorRow[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>()
  for (const r of rows) {
    const k = faultKey(r)
    const g = groups.get(k)
    if (!g) {
      groups.set(k, { source: r.source, status: r.status, message: r.message, count: 1, first_seen: r.created_at, last_seen: r.created_at, paths: r.path ? [r.path] : [], task_ids: r.task_id ? [r.task_id] : [] })
      continue
    }
    g.count++
    if (r.created_at < g.first_seen) g.first_seen = r.created_at
    if (r.created_at > g.last_seen) g.last_seen = r.created_at
    if (r.path && !g.paths.includes(r.path) && g.paths.length < 3) g.paths.push(r.path)
    if (r.task_id && !g.task_ids.includes(r.task_id) && g.task_ids.length < 5) g.task_ids.push(r.task_id)
  }
  return [...groups.values()].sort((a, b) => (a.last_seen < b.last_seen ? 1 : a.last_seen > b.last_seen ? -1 : 0))
}

/** The answer to board_errors and the manager's recent_errors. */
export interface ErrorReport {
  since: string
  until: string
  /** Rows in the window (up to the limit). */
  total: number
  /** True when the window held more rows than the limit, so older ones are not counted. */
  truncated: boolean
  groups: ErrorGroup[]
  /** Where the rows live. 'memory' means this server instance only. */
  store: 'postgres' | 'memory'
  note: string
}

function parseWhen(name: string, v: string | undefined, fallback: number): string {
  const text = String(v ?? '').trim()
  if (!text) return new Date(fallback).toISOString()
  const t = Date.parse(text)
  if (Number.isNaN(t)) throw new Error(`${name} must be an ISO timestamp such as 2026-11-07T08:00:00-06:00`)
  return new Date(t).toISOString()
}

/** Reads the log for a window (default: the last hour, up to 200 rows) and folds it into groups. Throws on a bad timestamp. */
export async function readErrorReport(log: ErrorLog, store: ErrorReport['store'], q: ErrorQuery, now: number = Date.now()): Promise<ErrorReport> {
  const until = parseWhen('until', q.until, now)
  const since = parseWhen('since', q.since, Date.parse(until) - DEFAULT_WINDOW_MS)
  if (since > until) throw new Error('since must be before until')
  const limit = Math.min(Math.max(Math.floor(Number(q.limit)) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const rows = await log.list({ since, until, limit })
  const groups = groupErrors(rows)
  const note = rows.length === 0
    ? 'No errors were logged in this window.'
    : `${groups.length} distinct fault${groups.length === 1 ? '' : 's'}. File one card per fault, not per occurrence.`
  return { since, until, total: rows.length, truncated: rows.length === limit, groups: groups.slice(0, MAX_GROUPS), store, note: store === 'memory' ? `${note} Errors are kept in this server's memory only (the step store is off), so other instances and restarts are not counted.` : note }
}
