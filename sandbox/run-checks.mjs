// The runner's test_cmd for the sandbox (gov_config board.runner): runs every sandbox/**/*.check.mjs in its own Node process
// and exits 1 if any fails. Plain Node, no dependencies, so it works on a fresh checkout without pnpm install.
import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(fileURLToPath(import.meta.url))
const found = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (name.endsWith('.check.mjs')) found.push(p)
  }
}
walk(root)

let failed = 0
for (const file of found.sort()) {
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' })
  console.log((r.status === 0 ? 'ok   ' : 'FAIL ') + file.slice(root.length + 1))
  if (r.status !== 0) failed++
}
console.log(failed ? `${failed} of ${found.length} checks failed` : `all ${found.length} checks passed`)
process.exit(failed ? 1 : 0)
