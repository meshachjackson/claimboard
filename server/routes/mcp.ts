// /mcp: the agent contract over MCP (streamable HTTP, stateless), one tool per op.
// Same handlers and the same bearer token as /api/agent/:op. A new server per request keeps no state.
import { waitUntil } from '@vercel/functions'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { DOOR_INSTRUCTIONS, DOOR_OPS, doorTools, isDoorId } from '../utils/door'
import { resolveOp } from '../../shared/verbs'
import { agentInstructionsFor, agentToolsFor } from '../../shared/features'

export default defineEventHandler(async (event) => {
  const bearer = bearerToken(event)
  // Sealed (vc1.) tokens come from the OAuth sign-in: unseal to the board token and send that on, as for a Phase A caller.
  // A sealed token that is expired, forged or for another resource is a 401, so Claude refreshes or signs in again.
  // Sealed tokens and doors belong to the orchestrator feature (shared/features.ts). With it off, only a plain board token works.
  const orchestrator = orchestratorOn()
  const sealed = orchestrator && bearer.startsWith(SEAL_PREFIX)
  const grant = sealed ? readAccess(bearer, mcpResource(event), connectorSealKey(), nowSeconds()) : null
  const token = grant ? grant.board_token : bearer.startsWith(SEAL_PREFIX) ? '' : bearer
  if (!token) {
    // RFC 9728: tell Claude where the protected resource metadata is, so it can start the OAuth flow. No connector, no hint.
    if (orchestrator) setResponseHeader(event, 'WWW-Authenticate', `Bearer resource_metadata="${publicOrigin(event)}/.well-known/oauth-protected-resource"`)
    throw createError({ statusCode: 401, statusMessage: 'Authorization: Bearer <token> is required' })
  }
  // Stateless: no session stream to open (GET) or close (DELETE).
  if (event.method !== 'POST') throw createError({ statusCode: 405, statusMessage: 'POST only' })

  // A door is the owner through this Claude account: it sees only the ask, read and message
  // tools, and instructions to relay his words to the orchestrator and its answer back, word for word. The gateway enforces the same list.
  const door = !!grant && isDoorId(grant.agent_id)
  const tools = door ? doorTools(AGENT_TOOLS) : agentToolsFor(AGENT_TOOLS, orchestrator)
  const instructions = door ? DOOR_INSTRUCTIONS : agentInstructionsFor(VERA_INSTRUCTIONS.split('\n'), orchestrator)
  const server = new Server({ name: 'orchestrator', version: '2.2.0' }, { capabilities: { tools: {} }, instructions })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    // A door is checked on the wire op a name resolves to, so old names and verbs cannot widen it (comment with a step_id is add_note: refused).
    const wire = resolveOp(req.params.name, req.params.arguments ?? {}, 'agent')
    if (door && !(wire.ok && (DOOR_OPS as readonly string[]).includes(wire.op))) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, reason: `${req.params.name} is not open to this account; ask the orchestrator instead` }) }], isError: true }
    }
    try {
      const result = await runAgentOp(req.params.name, req.params.arguments ?? {}, token, !!grant)
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: result.ok === false }
    } catch (err) {
      const message = (err as { statusMessage?: string }).statusMessage ?? 'board error'
      // The error is answered as text below, so Nitro's error hook never sees it: log a fault (not a refusal) here.
      const status = (err as { statusCode?: number }).statusCode ?? 500
      if (status >= 500) waitUntil(logError({ source: 'mcp', message: `${req.params.name}: ${message}`, path: '/mcp', status }))
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, reason: message }) }], isError: true }
    }
  })

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  await transport.handleRequest(event.node.req, event.node.res, await readBody(event))
  await server.close()
})
