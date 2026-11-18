// Page requests without an allowed session go to /login before the app shell loads.
// Only HTML page loads are checked: scripts and assets stay public, the sign-in pages and
// auth routes must stay reachable, /api/board checks the session itself, and /api/agent and /mcp
// take an agent's bearer token instead. /oauth/authorize is a page, but it
// checks the session itself (the app's route middleware) and keeps Claude's query for the return trip.
const PUBLIC = ['/login', '/not-allowed', '/auth/', '/api/', '/mcp', '/.well-known/', '/oauth/']

export default defineEventHandler(async (event) => {
  if (!getHeader(event, 'accept')?.includes('text/html')) return
  const path = getRequestURL(event).pathname
  if (PUBLIC.some(p => path === p || path.startsWith(p))) return
  const { user } = await getUserSession(event)
  if (!isAllowedLogin(user?.login)) return sendRedirect(event, '/login')
})
