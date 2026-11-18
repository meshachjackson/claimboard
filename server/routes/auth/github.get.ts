// GitHub OAuth. Only an allowed login gets a session; everyone else lands on /not-allowed.
export default defineOAuthGitHubEventHandler({
  async onSuccess(event, { user }) {
    if (!isAllowedLogin(user.login)) {
      await clearUserSession(event)
      return sendRedirect(event, '/not-allowed')
    }
    await setUserSession(event, {
      user: { login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url }
    })
    return sendRedirect(event, takeReturnTo(event))
  },
  onError(event, error) {
    console.error('[auth] GitHub OAuth failed:', error.message)
    return sendRedirect(event, '/login?error=github')
  }
})
