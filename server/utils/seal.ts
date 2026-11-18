// Sealed values for the orchestrator connector's OAuth front door (option B).
// agent-board stores nothing: client ids, codes, access and refresh tokens, and the consent cookie are each
// a JSON payload sealed with AES-256-GCM under NUXT_CONNECTOR_SEAL_KEY. Only this app holds that key, so
// only it can read or make one. Rotating the key signs every connector account out (the break-glass).
// Pure functions with no Nuxt globals, so `node --test` can load this file directly.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** Every sealed value starts with this, so /mcp can tell one from a Phase A raw board token. */
export const SEAL_PREFIX = 'vc1.'

export type SealKind = 'client' | 'pending' | 'code' | 'access' | 'refresh'

/** What a sealed value holds. exp is in epoch seconds; 0 means it never expires (client ids only). */
export interface SealPayload {
  kind: SealKind
  exp: number
  agent_id?: string
  board_token?: string
  client_id?: string
  [field: string]: unknown
}

const IV_BYTES = 12
const TAG_BYTES = 16

/** The 32-byte AES key. Any string of at least 32 characters works; its SHA-256 is the key. */
function keyBytes(key: string): Buffer {
  if (!key || key.length < 32) throw new Error('NUXT_CONNECTOR_SEAL_KEY must be at least 32 characters')
  return createHash('sha256').update(key, 'utf8').digest()
}

/** `vc1.` + base64url(iv | tag | ciphertext). The prefix is bound in as associated data. */
export function seal(payload: SealPayload, key: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv)
  cipher.setAAD(Buffer.from(SEAL_PREFIX))
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return SEAL_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

/**
 * The payload of a sealed value of the given kind, or null when it isn't one: wrong prefix, tampered,
 * sealed under another key, another kind, or expired at `now` (epoch seconds).
 */
export function unseal(value: string, kind: SealKind, key: string, now: number): SealPayload | null {
  if (typeof value !== 'string' || !value.startsWith(SEAL_PREFIX)) return null
  const raw = Buffer.from(value.slice(SEAL_PREFIX.length), 'base64url')
  if (raw.length <= IV_BYTES + TAG_BYTES) return null
  const aesKey = keyBytes(key) // throws on a missing key rather than reading as "not sealed"
  let payload: SealPayload
  try {
    const decipher = createDecipheriv('aes-256-gcm', aesKey, raw.subarray(0, IV_BYTES))
    decipher.setAAD(Buffer.from(SEAL_PREFIX))
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8')
    payload = JSON.parse(text) as SealPayload
  } catch {
    return null // a bad tag means tampered or another key
  }
  if (payload.kind !== kind) return null
  if (payload.exp !== 0 && !(payload.exp > now)) return null
  return payload
}
