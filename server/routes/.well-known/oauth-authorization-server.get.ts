// RFC 8414 authorization server metadata for the orchestrator connector.
// Public clients only: PKCE S256, no client secret, codes and refresh tokens.
export default defineEventHandler((event) => {
  const origin = publicOrigin(event)
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true
  }
})
