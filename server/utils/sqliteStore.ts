// The reference adapter (docs/design/open-source.md): the board's rows in one SQLite file, with the
// same op rules as fixtures mode (runOp) and a permission check against access.json instead of gov_access.
// node:sqlite is built into Node 24, so this adds no dependency. No Nitro auto-imports here: the file takes its
// settings as arguments, so tests can build a store without a running server.
// The repo has no @types/node, so TypeScript can't type these Node imports; Nitro runs on Node, so they resolve at run time.
// @ts-ignore
import { DatabaseSync } from 'node:sqlite'
// @ts-ignore
import { createHash, randomBytes } from 'node:crypto'
// @ts-ignore
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
// @ts-ignore
import { dirname } from 'node:path'
import type { BoardData, WriteResult, WriteRows } from '~~/app/types/board'
import { AGENT_READ_OPS, AGENT_WRITE_OPS, PROPOSED_OPS } from '~~/app/types/board'
import { runOp } from '~~/app/utils/boardOps'
import type { AgentRequest, RegistryData } from '~~/app/types/registry'
import type { WriteCaller } from './gateway.ts'
import type { BoardStore, RegistrationStore } from './store.ts'
import { checkRequest } from './registration.ts'

/** One agent in access.json: who it is, the SHA-256 of its token (never the token), and optionally the ops it may call. */
export interface AccessAgent { agent_id: string, token_sha256: string, ops?: string[] }
export interface AccessFile { agents: AccessAgent[] }

// The agent ops an access.json entry gets when it names none: the ops REST and MCP agents use, plus the reads they need.
const DEFAULT_AGENT_OPS = [...AGENT_WRITE_OPS, 'whoami', 'my_steps', 'read_brief', 'read_task', ...AGENT_READ_OPS] as string[]

// Each table holds one JSON document per row under its key. Field names stay exactly as tables.json has them.
const TABLES = [
  { name: 'tasks', key: 'task_id' },
  { name: 'steps', key: 'step_id' },
  { name: 'notes', key: 'note_id' },
  { name: 'columns', key: 'column_id' },
  { name: 'registry', key: 'agent_id' }
] as const

export interface SqliteStoreOptions {
  /** The database file. Created, with its folder, on first use. */
  file: string
  /** The permission file. Read on every write, so the owner's edits apply without a restart. A missing file lets no agent in. */
  accessFile: string
  /** The rows to start from when the database is empty. */
  seed: () => BoardData
}

export function createSqliteStore(options: SqliteStoreOptions): BoardStore {
  mkdirSync(dirname(options.file), { recursive: true })
  const db = new DatabaseSync(options.file)
  for (const t of TABLES) db.exec(`CREATE TABLE IF NOT EXISTS ${t.name} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${t.key} TEXT NOT NULL UNIQUE, data TEXT NOT NULL)`)
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
  db.exec('CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL)')

  const all = <T>(table: string): T[] => db.prepare(`SELECT data FROM ${table} ORDER BY id`).all().map((r: { data: string }) => JSON.parse(r.data) as T)
  const upsert = (table: typeof TABLES[number], rows: object[]) => {
    const stmt = db.prepare(`INSERT INTO ${table.name} (${table.key}, data) VALUES (?, ?) ON CONFLICT(${table.key}) DO UPDATE SET data = excluded.data`)
    for (const row of rows) stmt.run(String((row as Record<string, unknown>)[table.key]), JSON.stringify(row))
  }
  // One transaction, so a crash never leaves half a write.
  const inTransaction = (work: () => void) => {
    db.exec('BEGIN')
    try { work(); db.exec('COMMIT') } catch (err) { db.exec('ROLLBACK'); throw err }
  }

  // First use only: lay the seed rows down once. After that the database is the board.
  if (!db.prepare("SELECT v FROM meta WHERE k = 'seeded'").get()) {
    const seed = options.seed()
    inTransaction(() => {
      for (const t of TABLES) upsert(t, seed[t.name] as object[])
      db.prepare("INSERT INTO meta (k, v) VALUES ('seeded', ?)").run(new Date().toISOString())
    })
  }

  function load(): BoardData {
    return {
      generated_at: new Date().toISOString(),
      tasks: all('tasks'), steps: all('steps'), notes: all('notes'), columns: all('columns'), registry: all('registry')
    }
  }

  function access(): AccessAgent[] {
    if (!existsSync(options.accessFile)) return []
    try {
      const file = JSON.parse(readFileSync(options.accessFile, 'utf8')) as AccessFile
      return Array.isArray(file.agents) ? file.agents : []
    } catch {
      return [] // a damaged access.json lets nobody in; it never lets everybody in
    }
  }

  function save(rows: WriteRows) {
    inTransaction(() => {
      upsert(TABLES[0], rows.tasks ?? [])
      upsert(TABLES[1], rows.steps ?? [])
      upsert(TABLES[2], rows.notes ?? [])
    })
  }

  // ---------- Agent requests: the approval path for new agents (design doc) ----------

  const requests = (): AgentRequest[] => all<AgentRequest>('requests')
  const putRequest = (r: AgentRequest) => {
    db.prepare('INSERT INTO requests (request_id, data) VALUES (?, ?) ON CONFLICT(request_id) DO UPDATE SET data = excluded.data').run(r.request_id, JSON.stringify(r))
  }
  /** The access file as written, or an empty one. A damaged file is an error here: we must not overwrite what we cannot read. */
  function readAccessForWrite(): AccessFile {
    if (!existsSync(options.accessFile)) return { agents: [] }
    const file = JSON.parse(readFileSync(options.accessFile, 'utf8')) as AccessFile
    if (!Array.isArray(file.agents)) throw new Error(`${options.accessFile} has no "agents" list`)
    return file
  }
  function writeAccess(file: AccessFile) {
    mkdirSync(dirname(options.accessFile), { recursive: true })
    writeFileSync(`${options.accessFile}.tmp`, JSON.stringify(file, null, 2) + '\n')
    renameSync(`${options.accessFile}.tmp`, options.accessFile) // a crash never leaves half a file
  }

  const registration: RegistrationStore = {
    file(input, requestedBy) {
      const taken = [...(all<{ agent_id: string }>('registry')).map(r => r.agent_id), ...requests().filter(r => r.status === 'pending').map(r => r.agent_id)]
      const checked = checkRequest(input, taken)
      if (typeof checked === 'string') return { ok: false, reason: checked }
      const next = requests().reduce((n, r) => Math.max(n, Number(r.request_id.slice(4)) || 0), 0) + 1
      const request: AgentRequest = {
        ...checked, request_id: `REQ-${String(next).padStart(6, '0')}`, requested_by: requestedBy,
        status: 'pending', note: '', created_at: new Date().toISOString(), decided_at: null
      }
      putRequest(request)
      return { ok: true, request }
    },
    list: requests,
    decide(requestId, decision, note) {
      const request = requests().find(r => r.request_id === requestId)
      if (!request) return { ok: false, reason: `no request ${requestId}` }
      if (request.status !== 'pending') return { ok: false, reason: `${requestId} is already ${request.status}` }
      const decided = { ...request, note: note.trim().slice(0, 500), decided_at: new Date().toISOString() }
      if (decision === 'reject') {
        putRequest({ ...decided, status: 'rejected' })
        return { ok: true, request: { ...decided, status: 'rejected' } }
      }
      // Approve: the token is made here, shown once, and only its hash is kept. The access entry goes first: if the
      // database write then fails, the entry names an agent that is not registered, and an unregistered agent is refused.
      if (all<{ agent_id: string }>('registry').some(r => r.agent_id === request.agent_id)) return { ok: false, reason: `${request.agent_id} is already registered` }
      const token = randomBytes(32).toString('base64url')
      const accessBefore = readAccessForWrite()
      const entry: AccessAgent = { agent_id: request.agent_id, token_sha256: createHash('sha256').update(token, 'utf8').digest('hex') }
      writeAccess({ ...accessBefore, agents: [...accessBefore.agents.filter(a => a.agent_id !== request.agent_id), entry] })
      const approved: AgentRequest = { ...decided, status: 'approved' }
      try {
        inTransaction(() => {
          db.prepare('INSERT INTO registry (agent_id, data) VALUES (?, ?)').run(request.agent_id, JSON.stringify({
            agent_id: request.agent_id, name: request.name, description: '', owner: request.requested_by, domain: '',
            lifecycle_status: 'active', runtime: 'webhook', agent_type: null, type_version: null, host: null, inference: null,
            reachability: request.webhook_url, request_types: '', status_interface: 'none', classes: request.classes
          }))
          putRequest(approved)
        })
      } catch (err) {
        writeAccess(accessBefore) // put the access file back as it was
        throw err
      }
      return { ok: true, request: approved, token }
    }
  }

  return {
    name: 'reference',
    registration,
    // Reported as fixtures so the page treats the rows as saved on the server (saved: true), the way NUXT_BOARD_FILE does.
    source: () => 'fixtures',
    read: () => load(),
    cached: async () => null,
    cacheFresh: async () => true,
    async write(op, args, caller: WriteCaller): Promise<WriteResult> {
      const board = load()
      let result: WriteResult
      if ('person' in caller) {
        result = runOp(board, op, args, { person: caller.person })
      } else {
        const hash = createHash('sha256').update(caller.token, 'utf8').digest('hex')
        const agent = access().find(a => a.token_sha256 === hash)
        if (!agent || !board.registry.some(r => r.agent_id === agent.agent_id)) return { ok: false, op, reason: 'unknown token' }
        if (!(agent.ops ?? DEFAULT_AGENT_OPS).includes(op)) return { ok: false, op, reason: `${agent.agent_id} may not call ${op}` }
        result = runOp(board, op, args, { agent_id: agent.agent_id })
      }
      if (result.ok) save(result.rows)
      return result
    },
    capabilities: () => ({ liveOps: [...PROPOSED_OPS], writable: true, saved: true }),
    registrySource: () => 'fixtures',
    // The registry subset the board needs; the governance tables a deployment adds (access, reviews, history) start empty.
    readRegistry: (): RegistryData => ({
      generated_at: new Date().toISOString(),
      registry: load().registry, access: [], reviews: [], history: [], assets: [], policy: [], deployed: { captured_at: new Date().toISOString(), sources: [], agents: {}, containers: {}, unregistered: [] }
    } as unknown as RegistryData)
  }
}
