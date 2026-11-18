#!/usr/bin/env node
// Mints a Linear app token with the client credentials grant and saves it in the settings folder.
// Meshach runs this himself in a terminal. It asks for the app's client ID and client secret (the secret is not echoed),
// calls Linear once, and writes one line to the secrets file (BOARD_SECRETS_FILE, else secrets.env in BOARD_RUN_CONF_DIR, else .data). It never prints the secret or the token.
// Node built-ins only.
//
//   node scripts/linear-token.mjs LINEAR_RUN_TOKEN
//
// The argument is the name to save the token under (default LINEAR_RUN_TOKEN). Linear's pages say this kind of token
// lasts 30 days, so run it again when the runner starts getting "authentication" errors.
// Unverified until the first run: that a client credentials token acts as the app's own user (docs/linear-runner.md).
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { secretsFile } from './lib/paths.mjs'

const NAME = process.argv[2] ?? 'LINEAR_RUN_TOKEN'
if (!/^[A-Z][A-Z0-9_]*$/.test(NAME)) { console.error('usage: node scripts/linear-token.mjs [NAME_IN_CAPS]'); process.exit(2) }
const FILE = secretsFile()

/** Ask one question. With hidden true, typed characters are not shown. */
function ask(question, hidden = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  if (hidden) rl._writeToOutput = text => { if (text.includes(question)) rl.output.write(question) }
  return new Promise(done => rl.question(question, answer => { rl.close(); if (hidden) console.log(''); done(answer.trim()) }))
}

const id = await ask('Client ID: ')
const secret = await ask('Client secret (hidden): ', true)
if (!id || !secret) { console.error('Both values are needed. Nothing was saved.'); process.exit(1) }

const res = await fetch('https://api.linear.app/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, scope: 'read,write,app:assignable,app:mentionable' })
})
const body = await res.json().catch(() => ({}))
if (!res.ok || !body.access_token) {
  // Linear's error fields carry no secret. The token and the client secret are never printed.
  console.error(`Linear refused (HTTP ${res.status}): ${body.error ?? 'no error name'} ${body.error_description ?? ''}`.trim())
  process.exit(1)
}

// Replace an earlier line for the same name, keep every other line as it is.
const lines = existsSync(FILE) ? readFileSync(FILE, 'utf8').split('\n').filter(line => !line.startsWith(NAME + '=')) : []
while (lines.length && lines[lines.length - 1] === '') lines.pop()
mkdirSync(dirname(FILE), { recursive: true })
writeFileSync(FILE, [...lines, `${NAME}=${body.access_token}`, ''].join('\n'), { mode: 0o600 })
chmodSync(FILE, 0o600)
const days = body.expires_in ? Math.round(body.expires_in / 86400) : null
console.log(`Saved ${NAME} in ${FILE}.${days ? ` It lasts about ${days} days.` : ''}`)
