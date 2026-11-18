// Where the runner keeps its settings folder (kill switch, spend file, logs) and its secrets file.
// Nothing here assumes a machine layout. Set BOARD_RUN_CONF_DIR (and BOARD_SECRETS_FILE if the secrets live elsewhere);
// without them everything stays under ./.data in the checkout. OS_CONF is the older name for BOARD_RUN_CONF_DIR and still works.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** The settings folder: BOARD_RUN_CONF_DIR, then OS_CONF, then <repo>/.data. */
export function confDir(env = process.env) {
  return env.BOARD_RUN_CONF_DIR || env.OS_CONF || join(REPO_ROOT, '.data')
}

/** The file that holds KEY=value secrets for the runner programs: BOARD_SECRETS_FILE, else secrets.env in the settings folder. */
export function secretsFile(env = process.env) {
  return env.BOARD_SECRETS_FILE || join(confDir(env), 'secrets.env')
}
