// The changelog lists every PR that changes the board, with steps to try each one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { BASELINE_PR, CHANGELOG, INTERNAL_PRS, missingFromChangelog } from '../app/utils/changelog.ts'

/** PR numbers in the subjects of commits that touched app/, server/ or shared/ ("... (#145)"). */
export function prsInLog(log: string): number[] {
  return [...log.matchAll(/\(#(\d+)\)\s*$/gm)].map(m => Number(m[1])).filter(n => n >= BASELINE_PR)
}

function prsThatTouchedTheBoard(): number[] | null {
  try {
    return prsInLog(execFileSync('git', ['log', '--format=%s', '--', 'app', 'server', 'shared'], { encoding: 'utf8' }))
  } catch {
    return null
  }
}

// Fixture mode: a fixed log, so the check does not depend on this repo's own merged PR numbers.
test('PR numbers are read from commit subjects and the baseline is honored', () => {
  const log = ['Add a thing (#' + BASELINE_PR + ')', 'Old thing (#1)', 'No number here', 'Another (#' + (BASELINE_PR + 7) + ')'].join('\n')
  assert.deepEqual(prsInLog(log), [BASELINE_PR, BASELINE_PR + 7])
  assert.deepEqual(missingFromChangelog(prsInLog(log).map(n => n + 900000)), prsInLog(log).map(n => n + 900000))
})

test('every PR that touched app, server or shared since the baseline has an entry or is internal', (t) => {
  const prs = prsThatTouchedTheBoard()
  // The real-history check applies to the owner's checkout (it has instance/). A public clone or a shallow clone
  // has different or no history, so it skips and the fixture test above covers the logic.
  if (!existsSync(new URL('../instance', import.meta.url))) return t.skip('public clone: no owner history')
  if (!prs?.length) return t.skip('no git history')
  assert.deepEqual(missingFromChangelog(prs), [], 'add these PRs to app/utils/changelog.ts (CHANGELOG, or INTERNAL_PRS with a reason)')
})

test('a PR with no entry is reported as missing', () => {
  assert.deepEqual(missingFromChangelog([CHANGELOG[0]!.pr, 999999]), [999999])
})

const STEP_START = /^(Click|Open|Type|Drag|Press|Run)\b/

test('every entry has the fields and its steps read as click X, expect Y', () => {
  assert.ok(CHANGELOG.length >= 8)
  const seen = new Set<number>()
  for (const e of CHANGELOG) {
    assert.ok(Number.isInteger(e.pr) && e.pr >= BASELINE_PR, `PR ${e.pr}`)
    assert.ok(!seen.has(e.pr), `PR ${e.pr} is listed twice`)
    seen.add(e.pr)
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `PR ${e.pr} date`)
    assert.ok(e.title.trim() && e.summary.trim() && e.where.trim(), `PR ${e.pr} needs a title, summary and where`)
    assert.ok(e.steps.length >= 1 && e.steps.length <= 4, `PR ${e.pr} needs 1 to 4 steps`)
    for (const s of e.steps) {
      assert.ok(s.length <= 160, `PR ${e.pr} step is too long: ${s}`)
      assert.match(s, STEP_START, `PR ${e.pr} step must start with Click, Open, Type, Drag, Press or Run: ${s}`)
      assert.match(s, /Expect/, `PR ${e.pr} step must say what to expect: ${s}`)
    }
  }
  for (const i of INTERNAL_PRS) {
    assert.ok(i.reason.trim(), `internal PR ${i.pr} needs a reason`)
    assert.ok(!seen.has(i.pr), `PR ${i.pr} is both an entry and internal`)
  }
})

test('entries are newest first', () => {
  const key = (e: { date: string, pr: number }) => `${e.date}#${String(e.pr).padStart(6, '0')}`
  const sorted = [...CHANGELOG].sort((a, b) => key(b).localeCompare(key(a)))
  assert.deepEqual(CHANGELOG.map(e => e.pr), sorted.map(e => e.pr))
})
