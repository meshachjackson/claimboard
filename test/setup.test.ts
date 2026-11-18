// The self-host setup (scripts/setup.mjs) and the starter seed (server/utils/starterSeed.ts): the files a new install
// starts from hold no personal data, the secrets stay out of git, and an existing .env is never overwritten.
// Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { register } from 'node:module'
import { execFileSync } from 'node:child_process'

const root = new URL('../', import.meta.url).href
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('~~/')) spec = new URL(spec.slice(3) + (spec.endsWith('.json') ? '' : '.ts'), ${JSON.stringify(root)}).href
  else if (spec.startsWith('~/')) spec = new URL('app/' + spec.slice(2) + '.ts', ${JSON.stringify(root)}).href
  const out = await next(spec, ctx)
  return out.url.endsWith('.json') ? { ...out, importAttributes: { type: 'json' } } : out
}`))

const { setup, buildEnv, parseLogins, slug, envIsIgnored } = await import('../scripts/setup.mjs')
const { starterSeed } = await import('../server/utils/starterSeed.ts')
const { createSqliteStore } = await import('../server/utils/sqliteStore.ts')
const repo = new URL('../', import.meta.url).pathname
const tmp = () => mkdtempSync(join(tmpdir(), 'setup-'))
const unquote = (v: string) => v.replace(/^"(.*)"$/, '$1')
const envOf = (dir: string) => Object.fromEntries(readFileSync(join(dir, '.env'), 'utf8').split('\n').filter(l => /^[A-Z]/.test(l)).map(l => [l.slice(0, l.indexOf('=')), unquote(l.slice(l.indexOf('=') + 1))]))

test('--yes writes .env (mode 600) and an empty access.json, and asks nothing', async () => {
  const dir = tmp()
  const lines = await setup(['--dir', dir, '--yes', '--login', 'Ada-L', '--name', 'Ada Lovelace'])
  const env = envOf(dir)
  assert.equal(env.NUXT_BOARD_BACKEND, 'reference')
  assert.equal(env.NUXT_ALLOWED_LOGINS, 'Ada-L')
  assert.equal(env.NUXT_PUBLIC_BOARD_OWNER, 'person:ada-lovelace')
  assert.equal(env.NUXT_PUBLIC_BOARD_OWNER_NAME, 'Ada Lovelace')
  assert.match(env.NUXT_SESSION_PASSWORD, /^[0-9a-f]{64}$/)
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.data', 'access.json'), 'utf8')), { agents: [] })
  assert.ok(lines.some(l => /OAuth/.test(l)), 'tells the user the GitHub app is still to do')
  assert.ok(!lines.join('\n').includes(env.NUXT_SESSION_PASSWORD), 'never prints the secret')
  rmSync(dir, { recursive: true })
})

test('each run makes a different session password', async () => {
  const a = tmp(); const b = tmp()
  await setup(['--dir', a, '--yes', '--login', 'x']); await setup(['--dir', b, '--yes', '--login', 'x'])
  assert.notEqual(envOf(a).NUXT_SESSION_PASSWORD, envOf(b).NUXT_SESSION_PASSWORD)
  rmSync(a, { recursive: true }); rmSync(b, { recursive: true })
})

test('an existing .env is left alone without --force, and replaced with it', async () => {
  const dir = tmp()
  writeFileSync(join(dir, '.env'), 'KEEP=me\n')
  await assert.rejects(setup(['--dir', dir, '--yes', '--login', 'x']), /already exists/)
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'KEEP=me\n')
  await setup(['--dir', dir, '--yes', '--login', 'x', '--force'])
  assert.match(readFileSync(join(dir, '.env'), 'utf8'), /NUXT_BOARD_BACKEND=reference/)
  rmSync(dir, { recursive: true })
})

test('it refuses to write .env where git would track it', async () => {
  const dir = tmp()
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
  await assert.rejects(setup(['--dir', dir, '--yes', '--login', 'x']), /does not ignore \.env/)
  assert.equal(existsSync(join(dir, '.env')), false)
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.env\n')
  assert.equal(envIsIgnored(dir), true)
  rmSync(dir, { recursive: true })
})

test('this repo ignores .env and .data', () => {
  const lines = readFileSync(join(repo, '.gitignore'), 'utf8').split('\n').map(l => l.trim())
  assert.ok(lines.includes('.env') && lines.includes('.data'))
  assert.equal(envIsIgnored(repo), true)
})

test('logins and names are checked', async () => {
  assert.deepEqual(parseLogins('a, b-c'), ['a', 'b-c'])
  assert.throws(() => parseLogins(''), /at least one/)
  assert.throws(() => parseLogins('bad login'), /not a GitHub login/)
  assert.throws(() => parseLogins('-x'), /not a GitHub login/)
  assert.equal(slug('  Ada  Lovelace! '), 'ada-lovelace')
  assert.throws(() => buildEnv({ logins: ['x'], name: '.-.', secret: 'a'.repeat(32) }), /letter or digit/)
  assert.throws(() => buildEnv({ logins: ['x'], name: 'x', secret: 'short' }), /32 characters/)
  await assert.rejects(setup(['--dir', tmp(), '--yes']), /at least one GitHub login/)
})

test('the starter seed has the column presets and nothing else', async () => {
  const seed = starterSeed()
  assert.deepEqual([seed.tasks.length, seed.steps.length, seed.notes.length, seed.registry.length], [0, 0, 0, 0])
  assert.ok(seed.columns.length >= 4)
  assert.ok(!/meshach/i.test(JSON.stringify(seed)))
  const dir = tmp()
  const store = createSqliteStore({ file: join(dir, 'b.sqlite'), accessFile: join(dir, 'a.json'), seed: starterSeed })
  const board = await store.read()
  assert.deepEqual([board.tasks.length, board.columns.length], [0, seed.columns.length])
  rmSync(dir, { recursive: true })
})

test('the install files carry no personal data', () => {
  for (const f of ['Dockerfile', 'compose.yml', '.dockerignore', 'README.md', 'scripts/setup.mjs']) {
    assert.ok(!/meshach/i.test(readFileSync(join(repo, f), 'utf8')), f)
  }
  assert.ok(/env_file: \.env/.test(readFileSync(join(repo, 'compose.yml'), 'utf8')), 'secrets come from .env, not the compose file')
  assert.ok(/^\.env$/m.test(readFileSync(join(repo, '.dockerignore'), 'utf8')), '.env stays out of the image')
})

test('the .env reads back through the shell, with a name that has spaces', async () => {
  const dir = tmp()
  await setup(['--dir', dir, '--yes', '--login', 'x', '--name', "Ada O'Neil Lovelace"])
  const out = execFileSync('sh', ['-c', '. ./.env && printf %s "$NUXT_PUBLIC_BOARD_OWNER_NAME|$NUXT_PUBLIC_BOARD_OWNER"'], { cwd: dir }).toString()
  assert.equal(out, "Ada O'Neil Lovelace|person:ada-o-neil-lovelace")
  assert.throws(() => buildEnv({ logins: ['x'], name: 'bad"name$(x)', secret: 'a'.repeat(32) }), /letters, digits/)
  rmSync(dir, { recursive: true })
})
