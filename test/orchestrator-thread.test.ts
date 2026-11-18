// The standing the orchestrator thread helpers: surface prefix, inbox card naming and envelope checks. `pnpm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BODY_LIMIT, boardThreadTag, envelopeProblem, inboxTitle, isBoardThread, isInboxCard, isResetCommand, parseSurface, withSurface } from '../app/utils/orchestratorThread.ts'

test('the surface prefix round-trips', () => {
  for (const surface of ['board', 'telegram', 'slack', 'voice'] as const) {
    assert.deepEqual(parseSurface(withSurface(surface, ' what is next? ')), { surface, text: 'what is next?' })
  }
})

test('a body with no prefix has no surface', () => {
  assert.deepEqual(parseSurface('Here is what I did.'), { surface: '', text: 'Here is what I did.' })
  assert.deepEqual(parseSurface('[email] hi'), { surface: '', text: '[email] hi' })
})

test('a message past the notes cap is refused, not cut', () => {
  assert.throws(() => withSurface('board', 'x'.repeat(BODY_LIMIT)), /cap is 2000/)
  assert.doesNotThrow(() => withSurface('board', 'x'.repeat(BODY_LIMIT - '[board] '.length)))
})

test('inbox cards are found by tag and named by month', () => {
  assert.equal(isInboxCard('a,orchestrator-inbox'), true)
  assert.equal(isInboxCard('orchestrator-inbox-old'), false)
  assert.equal(isInboxCard(undefined), false)
  assert.equal(inboxTitle(new Date(2026, 10, 2)), 'Orchestrator inbox 2026-11')
})

test('envelope checks', () => {
  const ok = { surface: 'telegram', sender: 'person:meshach', text: "what's next?" } as const
  assert.equal(envelopeProblem(ok), '')
  assert.equal(envelopeProblem({ ...ok, sender: 'agt-orchestrator' }), 'sender must be person:<name>')
  assert.equal(envelopeProblem({ ...ok, text: '  ' }), 'message is empty')
  assert.match(envelopeProblem({ ...ok, card: 'TSK-930001' }), /no page context/)
  assert.equal(envelopeProblem({ ...ok, surface: 'board', card: 'TSK-930001', step: 'STP-930001' }), '')
})

test('the reset command is /new or /clear and nothing else', () => {
  for (const t of ['/new', '/clear', ' /NEW ', '/Clear\n']) assert.equal(isResetCommand(t), true, t)
  for (const t of ['/news', 'new', 'please /new', '/new thread', '']) assert.equal(isResetCommand(t), false, t)
})

test('a board thread is a card tagged exactly orchestrator-board', () => {
  assert.equal(boardThreadTag(), 'orchestrator-board')
  assert.equal(isBoardThread('x, orchestrator-board'), true)
  assert.equal(isBoardThread('orchestrator-inbox'), false)
  assert.equal(isBoardThread('orchestrator-board-old'), false)
  assert.equal(isBoardThread(undefined), false)
})
