// Lets a plain Node 24 script import the app's TypeScript (app/utils/*.ts) the way Nuxt does: "~/" and "~~/" resolve to
// app/ and the repo root, and an import without an extension finds the .ts file. Node strips the types itself.
// Used by scripts/board-cleanup-apply.mjs so the cleanup runs the board's own op rules (app/utils/boardOps.ts).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export async function resolve(specifier, context, next) {
  let path = ''
  if (specifier.startsWith('~~/')) path = join(ROOT, specifier.slice(3))
  else if (specifier.startsWith('~/')) path = join(ROOT, 'app', specifier.slice(2))
  else if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) path = join(dirname(fileURLToPath(context.parentURL)), specifier)
  if (path) {
    for (const p of [path, `${path}.ts`, join(path, 'index.ts')]) {
      if (existsSync(p) && !p.endsWith('/')) {
        if (p.endsWith('.json')) return next(pathToFileURL(p).href, { ...context, importAttributes: { type: 'json' } })
        return next(pathToFileURL(p).href, context)
      }
    }
  }
  return next(specifier, context)
}
