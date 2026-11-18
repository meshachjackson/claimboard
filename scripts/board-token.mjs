#!/usr/bin/env node
// Issues one agent board token. Node's built-in crypto only.
// Prints a new 32-byte token once, and its SHA-256 hex, which is all gw.gov-board-write stores.
// Nothing is written to disk. Put the token in the agent's own config (for Claude Code,
// the secrets file) and file only the hash through form.gov-board-token.
//
//   node scripts/board-token.mjs [agent_id]
import { createHash, randomBytes } from 'node:crypto'

const agentId = process.argv[2] ?? '<agent_id>'
// base64url keeps the token header-safe. The gateway hashes the token string as sent.
const token = randomBytes(32).toString('base64url')
const hash = createHash('sha256').update(token, 'utf8').digest('hex')

console.log(`Token for ${agentId} (shown once; copy it into the agent's config now):`)
console.log(token)
console.log('')
console.log('SHA-256 to file in form.gov-board-token:')
console.log(hash)
