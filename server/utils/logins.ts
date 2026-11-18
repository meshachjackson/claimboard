// Which GitHub logins may use the board. Pure functions, so tests need no server.

/** The allowed logins from comma-separated settings, lower-cased and de-duplicated. Blank entries are dropped. */
export function parseLogins(...settings: unknown[]): string[] {
  const logins = settings.flatMap(s => String(s ?? '').split(',')).map(s => s.trim().toLowerCase()).filter(Boolean)
  return [...new Set(logins)]
}

/** True when `login` is on the list. GitHub logins are case-insensitive. An empty list lets nobody in. */
export function loginAllowed(login: string | undefined, allowed: string[]): boolean {
  return !!login && allowed.includes(login.toLowerCase())
}
