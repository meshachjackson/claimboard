// Template files vs the parser (F3).
// Reads every file in docs/linear-templates/. Each template file has a body block and a filled example block (both ```md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { doneWhen } from '../scripts/linear-run.mjs'

const DIR = join(import.meta.dirname, '..', 'docs', 'linear-templates')
const OPEN = '{'.repeat(2) // two opening curly braces, built here so this file never holds the bare pair
// The five agent templates share one Rules block. Decision needed has its own, so it is left out of that comparison.
const SAME_RULES = ['build-task', 'bug-fix', 'docs-only-task', 'follow-up', 'agent-or-backend-test']
const BULLETS = ['-', '*']
const hasPlaceholder = (text: string) => text.includes(OPEN)

const files = readdirSync(DIR).filter(n => n.endsWith('.md'))
const templates = files.filter(n => n !== 'README.md' && !n.startsWith('comment-'))
const blocksOf = (text: string): string[] => [...text.matchAll(/^```md\n([\s\S]*?)\n```/gm)].map(m => m[1]!)
const read = (f: string) => readFileSync(join(DIR, f), 'utf8')
/** Rewrite every list bullet to `b` so both stored forms (Linear keeps `*`) are checked alike. */
const withBullet = (text: string, b: string) => text.replace(/^(\s*)[-*] /gm, `$1${b} `)
/** The bullet lines under `## Rules` in one block. */
const rulesOf = (block: string): string[] => (block.match(/^## Rules\s*\n((?:[-*] .*\n?)+)/m)?.[1] ?? '').split('\n').filter(l => l.trim())
/** Template names whose Rules lines differ from the first one's. Empty means no drift. */
const rulesDrift = (rules: Record<string, string[]>): string[] => {
  const ref = JSON.stringify(rules[SAME_RULES[0]!])
  return Object.entries(rules).filter(([, r]) => JSON.stringify(r) !== ref).map(([f]) => f)
}

test('the docs/linear-templates folder holds the six templates', () => {
  assert.equal(templates.length, 6, templates.join(', '))
  assert.ok(files.includes('README.md'))
})

for (const b of BULLETS) {
  test(`doneWhen reads every body and example the same way (${b} bullets)`, () => {
    for (const f of templates) {
      const blocks = blocksOf(read(f))
      assert.equal(blocks.length, 2, `${f}: expected a body block and an example block`)
      for (const [i, block] of blocks.entries()) {
        const text = withBullet(block, b)
        const want = [...text.matchAll(/^\* ?\[ \] (.+)$|^- \[ \] (.+)$/gm)].map(m => (m[1] ?? m[2])!.trim())
        assert.ok(want.length > 0, `${f} block ${i + 1}: no checkbox lines`)
        assert.deepEqual(doneWhen(text), want, `${f} block ${i + 1}`)
      }
    }
  })

  test(`the five Rules lines are identical in the five agent templates (${b} bullets)`, () => {
    const rules = Object.fromEntries(SAME_RULES.map(f => [f, rulesOf(withBullet(blocksOf(read(`${f}.md`))[0]!, b))]))
    assert.equal(rules[SAME_RULES[0]!]!.length, 5)
    assert.deepEqual(rulesDrift(rules), [])
    // Every example carries the same lines as its body.
    for (const f of SAME_RULES) {
      const [body, example] = blocksOf(read(`${f}.md`)).map(x => rulesOf(withBullet(x, b)))
      assert.deepEqual(example, body, `${f}: example Rules differ from body Rules`)
    }
  })

  test(`a Rules line that differs between two templates is caught (${b} bullets)`, () => {
    const rules = Object.fromEntries(SAME_RULES.map(f => [f, rulesOf(withBullet(blocksOf(read(`${f}.md`))[0]!, b))]))
    rules['bug-fix']![2] = `${b} Spend is fine.`
    assert.deepEqual(rulesDrift(rules), ['bug-fix'])
  })
}

test('no filled example has a leftover template placeholder', () => {
  for (const f of templates) {
    const example = blocksOf(read(f))[1]!
    assert.ok(!hasPlaceholder(example), `${f}: example still has a placeholder`)
  }
})

test('a leftover placeholder in an example is caught', () => {
  const example = `* **Goal:** ${OPEN}the goal}}\n\n## Done when\n\n* [ ] A holds`
  assert.ok(hasPlaceholder(example))
  assert.ok(!hasPlaceholder('* [ ] A holds'))
})
