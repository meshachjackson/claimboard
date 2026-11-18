// Preloaded by `pnpm test` (node --import). Clears the settings an instance sets in its shell, so the suite
// gives the same result on any machine, with or without an owner's environment.
for (const k of Object.keys(process.env)) {
  if (/^(NUXT_|BOARD_|AUTHORITY_FILE$|OS_CONF$|LINEAR_)/.test(k)) delete process.env[k]
}
