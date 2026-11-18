// The board server's shared cache: Vercel Runtime Cache, one copy per region for every function instance.
// A module variable is per instance, and Vercel runs several instances at once, so a write that patched
// one instance's copy left the others stale for up to a minute ( session, 10/27/2026: 4 of 66
// writes refused as stale). Outside Vercel, and in fixtures mode, @vercel/functions falls back to an
// in-memory cache in this process, which is the old behavior.
//
// Failures never throw: the package logs an error or a timeout (500 ms; RUNTIME_CACHE_TIMEOUT raises it)
// and answers "not found". The callers treat that as a miss and go to the gateway.
import { getCache } from '@vercel/functions'

// The package hashes keys to 32 bits by default, so two keys can collide. Ours are short and readable
// already, so they are used as they are, under one namespace.
const cache = getCache({ namespace: 'agent-board', keyHashFunction: key => key })

/** The value for a key, or null when it is missing, expired or the cache failed. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    return (await cache.get(key) as T | null) ?? null
  } catch (err) {
    console.error(`[cache] get ${key} failed: ${(err as Error).message}`)
    return null
  }
}

/** Stores a value for `ttlSeconds` (at least 1). A failure is logged and ignored. */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await cache.set(key, value, { ttl: Math.max(1, Math.ceil(ttlSeconds)), name: key })
  } catch (err) {
    console.error(`[cache] set ${key} failed: ${(err as Error).message}`)
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    await cache.delete(key)
  } catch (err) {
    console.error(`[cache] delete ${key} failed: ${(err as Error).message}`)
  }
}
