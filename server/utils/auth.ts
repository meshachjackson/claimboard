// GitHub logins that may use the board: NUXT_ALLOWED_GITHUB_LOGIN and the comma-separated NUXT_ALLOWED_LOGINS. Both unset lets nobody in.
import type { H3Event } from 'h3'
import { loginAllowed, parseLogins } from './logins.ts'

/** Every login on the list, so the dev sign-in can use the first. */
export function allowedLogins(): string[] {
  const { allowedGithubLogin, allowedLogins } = useRuntimeConfig()
  return parseLogins(allowedGithubLogin, allowedLogins)
}

export function isAllowedLogin(login: string | undefined): boolean {
  return loginAllowed(login, allowedLogins())
}

/** 401 without a session, 403 for a session that isn't the allowed login. */
export async function requireAllowedUser(event: H3Event) {
  const { user } = await requireUserSession(event)
  if (!isAllowedLogin(user.login)) {
    throw createError({ statusCode: 403, statusMessage: 'Not allowed' })
  }
  return user
}

// The consent page (/oauth/authorize) is the one page sign-in returns to: Claude is waiting on its query.
// The app's route middleware sets this cookie before sending a signed-out visitor to /login.
const RETURN_COOKIE = 'ab_return_to'

/** Where to land after sign-in: the saved consent URL, or the board. Only /oauth/authorize is honored. */
export function takeReturnTo(event: H3Event): string {
  const saved = getCookie(event, RETURN_COOKIE) ?? ''
  deleteCookie(event, RETURN_COOKIE, { path: '/' })
  return saved.startsWith('/oauth/authorize?') ? saved : '/'
}
