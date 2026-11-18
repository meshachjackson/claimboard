// Dev-only sign-in as the first allowed login (NUXT_ALLOWED_GITHUB_LOGIN, then NUXT_ALLOWED_LOGINS), for running the board before the GitHub OAuth app exists.
// Needs `pnpm dev` and NUXT_DEV_LOGIN=1. A production build always answers 404 here.
export default defineEventHandler(async (event) => {
  const { devLogin } = useRuntimeConfig()
  const login = allowedLogins()[0]
  // Nitro parses env values, so NUXT_DEV_LOGIN=1 arrives as the number 1.
  if (!import.meta.dev || String(devLogin) !== '1' || !login) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  await setUserSession(event, {
    user: { login, name: `${login} (dev)`, avatarUrl: '' }
  })
  return sendRedirect(event, takeReturnTo(event))
})
