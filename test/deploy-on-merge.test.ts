// The post-merge sentence: what a merge ships in a repo, and "merged, not deployed" when nothing does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { authorityPath, INSTANCE_PATH, deployNote, loadAuthority, repoTier } from '../scripts/lib/authority.mjs'

const A = {
  deploy_on_merge: {
    site: { ships: 'the production site, built by Vercel from main', watch: 'https://vercel.example/site/deployments' },
    lib: { ships: null, gap: 'Nothing deploys on merge.' },
    odd: { ships: '  ' },
  },
}

test('a repo with a deploy path says what ships and what to watch', () => {
  assert.equal(deployNote(A, 'site'), 'Merged. On merge this repo ships: the production site, built by Vercel from main. Watch: https://vercel.example/site/deployments')
  // A trailing period in the config does not double up.
  assert.equal(deployNote({ deploy_on_merge: { x: { ships: 'a build.', watch: 'a page' } } }, 'x'), 'Merged. On merge this repo ships: a build. Watch: a page')
})

test('a repo with no deploy path says merged, not deployed, with its gap', () => {
  assert.equal(deployNote(A, 'lib'), 'Merged, not deployed. Nothing deploys on merge.')
  assert.equal(deployNote(A, 'odd'), 'Merged, not deployed.')
})

test('a repo with no entry, or a bad one, never stays silent', () => {
  assert.match(deployNote(A, 'unlisted'), /^Merged, not deployed\./)
  assert.match(deployNote({}, 'site'), /^Merged, not deployed\./)
  assert.match(deployNote({ deploy_on_merge: { x: 'text' } }, 'x'), /^Merged, not deployed\./)
})

test('every repo in an early-dev tier has a deploy_on_merge entry, and the entries add no tier change', () => {
  const a = loadAuthority()
  const early = Object.keys(a.repos).filter(r => !r.startsWith('_') && ['early-dev', 'early-dev-no-checks'].includes(repoTier(a, r)))
  // A deployment's checkout pins its own list; only the public example is checked by name.
  if (authorityPath() !== INSTANCE_PATH) assert.deepEqual(early.sort(), ['example-sandbox'])
  for (const r of early) {
    const e = a.deploy_on_merge[r]
    assert.ok(e && ('ships' in e), `${r} needs a deploy_on_merge entry`)
    assert.ok(e.ships === null ? e.gap : e.watch, `${r} needs a gap (no deploy) or a watch hint (deploy)`)
    assert.match(deployNote(a, r), /^Merged/)
  }
})

test('the runner and the authority loader call no deploy command', () => {
  for (const f of ['../scripts/linear-run.mjs', '../scripts/lib/authority.mjs']) {
    const text = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /vercel (deploy|--prod)|gh workflow run/)
  }
})
