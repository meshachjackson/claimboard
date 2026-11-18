// Reads the authority file: what agents may do without the owner, per repo tier.
// Which file: AUTHORITY_FILE if set, else instance/authority.json when it exists, else config/authority.example.json.
// The file is read fresh on every call to loadAuthority, so an edit takes effect on the next decision.
// Anything the file does not clearly allow is refused. Node built-ins only.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REPO_ROOT } from './paths.mjs'

export const INSTANCE_PATH = resolve(REPO_ROOT, 'instance/authority.json')
export const EXAMPLE_PATH = resolve(REPO_ROOT, 'config/authority.example.json')

/** The file in use, as a plain path. Worked out on every call. A relative AUTHORITY_FILE is taken from the repo root. */
export function authorityPath(env = process.env) {
  if (env.AUTHORITY_FILE) return resolve(REPO_ROOT, env.AUTHORITY_FILE)
  return existsSync(INSTANCE_PATH) ? INSTANCE_PATH : EXAMPLE_PATH
}

/** The actions a tier can allow. */
export const ACTIONS = ['push_branch', 'open_pr', 'merge', 'deploy']

/** Parse the settings file. Throws on a missing or broken file, so a caller never runs on guessed settings. */
export function loadAuthority(path = authorityPath()) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** The tier for a repo folder name. An unlisted repo gets default_tier; with no default, the strictest sense applies: 'live'. */
export function repoTier(authority, repo) {
  const listed = authority.repos?.[repo]
  if (typeof listed === 'string' && !repo.startsWith('_')) return listed
  return authority.default_tier ?? 'live'
}

/** May an agent take this action in this repo? Only an explicit true in the repo's tier allows it. */
export function may(authority, repo, action) {
  if (!ACTIONS.includes(action)) return false
  return authority.tiers?.[repoTier(authority, repo)]?.[action] === true
}

/** What must be true before a merge in this repo, for example ['checks_pass', 'verifier_pass']. */
export function mergeRequires(authority, repo) {
  return authority.tiers?.[repoTier(authority, repo)]?.merge_requires ?? []
}

/** A copy of the settings with these actions (push_branch, open_pr, merge, ...) set to false in every tier. */
export function withTiersOff(authority, actions) {
  const off = Object.fromEntries(actions.map(a => [a, false]))
  return { ...authority, tiers: Object.fromEntries(Object.entries(authority.tiers ?? {}).map(([k, t]) => [k, { ...t, ...off }])) }
}

/** Is this kind of decision reserved for the owner? Unknown kinds are reserved too, unless the architect list names them. */
export function needsMeshach(authority, decision) {
  if ((authority.always_owner ?? []).includes(decision)) return true
  return !(authority.architect_may_decide ?? []).includes(decision)
}

/**
 * What a merge to main ships in this repo, as one plain sentence for the Linear comment. It only describes: nothing here runs
 * a deploy, and a tier's `deploy: true` does not make the runner deploy. The text comes from the `deploy_on_merge` map:
 * a repo with `ships` (and `watch`) is described as shipping; a repo with `ships: null`, or no entry, is "merged, not deployed".
 */
export function deployNote(authority, repo) {
  const entry = authority.deploy_on_merge?.[repo]
  if (!entry || typeof entry !== 'object' || repo.startsWith('_')) return 'Merged, not deployed. No deploy path is recorded for this repo.'
  if (typeof entry.ships !== 'string' || !entry.ships.trim()) return `Merged, not deployed.${entry.gap ? ` ${entry.gap}` : ''}`
  return `Merged. On merge this repo ships: ${entry.ships.trim().replace(/\.$/, '')}.${entry.watch ? ` Watch: ${entry.watch.trim()}` : ''}`
}
