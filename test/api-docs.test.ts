// The /api page lists every route in server/api and server/routes, and lists nothing that does not exist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { API_ENDPOINTS, leadSentence, matchesQuery, quickStartCall, routeOfFile } from '../app/utils/apiDocs.ts'

// Tracked files when git is there; a plain walk of the two folders when it is not (an unpacked archive).
function routeFiles(): string[] {
  try {
    return execFileSync('git', ['ls-files', 'server/api', 'server/routes'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(f => f.endsWith('.ts'))
  } catch {
    return ['server/api', 'server/routes'].flatMap(d => readdirSync(new URL(`../${d}`, import.meta.url), { recursive: true }).map(f => `${d}/${f}`)).filter(f => f.endsWith('.ts'))
  }
}
const files = routeFiles()
// Nitro serves one route file at a time; the protected-resource metadata is also served under /mcp.
const ALIASES = new Set(['GET /.well-known/oauth-protected-resource/mcp'])
const real = files.map(routeOfFile).filter((r): r is { method: string, path: string } => !!r).map(r => `${r.method} ${r.path}`)
const documented = API_ENDPOINTS.map(e => `${e.method} ${e.path}`)

test('every route file is documented', () => {
  const missing = real.filter(r => !documented.includes(r) && !ALIASES.has(r))
  assert.deepEqual(missing, [], 'add these to app/utils/apiDocs.ts')
})

test('every documented route has a file', () => {
  const extra = documented.filter(d => !real.includes(d))
  assert.deepEqual(extra, [])
})

test('lead sentence stops at the first full stop, not at a dot inside a word', () => {
  assert.equal(leadSentence('One agent op. Reads: list_claimable.'), 'One agent op.')
  assert.equal(leadSentence('Dev-only sign-in. Needs NUXT_DEV_LOGIN=1.'), 'Dev-only sign-in.')
  assert.equal(leadSentence('No full stop here'), 'No full stop here')
  assert.ok(leadSentence('x'.repeat(300)).length <= 140)
})

test('search needs every word and ignores case', () => {
  const claim = API_ENDPOINTS.find(e => e.path === '/api/agent/:op')!
  assert.ok(matchesQuery(claim, 'POST agent TOKEN'))
  assert.ok(matchesQuery(claim, ''))
  assert.ok(!matchesQuery(claim, 'agent nonsenseword'))
})

test('the first call names the install it was opened from', () => {
  assert.match(quickStartCall('https://kanban.example'), /^curl -X POST https:\/\/kanban\.example\/api\/agent\/list_claimable/)
})

test('no route is listed twice', () => {
  assert.equal(new Set(documented).size, documented.length)
})
