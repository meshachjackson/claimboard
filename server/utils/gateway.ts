// The only way this app reaches n8n (CLAUDE.md): reads through gw.gov-board-read, writes through
// gw.gov-board-write. Never log a header value, a token, a note body or row
// payloads: errors carry a status and a short reason.
// Every gateway call is one n8n execution, so good reads are cached (cacheMs: 5 minutes, 30 with the Postgres step store) and shared by every
// request and every function instance (the cache is runtimeCache.ts),
// and writes merge their rows into that cache.
import type { BoardData, BoardSource, Brief, RegistryAgent, WriteResult, WriteRows } from '~~/app/types/board'
import { ASK_OPS, boardOwner, PROPOSED_OPS } from '~~/app/types/board'
import { mergeRows, runOp } from '~~/app/utils/boardOps'
import { cleanBrief } from './brief.ts'
import { askFields } from './door.ts'

const ARRAY_KEYS = ['tasks', 'steps', 'notes', 'columns', 'registry'] as const
// How long a board read is reused. A write that succeeds merges its rows into the snapshot, and a stale refusal drops it,
// so the board's own writes show at once. Changes made inside n8n (the orchestrator, the forms) can take up to this long to show;
// Refresh skips the cache.
// Five minutes normally. Thirty with NUXT_STEP_STORE=postgres: the dispatcher reads the board every few seconds, so the
// snapshot expires on schedule all day, and each expiry is one billable n8n run (about 288 a day at 5 minutes, about 48 at
// 30). With Postgres holding the steps, only the cards still come from n8n, so a long window costs little freshness.
const CACHE_MS = 5 * 60_000
const CACHE_MS_STEP_STORE = 30 * 60_000
// Read from the config on every call (not frozen at load), so the flag decides the window at the moment it is used.
const cacheMs = (): number => useRuntimeConfig().stepStore === 'postgres' ? CACHE_MS_STEP_STORE : CACHE_MS

// The gov_registry fields the contract allows. Anything else the gateway sends is dropped.
const REGISTRY_FIELDS: (keyof RegistryAgent)[] = [
  'agent_id', 'name', 'description', 'owner', 'domain', 'lifecycle_status', 'runtime', 'agent_type',
  'type_version', 'host', 'inference', 'reachability', 'request_types', 'status_interface',
  'deploy_ref', 'classes', // The lane and the class rows; null until gw.gov-board-read sends them
  'switch', // The owner's switch from gov_config board.switch; not a gov_registry column
  'wakes' // true when gov_config board.wake names a workflow for the agent; not a gov_registry column
]

function fail(reason: string, workflow = 'gw.gov-board-read'): never {
  console.error(`[gateway] ${workflow}: ${reason}`)
  throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', data: { error: reason } })
}

/** Throws unless the body has every top-level key of the contract. */
function validate(body: unknown): BoardData {
  if (!body || typeof body !== 'object') fail('response is not a JSON object')
  const data = body as Record<string, unknown>
  if (typeof data.generated_at !== 'string') fail('missing generated_at')
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(data[key])) fail(`missing ${key}`)
  }
  return data as unknown as BoardData
}

function pickRegistry(row: RegistryAgent): RegistryAgent {
  return Object.fromEntries(REGISTRY_FIELDS.map(f => [f, row[f] ?? null])) as unknown as RegistryAgent
}

/** An explicit NUXT_BOARD_SOURCE wins; otherwise the gateway when its read URL is set. */
export function boardSource(): BoardSource {
  const { boardSource, boardReadUrl } = useRuntimeConfig()
  if (boardSource === 'gateway' || boardSource === 'fixtures') return boardSource
  return boardReadUrl ? 'gateway' : 'fixtures'
}

/** NUXT_BOARD_FILE: where fixtures mode saves its rows. Empty (the default) keeps them in memory only. */
function boardFile(): string {
  return String(useRuntimeConfig().boardFile ?? '')
}

/** True when fixtures mode is saving its rows to NUXT_BOARD_FILE. The page then sends edits to the server and shows its rows. */
export function boardSaved(): boolean {
  return boardSource() === 'fixtures' && boardFile() !== ''
}

/** Writes work in fixtures mode, and in gateway mode once NUXT_BOARD_WRITE_URL is set. */
export function boardWritable(): boolean {
  return boardSource() === 'fixtures' || !!useRuntimeConfig().boardWriteUrl
}

/** Proposed ops that work here: all of them in fixtures mode, the ones NUXT_BOARD_LIVE_OPS names in gateway mode. */
export function liveOps(): string[] {
  if (boardSource() === 'fixtures') return [...PROPOSED_OPS]
  const named = String(useRuntimeConfig().boardLiveOps ?? '').split(',').map(s => s.trim())
  return PROPOSED_OPS.filter(op => named.includes(op))
}

/** True when a board read would be served from the cache, with no execution (fixtures need none). */
export async function boardCacheFresh(): Promise<boolean> {
  return boardSource() === 'fixtures' || !!await readSnapshot()
}

/** The board's rows from whichever source is active. `fresh` skips the snapshot (the owner's Refresh button). */
export function boardData(fresh = false): Promise<BoardData> | BoardData {
  return boardSource() === 'gateway' ? boardRead(fresh) : fixtureBoard(boardFile())
}

/** The snapshot's rows while they are fresh, else null. Never calls the gateway; null in fixtures mode. */
export async function cachedBoard(): Promise<BoardData | null> {
  if (boardSource() !== 'gateway') return null
  return (await readSnapshot())?.data ?? null
}

// The snapshot lives in the shared Runtime Cache (runtimeCache.ts), so every function instance sees the same
// rows and a write patches the one copy. `at` is when the gateway was read; it is kept when a write merges
// rows in, so writes never lengthen the snapshot's life.
type Snapshot = { at: number, data: BoardData }
const SNAPSHOT_KEY = 'board-snapshot'
const MAX_SNAPSHOT_BYTES = 1_800_000 // a Runtime Cache item holds 2 MB

// Only used when a snapshot is too big to share: this instance then keeps its own copy (the old behavior),
// so the board costs one gateway run a minute rather than one per request.
let oversized: Snapshot | null = null
let inFlight: Promise<BoardData> | null = null

/** The snapshot while it is younger than the cache window (cacheMs), else null. */
async function readSnapshot(): Promise<Snapshot | null> {
  const snap = oversized ?? await cacheGet<Snapshot>(SNAPSHOT_KEY)
  if (!snap || typeof snap.at !== 'number' || !Array.isArray(snap.data?.tasks)) return null
  return Date.now() - snap.at < cacheMs() ? snap : null
}

async function writeSnapshot(snap: Snapshot): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(snap)).length
  if (bytes > MAX_SNAPSHOT_BYTES) {
    console.warn(`[gateway] board snapshot is ${bytes} bytes, over the Runtime Cache limit: kept per instance`)
    oversized = snap
    return
  }
  oversized = null
  await cacheSet(SNAPSHOT_KEY, snap, (snap.at + cacheMs() - Date.now()) / 1000)
}

async function dropSnapshot(): Promise<void> {
  oversized = null
  await cacheDelete(SNAPSHOT_KEY)
}

/**
 * Puts a write's rows into the snapshot, so the next read needs no execution. Two writes landing on different
 * instances in the same instant can lose one merge; the snapshot expires within the cache window and a stale
 * refusal drops it sooner.
 */
async function mergeIntoSnapshot(rows: WriteRows): Promise<void> {
  const snap = await readSnapshot()
  if (!snap) return
  mergeRows(snap.data, rows)
  await writeSnapshot(snap)
}

// Several instances can meet an expired snapshot in the same moment (a burst of agent calls just after the
// minute is up), and each would spend a gateway run. Runtime Cache has no atomic "set if absent", so they elect
// one fetcher: a contender writes its own id to the lock, waits ELECTION_MS for the other writes to land,
// and reads the lock back. The last writer leads and fetches; the rest poll for its snapshot.
// Nothing here can hold a read longer than FOLLOW_MS: a follower whose leader died or failed fetches for itself.
// The worst case is today's behavior, one gateway run per instance.
const LOCK_KEY = 'board-fetching'
const LOCK_SECONDS = 12 // the 10 second gateway timeout plus the snapshot write; a dead leader's lock then clears fast
const ELECTION_MS = 150
const FOLLOW_MS = 6_000
const POLL_MS = 250
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function fetchAndStore(): Promise<BoardData> {
  const data = await fetchBoard()
  await writeSnapshot({ at: Date.now(), data })
  return data
}

/** A snapshot miss: one instance fetches while the others wait for its snapshot. */
async function coldRead(): Promise<BoardData> {
  const me = crypto.randomUUID()
  let leader = false
  if (!await cacheGet(LOCK_KEY)) {
    await cacheSet(LOCK_KEY, { owner: me }, LOCK_SECONDS)
    await sleep(ELECTION_MS)
    leader = (await cacheGet<{ owner: string }>(LOCK_KEY))?.owner === me
  }
  if (leader) {
    try {
      // A leader before us may have finished while we were electing.
      const fresh = await readSnapshot()
      return fresh ? fresh.data : await fetchAndStore()
    } finally {
      await cacheDelete(LOCK_KEY)
    }
  }
  const deadline = Date.now() + FOLLOW_MS
  while (Date.now() < deadline) {
    await sleep(POLL_MS)
    const snap = await readSnapshot()
    if (snap) return snap.data
    if (!await cacheGet(LOCK_KEY)) break // the leader finished without a snapshot, or failed
  }
  return fetchAndStore()
}

/**
 * The contract shape, from the shared snapshot while it is inside the cache window. Concurrent callers on one instance share
 * one fetch. `fresh` skips the snapshot and the election and fetches now: one gateway run per Refresh click.
 */
export async function boardRead(fresh = false): Promise<BoardData> {
  if (!fresh) {
    const snap = await readSnapshot()
    if (snap) return snap.data
  }
  if (!inFlight) inFlight = (fresh ? fetchAndStore() : coldRead()).finally(() => { inFlight = null })
  return inFlight
}

/** GET gw.gov-board-read with the header credential and return the contract shape. */
async function fetchBoard(): Promise<BoardData> {
  const { boardReadUrl, boardHeaderName, boardHeaderValue } = useRuntimeConfig()
  if (!boardReadUrl) fail('NUXT_BOARD_READ_URL is not set')
  if (!boardHeaderName || !boardHeaderValue) fail('the header credential env vars are not set')

  let body: unknown
  try {
    body = await $fetch(boardReadUrl, {
      method: 'GET',
      headers: { [boardHeaderName]: boardHeaderValue },
      timeout: 10_000,
      retry: 0
    })
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    // The gateway answers 403 for a missing or wrong header.
    if (status === 403) fail('header credential refused (HTTP 403)')
    fail(status ? `HTTP ${status}` : 'no response')
  }

  const data = validate(body)
  // One line per real call (cache misses only) so the n8n execution budget can be counted
  // from the server log. The workflow doesn't save successful executions.
  console.info(`[gateway] gw.gov-board-read fetched: ${data.tasks.length} tasks`)
  return { ...data, registry: data.registry.map(pickRegistry) }
}

// ---------- Writes ----------

/** The owner (the board server has checked his GitHub login) or an agent's bearer token, passed through. */
export type WriteCaller = { person: string } | { token: string }

const WRITE_MAX_BYTES = 16 * 1024 // the gateway refuses larger bodies
const ASK_TIMEOUT_MS = 145_000 // just over the gateway's longest ask wait (140 s); /mcp's maxDuration is above it (nuxt.config.ts)

/**
 * One op through gw.gov-board-write, or through the fixture stand-in in fixtures mode.
 * The rows in a good answer go into the read cache, so the next read needs no execution.
 */
export async function boardWrite(op: string, args: Record<string, unknown>, caller: WriteCaller): Promise<WriteResult> {
  // A proposed op the gateway doesn't have yet is refused here, so it never costs an execution.
  if ((PROPOSED_OPS as readonly string[]).includes(op) && !liveOps().includes(op)) return { ok: false, op, reason: 'op not live' }
  const result = boardSource() === 'fixtures' ? fixtureWrite(op, args, caller) : await postWrite(op, args, caller)
  if (result.ok) {
    // Fixtures mode keeps its rows in memory (fixtures.ts) and has no snapshot.
    // It saves them to NUXT_BOARD_FILE when that is set; gateway mode never touches the file.
    if (boardSource() === 'fixtures') saveFixtureBoard(boardFile())
    else await mergeIntoSnapshot(result.rows)
  } else if (result.reason === 'stale') {
    // The caller re-reads after a stale refusal, so the next read must reach the gateway.
    await dropSnapshot()
  }
  // Op and outcome only: never the args (they can hold a note body) or the caller.
  console.info(`[gateway] gw.gov-board-write ${op}: ${result.ok ? 'ok' : `refused (${result.reason.slice(0, 80)})`}`)
  return result
}

/** Fixtures mode: resolve the caller like the gateway would, then apply the op to the in-memory rows. */
function fixtureWrite(op: string, args: Record<string, unknown>, caller: WriteCaller): WriteResult {
  const board = fixtureBoard(boardFile())
  if ('person' in caller) return runOp(board, op, args, { person: boardOwner() })
  const agentId = caller.token.startsWith(FIXTURE_TOKEN_PREFIX) ? caller.token.slice(FIXTURE_TOKEN_PREFIX.length) : ''
  if (!board.registry.some(a => a.agent_id === agentId)) return { ok: false, op, reason: 'unknown token' }
  return runOp(board, op, args, { agent_id: agentId })
}

/** POST { op, caller_token? | as_person?, args } with the write header credential. */
async function postWrite(op: string, args: Record<string, unknown>, caller: WriteCaller): Promise<WriteResult> {
  const workflow = 'gw.gov-board-write'
  const { boardWriteUrl, boardWriteHeaderName, boardWriteHeaderValue } = useRuntimeConfig()
  if (!boardWriteUrl) fail('NUXT_BOARD_WRITE_URL is not set', workflow)
  if (!boardWriteHeaderName || !boardWriteHeaderValue) fail('the write header credential env vars are not set', workflow)

  // as_person only without a token, and only the board owner.
  const body = 'person' in caller ? { op, as_person: boardOwner(), args } : { op, caller_token: caller.token, args }
  if (new TextEncoder().encode(JSON.stringify(body)).length > WRITE_MAX_BYTES) return { ok: false, op, reason: 'body over 16 KB' }

  let answer: unknown
  try {
    answer = await $fetch(boardWriteUrl, {
      method: 'POST',
      headers: { [boardWriteHeaderName]: boardWriteHeaderValue },
      body,
      // ask_vera holds the call while the orchestrator answers (the gateway's ask.wait_sec, 100 s by default, at most 140 s).
      timeout: (ASK_OPS as readonly string[]).includes(op) ? ASK_TIMEOUT_MS : 15_000,
      retry: 0 // a write is never retried blind: the caller re-reads and decides
    })
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 403) fail('header credential refused (HTTP 403)', workflow)
    // 502 { error } carries no rows. Pass its short reason on.
    const reason = (err as { data?: { error?: unknown } }).data?.error
    fail(typeof reason === 'string' ? `HTTP ${status}: ${reason.slice(0, 120)}` : status ? `HTTP ${status}` : 'no response', workflow)
  }
  return validateWrite(answer, op)
}

/** Throws unless the answer is { ok: true, rows } or { ok: false, reason }. Unknown row keys are dropped. */
function validateWrite(answer: unknown, op: string): WriteResult {
  const workflow = 'gw.gov-board-write'
  if (!answer || typeof answer !== 'object') fail('response is not a JSON object', workflow)
  const a = answer as Record<string, unknown>
  if (a.ok === false) {
    return { ok: false, op, reason: typeof a.reason === 'string' && a.reason ? a.reason : 'refused' }
  }
  if (a.ok !== true) fail('response has no ok flag', workflow)
  const raw = (a.rows ?? {}) as Record<string, unknown>
  const rows: WriteRows = {}
  for (const key of ['tasks', 'steps', 'notes'] as const) {
    if (raw[key] === undefined) continue
    if (!Array.isArray(raw[key])) fail(`rows.${key} is not a list`, workflow)
    rows[key] = raw[key] as never
  }
  // read_brief is the one op that answers a body beside the rows.
  let brief: Brief | undefined
  if (op === 'read_brief') {
    brief = cleanBrief(a.brief) ?? fail('brief is missing or malformed', workflow)
  }
  // ask_vera and vera_reply answer the orchestrator's reply beside the rows: ref, pending, and once it has answered,
  // answer, status and ticket_id.
  const ask = (ASK_OPS as readonly string[]).includes(op) ? askFields(a) : {}
  if ((ASK_OPS as readonly string[]).includes(op) && (typeof ask.ref !== 'string' || typeof ask.pending !== 'boolean')) fail('ask answer has no ref or pending flag', workflow)
  return { ok: true, op, rows, ...(typeof a.agent_id === 'string' ? { agent_id: a.agent_id } : {}), ...(brief ? { brief } : {}), ...ask }
}
