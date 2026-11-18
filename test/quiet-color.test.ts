// Quiet status color (UX Phase 6): on a card, only Needs you, Blocked and Working use color; every other state is neutral.
// "Neutral" means the pill and dot draw only from the gray tokens. The colored states are the allowlist below.
import test from 'node:test'
import assert from 'node:assert/strict'
import { WORK_STATE_PILLS, OPEN_PILL, STEP_STATE_DOTS, STATE_FILTER_DOTS } from '../app/types/board.ts'

/** Tokens that are gray, white or ink. Anything else in a style counts as color. */
const NEUTRAL = /^(var\(--ab-neutral-(bg|dot|strong|soft)\)|var\(--color-(text2|text3|dash|surface|ink|chip|line)\)|#FFFFFF|none)$/

/** Every var(...) or hex in a CSS value, e.g. a border shorthand. */
const parts = (css: string) => css.match(/var\([^)]*\)|#[0-9A-Fa-f]{3,8}/g) ?? []
const isNeutral = (css: string) => parts(css).every(p => NEUTRAL.test(p))

// The states allowed color, by the word the card prints. Step states map to the same three families:
// dispatched is Working, needs_input is Needs you, failed is Blocked.
const COLORED_WORK_STATES = ['in_progress', 'needs_input', 'blocked']
const COLORED_STEP_STATES = ['dispatched', 'needs_input', 'failed']

test('pills: only Working, Needs you and Blocked carry color', () => {
  for (const [state, p] of Object.entries(WORK_STATE_PILLS)) {
    const quiet = [p.bg, p.fg, p.dot, p.border].every(isNeutral)
    assert.equal(quiet, !COLORED_WORK_STATES.includes(state), `${state} ("${p.label}") should be ${COLORED_WORK_STATES.includes(state) ? 'colored' : 'neutral'}`)
  }
  assert.ok([OPEN_PILL.bg, OPEN_PILL.fg, OPEN_PILL.dot, OPEN_PILL.border].every(isNeutral), 'Open to any agent is neutral')
})

test('step chips: only dispatched, needs_input and failed carry color', () => {
  for (const [state, dot] of Object.entries(STEP_STATE_DOTS)) {
    assert.equal(isNeutral(dot), !COLORED_STEP_STATES.includes(state), `step ${state} dot ${dot}`)
  }
})

test('filter panel state dots follow the same rule', () => {
  for (const [state, dot] of Object.entries(STATE_FILTER_DOTS)) {
    if (!dot) continue // '' draws a hollow ring
    assert.equal(isNeutral(dot), !COLORED_WORK_STATES.includes(state), `filter dot ${state}`)
  }
})
