// Every page needs a session except the sign-in pages. /api/board checks the session on its own.
const PUBLIC = ['/login', '/not-allowed']

export default defineNuxtRouteMiddleware((to) => {
  if (PUBLIC.includes(to.path)) return
  const { loggedIn } = useUserSession()
  if (loggedIn.value) return
  // Claude waits on the consent page's query, so sign-in comes back to it (server/utils/auth.ts takeReturnTo).
  if (to.path === '/oauth/authorize') useCookie('ab_return_to', { path: '/', maxAge: 600, sameSite: 'lax' }).value = to.fullPath
  return navigateTo('/login')
})
