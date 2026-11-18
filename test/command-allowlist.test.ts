// (F6): every command form the Done when lines of docs/linear-templates/ use is allowed for the builder and the verifier.
// failed three times on a check the verifier was not allowed to run. If you add a command form to a template's Done when line,
// the tests pick it up on their own (they read the templates) and fail until the allow lists cover it. If you remove a pattern from an allow list in
// scripts/linear-run.mjs or scripts/board-run.mjs, the "allowed" tests fail for the forms that needed it.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let r: any
before(async () => { r = await import('../scripts/linear-run.mjs') })

const DIR = join(import.meta.dirname, '..', 'docs', 'linear-templates')

// A command form, as a template writes it. Each must match a `Bash(...)` pattern for both agents: the Grep tool does not stand in for a shell grep.
// EXTRA lists forms the scan below cannot find (a pipe segment, or text outside Done when).
type Form = { cmd: string }
const EXTRA = ['sort -u', 'env -u NIMBLE_API_KEY .venv/bin/pytest tests/ -q']
const asForm = (cmd: string): Form => ({ cmd })

/** Does one Claude permission pattern such as `Bash(npm test*)` allow this command? `*` matches anything. */
function matches(pattern: string, cmd: string): boolean {
  const m = pattern.match(/^Bash\((.*)\)$/)
  if (!m) return false
  return new RegExp('^' + m[1].split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(cmd)
}
/** The forms an allow list does not cover. */
const missing = (allow: string[]) => forms().filter(f => !allow.some(p => matches(p, f.cmd))).map(f => f.cmd)

const AUTHORITY = { default_tier: 'live', tiers: { live: { push_branch: true, open_pr: true, merge: false, deploy: false, merge_requires: [] } }, repos: {}, limits: {} }
function lists() {
  const builder: string[] = r.toolLists(AUTHORITY, 'agent-board').allow
  const args: string[] = r.verifierArgs({ worktree: '/w', maxUsd: 1, extraDirs: [] })
  const verifier = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'))
  return { builder, verifier }
}

/** Command-looking backtick spans in the Done when sections of every template file (placeholders skipped). */
function doneWhenCommands(): string[] {
  const out: string[] = []
  for (const file of readdirSync(DIR).filter(f => f.endsWith('.md'))) {
    let inDone = false
    for (const line of readFileSync(join(DIR, file), 'utf8').split('\n')) {
      if (/^#{1,6}\s/.test(line)) inDone = /^#{1,6}\s+Done when\s*$/.test(line)
      else if (inDone && !line.includes('{{')) for (const m of line.matchAll(/`([^`]+)`/g)) out.push(m[1])
    }
  }
  // Also the command in the blocked-report example, which is not under a Done when heading.
  out.push(...(readFileSync(join(DIR, 'comment-blocked-report.md'), 'utf8').match(/`(env -u [^`]+)`/g) ?? []).map(s => s.slice(1, -1)))
  return out.filter(c => /^(npm|pnpm|node|git|grep|env|python3|pytest|\.venv)\b/.test(c))
}

/** Every form: what the templates use plus EXTRA. A pipeline is split at " | " so each program is checked on its own. */
function forms(): Form[] {
  const seen = doneWhenCommands()
  assert.ok(seen.length >= 8, `found only ${seen.length} commands; did the template layout change?`)
  return [...new Set([...seen, ...EXTRA].flatMap(c => c.split(' | ')))].map(asForm)
}

test('the builder is allowed every command form', () => {
  assert.deepEqual(missing(lists().builder), [])
})

test('the verifier is allowed every command form', () => {
  assert.deepEqual(missing(lists().verifier), [])
})

test('removing the pattern a command form needs makes this test fail (builder and verifier)', () => {
  const { builder, verifier } = lists()
  for (const [who, allow] of [['builder', builder], ['verifier', verifier]] as const) {
    for (const f of forms()) {
      // Take out every entry that lets this form through.
      const without = allow.filter(p => !matches(p, f.cmd))
      assert.ok(missing(without).includes(f.cmd), `${who}: "${f.cmd}" stays allowed after its pattern is removed, so the test would not notice`)
    }
  }
})

test('the matcher is exact enough: a near miss is refused', () => {
  assert.ok(matches('Bash(npm test*)', 'npm test'))
  assert.ok(!matches('Bash(npm test*)', 'npm run test'))
  assert.ok(!matches('Bash(npm run *)', 'npm run'))
})
