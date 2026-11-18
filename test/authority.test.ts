// The authority loader.
// Mechanics run on an inline fixture, so most edits to the authority file do not break a test.
// The real files are used too: instance/authority.json (when present) and config/authority.example.json. Their client repos must
// refuse everything, and the flip test needs `"default_tier": "live"` to be there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAuthority, repoTier, may, mergeRequires, needsMeshach, ACTIONS, authorityPath, EXAMPLE_PATH, INSTANCE_PATH } from '../scripts/lib/authority.mjs'

const A = {
  default_tier: 'live',
  tiers: {
    'early-dev': { push_branch: true, open_pr: true, merge: true, deploy: true, merge_requires: ['checks_pass', 'verifier_pass'] },
    live: { push_branch: true, open_pr: true, merge: false, deploy: false, merge_requires: [] },
    client: { push_branch: false, open_pr: false, merge: false, deploy: false, merge_requires: [] },
  },
  repos: { _about: 'note', _hidden: 'early-dev', sandbox: 'early-dev', acme: 'client', typo: 'early-dve' },
  architect_may_decide: ['scope', 'naming'],
  always_owner: ['client_data', 'naming'],
}

const INSTANCE = INSTANCE_PATH
// Both real files: the example always, the instance file only on the owner's checkout (the public tree has no instance/).
const REAL_FILES = [['example', EXAMPLE_PATH], ...(existsSync(INSTANCE) ? [['instance', INSTANCE]] : [])] as const

/** Copy the settings file in use into a temp folder and return its path. */
function tempCopyOfRealFile() {
  const path = join(mkdtempSync(join(tmpdir(), 'authority-')), 'authority.json')
  writeFileSync(path, readFileSync(authorityPath(), 'utf8'))
  return path
}

test('an unlisted repo gets default_tier', () => {
  assert.equal(repoTier(A, 'never-heard-of-it'), 'live')
  assert.equal(repoTier({ ...A, default_tier: 'client' }, 'never-heard-of-it'), 'client')
})

test('with no default_tier, an unlisted repo is treated as live', () => {
  assert.equal(repoTier({ ...A, default_tier: undefined }, 'x'), 'live')
})

test('early-dev allows merge and deploy', () => {
  assert.equal(may(A, 'sandbox', 'merge'), true)
  assert.equal(may(A, 'sandbox', 'deploy'), true)
  assert.deepEqual(mergeRequires(A, 'sandbox'), ['checks_pass', 'verifier_pass'])
})

test('live allows open_pr but refuses merge and deploy', () => {
  assert.equal(may(A, 'unlisted', 'open_pr'), true)
  assert.equal(may(A, 'unlisted', 'merge'), false)
  assert.equal(may(A, 'unlisted', 'deploy'), false)
  assert.deepEqual(mergeRequires(A, 'unlisted'), [])
})

test('client refuses every action', () => {
  for (const action of ACTIONS) assert.equal(may(A, 'acme', action), false, action)
})

for (const [name, file] of REAL_FILES) {
  test(`the ${name} settings file loads, has the renamed keys, and keeps its client repos locked out`, () => {
    const real = loadAuthority(file)
    assert.equal(real.default_tier, 'live')
    assert.ok(Array.isArray(real.always_owner) && real.always_owner.length > 0, 'always_owner')
    assert.ok(Array.isArray(real.notify_owner_on), 'notify_owner_on')
    assert.equal('always_meshach' in real || 'notify_meshach_on' in real, false, 'old key names are gone')
    const clients = Object.keys(real.repos).filter(r => real.repos[r] === 'client')
    assert.ok(clients.length > 0, 'a client repo is listed')
    for (const repo of clients) for (const action of ACTIONS) assert.equal(may(real, repo, action), false, `${repo} ${action}`)
  })
}

test('the example file grants merge and deploy only to its own made-up sandbox repo', () => {
  const ex = loadAuthority(EXAMPLE_PATH)
  const open = Object.keys(ex.repos).filter(r => !r.startsWith('_') && (may(ex, r, 'merge') || may(ex, r, 'deploy')))
  assert.deepEqual(open, ['example-sandbox'])
})

test('AUTHORITY_FILE wins; with it unset the instance file is used when present, else the example', () => {
  const dir = mkdtempSync(join(tmpdir(), 'authority-'))
  const mine = join(dir, 'mine.json')
  writeFileSync(mine, JSON.stringify({ default_tier: 'client' }))
  assert.equal(authorityPath({ AUTHORITY_FILE: mine }), mine)
  assert.equal(authorityPath({ AUTHORITY_FILE: 'config/authority.example.json' }), EXAMPLE_PATH)
  assert.equal(loadAuthority(authorityPath({ AUTHORITY_FILE: mine })).default_tier, 'client')
  assert.equal(authorityPath({}), existsSync(INSTANCE) ? INSTANCE : EXAMPLE_PATH)
})

test('an unknown action is refused, even in early-dev', () => {
  assert.equal(may(A, 'sandbox', 'format_disk'), false)
})

test('a key starting with _ is never treated as a repo', () => {
  // _hidden is listed as early-dev but must fall back to default_tier. _about is a string note.
  assert.equal(repoTier(A, '_hidden'), 'live')
  assert.equal(may(A, '_hidden', 'merge'), false)
  assert.equal(repoTier(A, '_about'), 'live')
})

test('an unknown tier name fails closed', () => {
  assert.equal(repoTier(A, 'typo'), 'early-dve')
  for (const action of ACTIONS) assert.equal(may(A, 'typo', action), false, action)
  assert.deepEqual(mergeRequires(A, 'typo'), [])
})

test('needsMeshach: unknown decision is true, scope is false', () => {
  assert.equal(needsMeshach(A, 'something_new'), true)
  assert.equal(needsMeshach(A, 'scope'), false)
})

test('always_owner wins over architect_may_decide', () => {
  assert.equal(needsMeshach(A, 'naming'), true)
  assert.equal(needsMeshach(A, 'client_data'), true)
})

test('changing one line of a temp copy flips may(..., merge), read fresh each time', () => {
  const path = tempCopyOfRealFile()
  const before = loadAuthority(path)
  assert.equal(may(before, 'brand-new-repo', 'merge'), false) // default_tier is live
  const edited = readFileSync(path, 'utf8').replace('"default_tier": "live"', '"default_tier": "early-dev"')
  assert.notEqual(edited, readFileSync(path, 'utf8'), 'the line to edit must exist in the real file')
  writeFileSync(path, edited)
  assert.equal(may(loadAuthority(path), 'brand-new-repo', 'merge'), true)
})

test('a missing or broken file throws instead of guessing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'authority-'))
  assert.throws(() => loadAuthority(join(dir, 'nope.json')))
  const bad = join(dir, 'bad.json')
  writeFileSync(bad, '{ not json')
  assert.throws(() => loadAuthority(bad))
})
