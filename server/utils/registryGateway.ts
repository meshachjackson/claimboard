// The Registry's read path to n8n: gw.gov-registry-read. Read only.
// Same rules as gateway.ts: never log the header value or rows; errors carry a status and a short reason.
// Every call is one n8n execution, so good responses are cached for CACHE_MS and shared.
// The copy lives in the shared Runtime Cache (runtimeCache.ts), so every function instance uses the same one.
// The repo has no @types/node, so TypeScript can't type this Node import; Nitro runs on Node, so it resolves at run time.
// @ts-ignore
import { readFileSync } from 'node:fs'
import type { RegistryData, RegistrySource } from '~~/app/types/registry'

const ARRAY_KEYS = ['registry', 'access', 'reviews', 'history', 'assets', 'policy'] as const
const DEPLOYED_KEYS = ['sources', 'unregistered'] as const
// Five minutes, like the board (gateway.ts). Registry rows change only through the form.gov-* workflows, and the
// Refresh button skips the cache.
const CACHE_MS = 5 * 60_000
const SNAPSHOT_KEY = 'registry-snapshot'
const MAX_SNAPSHOT_BYTES = 1_800_000 // a Runtime Cache item holds 2 MB

function fail(reason: string): never {
  console.error(`[gateway] gw.gov-registry-read: ${reason}`)
  throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', data: { error: reason } })
}

/** Throws unless the body has every top-level key of RegistryData. */
function validate(body: unknown): RegistryData {
  if (!body || typeof body !== 'object') fail('response is not a JSON object')
  const data = body as Record<string, unknown>
  if (typeof data.generated_at !== 'string') fail('missing generated_at')
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(data[key])) fail(`missing ${key}`)
  }
  const deployed = data.deployed as Record<string, unknown> | undefined
  if (!deployed || typeof deployed !== 'object') fail('missing deployed')
  for (const key of DEPLOYED_KEYS) {
    if (!Array.isArray(deployed[key])) fail(`missing deployed.${key}`)
  }
  if (!deployed.agents || typeof deployed.agents !== 'object') fail('missing deployed.agents')
  if (!deployed.containers || typeof deployed.containers !== 'object') fail('missing deployed.containers')
  // The gateway already drops credential_ref. Refuse a response that carries it anyway.
  if ((data.access as Record<string, unknown>[]).some(a => 'credential_ref' in a)) fail('access rows carry credential_ref')
  return data as unknown as RegistryData
}

/** An explicit NUXT_REGISTRY_SOURCE wins; otherwise the gateway only when its URL is set. */
export function registrySource(): RegistrySource {
  const { registrySource, registryReadUrl } = useRuntimeConfig()
  if (registrySource === 'gateway' || registrySource === 'fixtures' || registrySource === 'file') return registrySource
  return registryReadUrl ? 'gateway' : 'fixtures'
}

/** The Registry's rows from whichever source is active. `fresh` skips the cache (the owner's Refresh button). */
export function registryData(fresh = false): Promise<RegistryData> | RegistryData {
  const source = registrySource()
  if (source === 'file') return fileRegistry()
  return source === 'gateway' ? registryRead(fresh) : fixtureRegistry()
}

/**
 * The copy scripts/registry-pull.mjs wrote (NUXT_REGISTRY_FILE). Read on every request, so a new pull shows on Refresh.
 * Checked like a gateway response, so a stale or broken file fails the same way.
 */
function fileRegistry(): RegistryData {
  const file = String(useRuntimeConfig().registryFile || '.data/registry.json')
  let body: unknown
  try {
    body = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    console.error(`[registry] ${file}: missing or not JSON. Run node scripts/registry-pull.mjs`)
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway', data: { error: 'registry file missing; run scripts/registry-pull.mjs' } })
  }
  return validate(body)
}

type Snapshot = { at: number, data: RegistryData }

// Only used when a snapshot is too big to share: this instance then keeps its own copy (the old behavior).
let oversized: Snapshot | null = null
let inFlight: Promise<RegistryData> | null = null

async function readSnapshot(): Promise<Snapshot | null> {
  const snap = oversized ?? await cacheGet<Snapshot>(SNAPSHOT_KEY)
  if (!snap || typeof snap.at !== 'number' || !Array.isArray(snap.data?.registry)) return null
  return Date.now() - snap.at < CACHE_MS ? snap : null
}

async function fetchAndStore(): Promise<RegistryData> {
  const snap = { at: Date.now(), data: await fetchRegistry() }
  const bytes = new TextEncoder().encode(JSON.stringify(snap)).length
  if (bytes > MAX_SNAPSHOT_BYTES) {
    console.warn(`[gateway] registry snapshot is ${bytes} bytes, over the Runtime Cache limit: kept per instance`)
    oversized = snap
  } else {
    oversized = null
    await cacheSet(SNAPSHOT_KEY, snap, CACHE_MS / 1000)
  }
  return snap.data
}

/**
 * RegistryData, from the shared snapshot when it's younger than CACHE_MS. Concurrent callers on one instance share
 * one fetch. `fresh` skips the snapshot: one gateway run per Refresh click.
 */
export async function registryRead(fresh = false): Promise<RegistryData> {
  if (!fresh) {
    const snap = await readSnapshot()
    if (snap) return snap.data
  }
  if (!inFlight) inFlight = fetchAndStore().finally(() => { inFlight = null })
  return inFlight
}

/** GET gw.gov-registry-read with the header credential and return RegistryData. */
async function fetchRegistry(): Promise<RegistryData> {
  const { registryReadUrl, registryHeaderName, registryHeaderValue } = useRuntimeConfig()
  if (!registryReadUrl) fail('NUXT_REGISTRY_READ_URL is not set')
  if (!registryHeaderName || !registryHeaderValue) fail('the header credential env vars are not set')

  let body: unknown
  try {
    body = await $fetch(registryReadUrl, {
      method: 'GET',
      headers: { [registryHeaderName]: registryHeaderValue },
      timeout: 15_000,
      retry: 0
    })
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 403) fail('header credential refused (HTTP 403)')
    fail(status ? `HTTP ${status}` : 'no response')
  }

  const data = validate(body)
  // One line per real call (cache misses only), so the execution budget can be counted from the server log.
  console.info(`[gateway] gw.gov-registry-read fetched: ${data.registry.length} agents, ${data.access.length} access rows`)
  return data
}
