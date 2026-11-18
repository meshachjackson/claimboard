// The slice of node:crypto and Buffer that seal.ts and oauth.ts use. The repo has no @types/node, and adding a
// dependency needs the owner's yes (CLAUDE.md). If @types/node is ever added, delete this file.
declare module 'node:crypto' {
  interface Hash { update: (data: string, encoding?: string) => Hash, digest: { (encoding: 'hex' | 'base64url'): string, (): Buffer } }
  interface Cipher { setAAD: (aad: Buffer) => void, update: (data: string | Buffer, inputEncoding?: string) => Buffer, final: () => Buffer, getAuthTag: () => Buffer }
  interface Decipher { setAAD: (aad: Buffer) => void, setAuthTag: (tag: Buffer) => void, update: (data: Buffer) => Buffer, final: () => Buffer }
  export function createHash(algorithm: 'sha256'): Hash
  export function createCipheriv(algorithm: 'aes-256-gcm', key: Buffer, iv: Buffer): Cipher
  export function createDecipheriv(algorithm: 'aes-256-gcm', key: Buffer, iv: Buffer): Decipher
  export function randomBytes(size: number): Buffer
  export function timingSafeEqual(a: Buffer, b: Buffer): boolean
}

interface Buffer extends Uint8Array {
  toString: (encoding?: 'utf8' | 'base64url' | 'hex') => string
  subarray: (start?: number, end?: number) => Buffer
}
declare const Buffer: {
  from: (data: string | Uint8Array, encoding?: 'utf8' | 'base64url') => Buffer
  concat: (list: Uint8Array[]) => Buffer
}
