#!/usr/bin/env node
// First-run setup for a self-hosted board (docs/design/open-source.md). Node built-ins only.
// Writes .env and the empty access.json for the reference backend (SQLite). It never overwrites an existing .env
// without --force, never prints the secrets it writes, and refuses to write .env where git would track it.
//
//   pnpm run setup                       asks for the owner's GitHub login and name
//   pnpm run setup --yes --login you --name "Your Name"   no questions
//
//   --dir <path>                     where to write (default: the current folder)
//   --login <github login>           the GitHub login that may sign in; comma-separate for more
//   --name <display name>            the owner's name on the board (default: the first login)
//   --github-client-id / --github-client-secret   the GitHub OAuth app (leave out to add them to .env later)
//   --force                          replace an existing .env
//   --yes                            do not ask; every answer comes from flags
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline/promises'

/** "Ada Lovelace" or "ada-l" becomes "ada-lovelace" / "ada-l", the part after person: in the owner id. */
export function slug(text) {
  return String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** GitHub logins from one comma-separated string: 1 to 39 letters, digits or hyphens each. Throws on a bad one. */
export function parseLogins(text) {
  const logins = String(text ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!logins.length) throw new Error('Give at least one GitHub login.')
  for (const l of logins) {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(l)) throw new Error(`"${l}" is not a GitHub login.`)
  }
  return logins
}

/** The .env text for a reference install. `secret` is the session password (at least 32 characters). */
export function buildEnv({ logins, name, secret, clientId = '', clientSecret = '', data = '.data' }) {
  if (secret.length < 32) throw new Error('The session password must be at least 32 characters.')
  const shown = name || logins[0]
  // The name goes in double quotes so `. ./.env` and Docker's env_file both read it back as written.
  if (!/^[\w .'-]+$/.test(shown)) throw new Error('The name may use letters, digits, spaces, apostrophes, dots and hyphens.')
  const owner = slug(shown)
  if (!owner) throw new Error('The owner name needs at least one letter or digit.')
  return [
    '# Written by `pnpm run setup`. Never commit this file.',
    '# Keep the reference backend: the board lives in a SQLite file.',
    'NUXT_BOARD_BACKEND=reference',
    `NUXT_BOARD_DB=${data}/board.sqlite`,
    `NUXT_BOARD_ACCESS=${data}/access.json`,
    '# Who may sign in, and who the board writes as.',
    `NUXT_ALLOWED_LOGINS=${logins.join(',')}`,
    `NUXT_PUBLIC_BOARD_OWNER=person:${owner}`,
    `NUXT_PUBLIC_BOARD_OWNER_NAME="${shown}"`,
    '# Encrypts the session cookie.',
    `NUXT_SESSION_PASSWORD=${secret}`,
    '# Your GitHub OAuth app (README: Sign-in). The callback URL is <your address>/auth/github.',
    `NUXT_OAUTH_GITHUB_CLIENT_ID=${clientId}`,
    `NUXT_OAUTH_GITHUB_CLIENT_SECRET=${clientSecret}`,
    ''
  ].join('\n')
}

/** True when `dir`'s .gitignore (if there is one) ignores .env, so the file cannot be committed by accident. */
export function envIsIgnored(dir) {
  const file = join(dir, '.gitignore')
  if (!existsSync(file)) return true // not a git checkout, or no rules: nothing to leak into
  return readFileSync(file, 'utf8').split('\n').map(l => l.trim()).some(l => l === '.env' || l === '.env.*' || l === '/.env')
}

function flags(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    if (['force', 'yes'].includes(key)) out[key] = true
    else out[key] = argv[++i] ?? ''
  }
  return out
}

/** Does the setup. Returns the lines to print. `ask` answers a question; it is only called without --yes. */
export async function setup(argv, ask = async () => '') {
  const f = flags(argv)
  const dir = f.dir || process.cwd()
  const envFile = join(dir, '.env')
  if (existsSync(envFile) && !f.force) throw new Error(`${envFile} already exists. Nothing was changed. Use --force to replace it.`)
  if (!envIsIgnored(dir)) throw new Error(`${join(dir, '.gitignore')} does not ignore .env. Add a line ".env" first, so the secrets cannot be committed.`)

  const logins = parseLogins(f.login ?? (f.yes ? '' : await ask('GitHub login that may sign in (comma-separate more): ')))
  const name = (f.name ?? (f.yes ? '' : await ask(`Your name on the board [${logins[0]}]: `))).trim() || logins[0]
  const text = buildEnv({
    logins, name, secret: randomBytes(32).toString('hex'),
    clientId: f['github-client-id'] ?? '', clientSecret: f['github-client-secret'] ?? ''
  })

  mkdirSync(join(dir, '.data'), { recursive: true })
  const access = join(dir, '.data', 'access.json')
  if (!existsSync(access)) writeFileSync(access, JSON.stringify({ agents: [] }, null, 2) + '\n')
  writeFileSync(envFile, text)
  chmodSync(envFile, 0o600)

  const lines = [`Wrote ${envFile} (owner person:${slug(name)}, ${logins.length} login${logins.length > 1 ? 's' : ''}).`, `Wrote ${access} (no agents yet).`]
  if (!f['github-client-id'] || !f['github-client-secret']) lines.push('Next: create a GitHub OAuth app and put its id and secret in .env (README: Sign-in).')
  lines.push('Then: docker compose up   (or: pnpm build && node .output/server/index.mjs)')
  return lines
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const rl = process.argv.includes('--yes') ? null : createInterface({ input: process.stdin, output: process.stdout })
  try {
    for (const line of await setup(process.argv.slice(2), q => rl.question(q))) console.log(line)
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  } finally {
    rl?.close()
  }
}
