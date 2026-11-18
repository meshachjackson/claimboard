// RFC 9728 protected resource metadata. /mcp's 401 points here; Claude reads it to find the authorization server.
export default defineEventHandler((event) => {
  const origin = publicOrigin(event)
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    resource_name: 'The orchestrator (agent board)'
  }
})
