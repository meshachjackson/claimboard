// With the orchestrator feature off, the Claude connector's OAuth routes and consent page answer 404 (shared/features.ts).
// Runs before auth.ts (file order), which lets these paths through.
import { isConnectorPath } from '~~/shared/features'

export default defineEventHandler((event) => {
  if (!orchestratorOn() && isConnectorPath(getRequestURL(event).pathname)) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }
})
