// The seam between the app and wherever the board's rows live (docs/design/open-source.md).
// Routes and agent ops reach the board only through boardStore(). Two adapters: reference (the default) keeps the rows
// in SQLite (sqliteStore.ts); n8n-gateway, chosen by NUXT_BOARD_BACKEND=n8n-gateway, wraps gateway.ts and
// registryGateway.ts, including their fixtures mode (NUXT_BOARD_SOURCE=fixtures). See backend.ts.
import type { BoardData, BoardSource, WriteResult } from '~~/app/types/board'
import type { AgentRequest, RegistryData, RegistrySource } from '~~/app/types/registry'
import type { WriteCaller } from './gateway.ts'
import { createSqliteStore } from './sqliteStore.ts'
import { starterSeed } from './starterSeed.ts'
import { announceBoardChange, changesBoard } from './boardEvents.ts'
import { pickBackend } from './backend.ts'

/** The reference install's approval path for new agents. The n8n-gateway adapter has none: there it is form.gov-register-agent. */
export interface RegistrationStore {
  /** Files a pending request. The agent has no registry row and no token until the owner approves. */
  file(input: unknown, requestedBy: string): { ok: true, request: AgentRequest } | { ok: false, reason: string }
  list(): AgentRequest[]
  /** Approve writes the registry row and the access.json entry and returns the token once; reject writes neither. */
  decide(requestId: string, decision: 'approve' | 'reject', note: string): { ok: true, request: AgentRequest, token?: string } | { ok: false, reason: string }
}

export interface BoardStore {
  /** Which adapter this is. */
  readonly name: 'n8n-gateway' | 'reference'
  /** Where this adapter's rows come from right now: its backend, or the built-in fixtures. */
  source(): BoardSource
  /** The board's rows. `fresh` skips any cache (the Refresh button). */
  read(fresh?: boolean): Promise<BoardData> | BoardData
  /** Rows already in the cache, else null. Never costs a backend call. */
  cached(): Promise<BoardData | null>
  /** True when a read would be served without a backend call. */
  cacheFresh(): Promise<boolean>
  /** One board op for a caller: the owner (as_person) or an agent's token. */
  write(op: string, args: Record<string, unknown>, caller: WriteCaller): Promise<WriteResult>
  /** What this backend supports right now, so the UI only offers what works. */
  capabilities(): { liveOps: string[], writable: boolean, saved: boolean }
  /** Present only on adapters with their own approval path (the reference backend). */
  readonly registration?: RegistrationStore
  registrySource(): RegistrySource
  readRegistry(fresh?: boolean): Promise<RegistryData> | RegistryData
}

const n8nGateway: BoardStore = {
  name: 'n8n-gateway',
  source: boardSource,
  read: boardData,
  cached: cachedBoard,
  cacheFresh: boardCacheFresh,
  write: boardWrite,
  capabilities: () => ({ liveOps: liveOps(), writable: boardWritable(), saved: boardSaved() }),
  registrySource,
  readRegistry: registryData
}

let reference: BoardStore | null = null

// Every board write that changes rows tells the push stream (boardEvents.ts). Wrapped once per adapter.
const announced = new WeakMap<BoardStore, BoardStore>()
function announcing(store: BoardStore): BoardStore {
  let wrapped = announced.get(store)
  if (!wrapped) {
    wrapped = Object.create(store, {
      write: {
        value: async (op: string, args: Record<string, unknown>, caller: WriteCaller) => {
          const result = await store.write(op, args, caller)
          if (changesBoard(op, result.ok)) announceBoardChange()
          return result
        }
      }
    }) as BoardStore
    announced.set(store, wrapped)
  }
  return wrapped
}

export function boardStore(): BoardStore {
  const { boardBackend, boardDb, boardAccess } = useRuntimeConfig()
  if (pickBackend(boardBackend) === 'n8n-gateway') return announcing(n8nGateway)
  reference ??= createSqliteStore({ file: String(boardDb), accessFile: String(boardAccess), seed: starterSeed })
  return announcing(reference)
}
