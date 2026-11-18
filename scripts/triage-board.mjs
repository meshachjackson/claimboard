#!/usr/bin/env node
// The scheduled board triage: the rules pass with no model, run by cron or launchd once a week.
// It reads the board from a file (--file, the shape of .data/board.json) or from a running local dev server
// (--url, signed in through /auth/dev with the cookie kept in memory), runs triageBoard, and prints one fixed
// finding line per card to stdout: "TSK-... · action · reason · evidence". With --log <dir> the same lines also go
// to <dir>/triage-<yyyy-mm-dd>.txt. It never writes the board. Node built-ins only; the rules come from app/utils/triage.ts.
//
//   node scripts/triage-board.mjs --file .data/board.json [--log .data/triage] [--now <iso>] [--owner person:<name>]
//   node scripts/triage-board.mjs --url http://localhost:3000 [--log <dir>]
//
// With neither --file nor --url it reads NUXT_BOARD_FILE from the environment or .env. --owner (or
// NUXT_PUBLIC_BOARD_OWNER) names whose comments the "no reply" rule watches. --now fixes the clock, for tests.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const USAGE = 'usage: node scripts/triage-board.mjs (--file <board.json> | --url <http://localhost:3000>) [--log <dir>] [--now <iso>] [--owner person:<name>]'

// The app's modules import each other as `~/...`. Node needs a resolver for that alias, the same one the tests register.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~/')) spec = new URL('./app/' + spec.slice(2) + '.ts', ${JSON.stringify(ROOT.href)}).href
  return next(spec, ctx)
}`))
const { triageBoard, formatFindingLine } = await import(new URL('./app/utils/triage.ts', ROOT).href)
const { setBoardOwner, TRIAGE_ACTIONS } = await import(new URL('./app/types/board.ts', ROOT).href)

/** The four row lists the rules pass reads, from a board file. The registry is not in the file; mock/ stands in. */
export function readBoardFile(file) {
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  for (const key of ['tasks', 'steps', 'notes']) {
    if (!Array.isArray(saved[key])) throw new Error(`${file} has no "${key}" list`)
  }
  const registry = Array.isArray(saved.registry) ? saved.registry : JSON.parse(readFileSync(new URL('./mock/gov_registry.json', ROOT), 'utf8'))
  return { tasks: saved.tasks, steps: saved.steps, notes: saved.notes, registry }
}

/** The same four lists from a running local server: sign in at /auth/dev, keep its cookies, then GET /api/board. */
export async function readBoardUrl(base) {
  const origin = base.replace(/\/+$/, '')
  const signIn = await fetch(`${origin}/auth/dev`, { redirect: 'manual' })
  if (signIn.status === 404) throw new Error(`${origin}/auth/dev answered 404. The dev sign-in is off: run the dev server with NUXT_DEV_LOGIN=1.`)
  const jar = signIn.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  if (!jar) throw new Error(`${origin}/auth/dev answered ${signIn.status} with no session cookie`)
  const res = await fetch(`${origin}/api/board`, { headers: { cookie: jar } })
  if (!res.ok) throw new Error(`${origin}/api/board answered ${res.status}`)
  const data = await res.json()
  return { tasks: data.tasks, steps: data.steps, notes: data.notes, registry: data.registry ?? [] }
}

/** <dir>/triage-<yyyy-mm-dd>.txt, the day in local time. */
export function logPath(dir, now) {
  const d = new Date(now)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return join(dir, `triage-${day}.txt`)
}

function option(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

export async function main(args) {
  // .env is where the dev server keeps NUXT_BOARD_FILE and the owner; values already in the environment win.
  try { process.loadEnvFile(join(process.cwd(), '.env')) } catch {}
  const file = option(args, '--file') ?? (option(args, '--url') ? undefined : process.env.NUXT_BOARD_FILE)
  const url = option(args, '--url')
  const now = option(args, '--now') ? Date.parse(option(args, '--now')) : Date.now()
  if ((!file && !url) || (file && url) || Number.isNaN(now)) {
    console.error(USAGE)
    return 2
  }
  const owner = option(args, '--owner') ?? process.env.NUXT_PUBLIC_BOARD_OWNER
  if (owner) setBoardOwner(owner)

  const rows = url ? await readBoardUrl(url) : readBoardFile(file)
  const findings = triageBoard(rows, { now })
  const lines = findings.map(formatFindingLine)
  if (lines.length) process.stdout.write(lines.join('\n') + '\n')

  const log = option(args, '--log')
  if (log) {
    mkdirSync(log, { recursive: true })
    writeFileSync(logPath(log, now), lines.join('\n') + (lines.length ? '\n' : ''))
  }
  // Counts only on stderr, so stdout holds nothing but the lines.
  const counts = TRIAGE_ACTIONS.map(a => [a, findings.filter(f => f.action === a).length]).filter(([, n]) => n).map(([a, n]) => `${a} ${n}`)
  console.error(`triage-board: ${findings.length} finding${findings.length === 1 ? '' : 's'}${counts.length ? ` (${counts.join(', ')})` : ''}`
    + ` from ${url ?? file}${log ? ` -> ${logPath(log, now)}` : ''}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => process.exit(code), (err) => { console.error(`triage-board: ${err.message}`); process.exit(1) })
}
