// The kanban moved from / to /board when the Floor became home (redesign, 11/1/2026). Old links and saved bookmarks
// that carry board keys (view, col, filters, report…) go to /board with the same keys. The Floor's own keys stay:
// ?task= (the ticket opens over any page) and ?zone= (the phone's chosen zone).
const FLOOR_KEYS = ['task', 'zone']

export default defineNuxtRouteMiddleware((to) => {
  if (to.path !== '/') return
  if (Object.keys(to.query).some(k => !FLOOR_KEYS.includes(k))) return navigateTo({ path: '/board', query: to.query }, { replace: true })
})
