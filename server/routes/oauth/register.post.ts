// POST /oauth/register: RFC 7591 dynamic client registration, stateless. Takes JSON.
// The client id is a sealed copy of the redirect URIs (oauth.ts), so nothing is stored.
export default defineEventHandler(async (event) => {
  const key = connectorSealKey()
  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    setResponseStatus(event, 400)
    return { error: 'invalid_client_metadata', error_description: 'The body must be a JSON object' }
  }
  const metadata = body as Record<string, unknown>
  const client = registerClient(metadata.redirect_uris, key)
  if ('error' in client) {
    setResponseStatus(event, 400)
    return { error: 'invalid_redirect_uri', error_description: client.error }
  }
  setResponseStatus(event, 201)
  return {
    client_id: client.client_id,
    client_id_issued_at: nowSeconds(),
    redirect_uris: client.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // public client, whatever was asked for
    ...(typeof metadata.client_name === 'string' ? { client_name: metadata.client_name.slice(0, 100) } : {})
  }
})
