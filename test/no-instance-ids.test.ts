// Guard for the public tree: nothing outside instance/ may carry ticket, ADR or card IDs from a private tracker.
// Synthetic fixtures use the 9xxxxx range (TSK-900001) and are allowed. The patterns below are generic shapes only;
// this file holds no real private value. It is built from pieces so the test source never matches itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('../', import.meta.url).pathname
const SKIP_DIRS = new Set(['instance', 'node_modules', '.git', '.nuxt', '.output', '.claude', '.data', '.vercel', 'dist'])
const SKIP_EXT = /\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip)$/i

const prefix = (...p: string[]) => p.join('')
const RULES: { name: string, re: RegExp }[] = [
  // A card, step or note ID outside the synthetic 9xxxxx range.
  { name: 'card ID outside the synthetic range', re: new RegExp(`\\b(${prefix('T', 'SK')}|${prefix('S', 'TP')}|${prefix('N', 'TE')})-[0-8]\\d{5}\\b`) },
  { name: 'ADR number', re: new RegExp(`\\b${prefix('A', 'DR')} \\d{4}\\b`) },
  { name: 'tracker issue ID', re: new RegExp(`\\b${prefix('M', 'ES')}-\\d+\\b`) },
]

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (st.isFile() && !SKIP_EXT.test(name) && st.size < 2_000_000) yield p
  }
}

/** Returns "path:line rule" for every hit in a text. Exported shape kept simple for the planted-line check. */
export function findHits(path: string, text: string): string[] {
  const out: string[] = []
  text.split('\n').forEach((line, i) => {
    for (const r of RULES) if (r.re.test(line)) out.push(`${path}:${i + 1} ${r.name}`)
  })
  return out
}

/** Tracked files when git is there (so local-only files like .env are not read); a directory walk otherwise. */
function filesToCheck(): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split('\0').filter(f => f && f.split('/')[0] !== 'instance' && !SKIP_EXT.test(f)).map(f => join(root, f)).filter(f => { try { return statSync(f).isFile() } catch { return false } })
  } catch {
    return [...walk(root)]
  }
}

test('no private ticket, ADR or card IDs outside instance/', () => {
  const hits: string[] = []
  for (const f of filesToCheck()) hits.push(...findHits(relative(root, f), readFileSync(f, 'utf8')))
  assert.deepEqual(hits, [], 'remove the ID and keep the explanation, or use a synthetic 9xxxxx ID in a fixture')
})

test('the rules catch a planted ID and let synthetic IDs through', () => {
  assert.equal(findHits('x.ts', `// see ${prefix('M', 'ES')}-123`).length, 1)
  assert.equal(findHits('x.ts', `// per ${prefix('A', 'DR')} 0001`).length, 1)
  assert.equal(findHits('x.ts', `const id = '${prefix('T', 'SK')}-000123'`).length, 1)
  assert.equal(findHits('x.ts', `const id = '${prefix('T', 'SK')}-900001'`).length, 0)
})
