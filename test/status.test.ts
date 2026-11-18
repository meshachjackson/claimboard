// Header status mappers. Run with `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildState, parseDeploy, parsePrs } from '../shared/status.ts'

test('Vercel states fold into building, ready, error and canceled', () => {
  assert.equal(buildState('READY'), 'ready')
  assert.equal(buildState('ERROR'), 'error')
  assert.equal(buildState('CANCELED'), 'canceled')
  for (const s of ['BUILDING', 'QUEUED', 'INITIALIZING', undefined]) assert.equal(buildState(s), 'building')
})

test('the first deployment becomes the header value', () => {
  const body = { deployments: [{ url: 'board-example.vercel.app', readyState: 'READY', created: 1793181900000, meta: { githubCommitRef: 'main', githubCommitSha: 'e9ca7419f0' } }] }
  assert.deepEqual(parseDeploy(body), {
    state: 'ready',
    url: 'https://board-example.vercel.app',
    createdAt: '2026-10-28T10:05:00.000Z',
    branch: 'main',
    sha: 'e9ca741'
  })
})

test('no deployment, or a bad answer, gives null', () => {
  assert.equal(parseDeploy({ deployments: [] }), null)
  assert.equal(parseDeploy(null), null)
  assert.equal(parseDeploy({ error: { code: 'forbidden' } }), null)
})

test('the PR count links to the repo, and a bad answer gives null', () => {
  assert.deepEqual(parsePrs({ total_count: 3 }, 'meshachjackson/agent-board'), { open: 3, url: 'https://github.com/meshachjackson/agent-board/pulls' })
  assert.equal(parsePrs({ message: 'Bad credentials' }, 'x/y'), null)
  assert.equal(parsePrs(null, 'x/y'), null)
})
