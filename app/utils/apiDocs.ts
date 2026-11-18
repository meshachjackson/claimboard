// The /api page's content: every HTTP route the board serves, who may call it, and what comes back.
// Plain data, no Nuxt imports, so test/api-docs.test.ts can check it against the files in server/ and the page stays dumb.
// When you add a route under server/api or server/routes, add it here; the test fails until you do.

export type ApiAuth = 'session' | 'admin' | 'agent' | 'mcp' | 'none'
export type ApiGroupId = 'board' | 'agent' | 'registry' | 'access' | 'oauth' | 'misc'
export type HttpMethod = 'GET' | 'POST' | 'PUT'

export interface ApiEndpoint {
  method: HttpMethod
  path: string
  group: ApiGroupId
  auth: ApiAuth
  summary: string
  /** What to send: query string or JSON body, in a line or a short example. */
  request?: string
  /** The 200 body, as an example. */
  response?: string
}

export const API_AUTH: Record<ApiAuth, { label: string, help: string }> = {
  session: { label: 'Owner login', help: 'The signed-in browser session (GitHub login on the allowed list). Without one the call answers 401.' },
  admin: { label: 'Admin login', help: 'A signed-in person in the admins group of the access policy.' },
  agent: { label: 'Agent token', help: 'Authorization: Bearer <agent token>. The gateway decides which ops the token may run.' },
  mcp: { label: 'Agent token or OAuth', help: 'Authorization: Bearer <agent token>, or the sealed token Claude gets after the OAuth sign-in.' },
  none: { label: 'Open', help: 'No sign-in. These carry no board data.' }
}

export const API_GROUPS: { id: ApiGroupId, label: string, blurb: string }[] = [
  { id: 'board', label: 'Board (owner)', blurb: 'What the board page calls. Behind the owner login.' },
  { id: 'agent', label: 'Agents', blurb: 'The agent contract. REST and MCP run the same ops with the same token.' },
  { id: 'registry', label: 'Registry', blurb: 'The agent roster and, on a reference install, the approval path for new agents.' },
  { id: 'access', label: 'Access', blurb: 'Groups and who may see or edit which cards.' },
  { id: 'oauth', label: 'Sign-in and OAuth', blurb: 'Login routes and the OAuth pieces Claude uses to connect to /mcp.' },
  { id: 'misc', label: 'Other', blurb: 'Header status and the board manager chat.' }
]

/** The shape every write answers with, shown once above the list. */
export const WRITE_RESULT = `// 200, op ran
{ "ok": true, "op": "add_note", "rows": { "tasks": [], "steps": [], "notes": [ { "note_id": "NTE-NNNNNN", "…": "…" } ] } }

// 200, op refused (a rule, not a failure of the call)
{ "ok": false, "op": "claim_step", "reason": "stale: updated_at is older than the row" }`

export const ERROR_RESULT = `// Any route, when the call itself fails (401 no login or token, 403 not allowed, 404 unknown op, 400 bad body)
{ "statusCode": 403, "statusMessage": "Your groups can see no board" }`

const ROWS = '{ "ok": true, "op": "<op>", "rows": { "tasks": [], "steps": [], "notes": [] } }'
const REASON = '{ "ok": false, "op": "<op>", "reason": "…" }  // when a rule refuses'

export const API_ENDPOINTS: ApiEndpoint[] = [
  // ---- Board (owner) ----
  {
    method: 'GET', path: '/api/board', group: 'board', auth: 'session',
    summary: 'The board: cards, steps, notes, columns and the agent roster. Cached 5 minutes; cut down to the cards your groups may see.',
    request: '?fresh=1 skips the cache (costs one gateway run)',
    response: `{
  "source": "gateway",        // "fixtures" | "gateway" | "reference"
  "writable": true,
  "liveOps": ["update_task", "…"],
  "saved": false,
  "feed": true,               // steps live in Postgres: poll /api/board/feed
  "generated_at": "2026-11-07T14:42:00Z",
  "tasks": [], "steps": [], "notes": [], "columns": [], "registry": []
}`
  },
  {
    method: 'POST', path: '/api/board/:op', group: 'board', auth: 'session',
    summary: 'One board write as the owner. :op is a verb (create, assign, comment, approve, request_changes, archive, split, publish, switch) or a wire op (move_task, update_task, start_task and the rest of OWNER_OPS).',
    request: 'JSON object of the op\'s args, for example { "task_id": "TSK-NNNNNN", "body": "Looks good" } on /api/board/comment',
    response: `${ROWS}\n${REASON}`
  },
  {
    method: 'GET', path: '/api/board/feed', group: 'board', auth: 'session',
    summary: 'Step and note changes since a cursor. Only exists with the Postgres step store on; otherwise 404.',
    request: '?since=<seq> (whole number). Leave it out to replay the last 10 minutes.',
    response: '{ "events": [ { "seq": 41, "task_id": "TSK-NNNNNN", "…": "…" } ], "steps": [], "notes": [] }'
  },
  {
    method: 'GET', path: '/api/board/events', group: 'board', auth: 'session',
    summary: 'Server-sent events. Sends "ready", then "changed" after every board write; the page re-reads /api/board. Local only: 404 on Vercel.',
    response: 'event: changed\ndata: 1762526520000'
  },
  {
    method: 'POST', path: '/api/board/nudge-dispatcher', group: 'board', auth: 'session',
    summary: 'The "Nudge dispatcher" button. Wakes the dispatcher now instead of on its next poll.',
    response: '{ "ok": true, "stamp": "2026-11-07T14:42:03Z" }'
  },
  {
    method: 'POST', path: '/api/board/csv-mapping', group: 'board', auth: 'session',
    summary: 'The CSV import dialog asks the board manager agent for a column mapping.',
    request: '{ "table": [ ["Title", "Priority"], ["Fix header", "high"] ] }  // header row first',
    response: '{ "id": "csv-1a2b3c" }'
  },
  {
    method: 'GET', path: '/api/board/csv-mapping/:id', group: 'board', auth: 'session',
    summary: 'Poll for the agent\'s answer. proposal is null until it answers; 404 when the request is unknown or expired.',
    response: '{ "proposal": null }  // or { "mapping": { "title": "Title", "priority": null }, "notes": "…" }'
  },
  {
    method: 'POST', path: '/api/agent-switches', group: 'board', auth: 'session',
    summary: 'Turn an agent on, off or auto (Settings > Agents).',
    request: '{ "agent_id": "agt-my-agent", "mode": "on" }  // on | auto | off',
    response: '{ "ok": true }'
  },

  // ---- Agents ----
  {
    method: 'POST', path: '/api/agent/:op', group: 'agent', auth: 'agent',
    summary: 'One agent op. Reads: list_claimable, get_task, vera_brief, board_report, board_activity. Writes: claim, heartbeat, comment, complete, block, request_review, split, create. Chat: ask_vera, vera_reply. Older names (claim_step, add_note, complete_step and so on) still work.',
    request: 'JSON object of the op\'s args, for example { "step_id": "STP-NNNNNN", "activity": "Running tests", "updated_at": "…" } on /api/agent/heartbeat. Every write sends the row\'s updated_at as last read; on "stale", call get_task and retry once.',
    response: `${ROWS}\n${REASON}`
  },
  {
    method: 'GET', path: '/api/agent/dispatch', group: 'agent', auth: 'agent',
    summary: 'What the dispatcher polls: the nudge stamp and how many steps are open for each target. Counts only. Class-scoped tokens get 403.',
    response: '{ "ok": true, "nudge": "2026-11-07T14:42:03Z", "targets": { "laptop": 1, "cloud": 0, "actions": 0 } }'
  },
  {
    method: 'GET', path: '/api/agent/events', group: 'agent', auth: 'agent',
    summary: 'Push stream for an agent\'s local listener. The same "changed" signal as /api/board/events; the event carries no rows, so ask list_claimable. Local only: 404 on Vercel.',
    response: 'event: changed\ndata: 1762526520000'
  },
  {
    method: 'GET', path: '/api/agent/csv-mapping', group: 'agent', auth: 'agent',
    summary: 'The board manager agent reads the CSV files waiting for a mapping.',
    response: '{ "fields": [ { "field": "title", "label": "Title" } ], "guidance": "…", "requests": [ { "id": "csv-1a2b3c", "headers": [], "rows": [] } ] }'
  },
  {
    method: 'POST', path: '/api/agent/csv-mapping/:id', group: 'agent', auth: 'agent',
    summary: 'Answer one waiting CSV with a proposed mapping. Nothing is imported; the owner approves in the dialog.',
    request: '{ "mapping": { "title": "Title", "priority": null }, "notes": "Epic column went to project_id" }',
    response: '{ "ok": true }'
  },
  {
    method: 'POST', path: '/mcp', group: 'agent', auth: 'mcp',
    summary: 'The agent contract over MCP (streamable HTTP, stateless): one tool per op, same handlers as /api/agent/:op. POST only; a missing token answers 401 with a WWW-Authenticate header that points Claude at the OAuth metadata.',
    request: 'A JSON-RPC 2.0 MCP message, for example { "jsonrpc": "2.0", "id": 1, "method": "tools/list" }',
    response: '{ "jsonrpc": "2.0", "id": 1, "result": { "tools": [ { "name": "claim", "description": "…", "inputSchema": {} } ] } }'
  },

  // ---- Registry ----
  {
    method: 'GET', path: '/api/registry', group: 'registry', auth: 'session',
    summary: 'The agent roster and its governance tables. Cached 5 minutes.',
    request: '?fresh=1 skips the cache',
    response: '{ "source": "gateway", "registration": false, "generated_at": "…", "registry": [], "access": [], "reviews": [], "history": [], "assets": [], "policy": [], "deployed": {} }'
  },
  {
    method: 'GET', path: '/api/registry/requests', group: 'registry', auth: 'session',
    summary: 'Pending and decided agent requests, newest first. Reference installs only; other installs answer 404 (they use form.gov-register-agent).',
    response: '{ "requests": [ { "request_id": "REQ-1", "agent_id": "agt-new", "name": "New agent", "webhook_url": "…", "classes": ["general"], "status": "pending", "note": "", "requested_by": "person:owner", "created_at": "…", "decided_at": null } ] }'
  },
  {
    method: 'POST', path: '/api/registry/requests', group: 'registry', auth: 'session',
    summary: 'File a request for a new agent. It has no registry row and no token until the owner approves.',
    request: '{ "agent_id": "agt-new", "name": "New agent", "webhook_url": "https://…", "classes": ["general"] }',
    response: '{ "request": { "request_id": "REQ-1", "status": "pending", "…": "…" } }'
  },
  {
    method: 'POST', path: '/api/registry/requests/:id/:decision', group: 'registry', auth: 'session',
    summary: 'Approve or reject a request. :decision is approve or reject; reject needs a note. Approve returns the agent\'s token once; only its SHA-256 is kept.',
    request: '{ "note": "Why, required when rejecting" }',
    response: '{ "request": { "status": "approved", "…": "…" }, "token": "shown once" }'
  },

  // ---- Access ----
  {
    method: 'GET', path: '/api/access', group: 'access', auth: 'session',
    summary: 'Who you are to the access policy. Only admins see the rules; everyone else gets their own id and groups.',
    response: '{ "policy": null, "you": "person:owner", "groups": ["admins"], "admin": true, "boards": [] }'
  },
  {
    method: 'PUT', path: '/api/access', group: 'access', auth: 'admin',
    summary: 'Replace the whole access policy (groups, members, rules). The body is checked before it is saved; a bad one answers 400 with the problem.',
    request: 'The full policy object, as GET /api/access returns it for an admin',
    response: '{ "ok": true }'
  },
  {
    method: 'POST', path: '/api/access/onboard', group: 'access', auth: 'session',
    summary: 'Onboarding\'s last step. Runs once: names the groups and makes the caller the admin. After that, answers 409 and the policy changes through PUT /api/access.',
    request: '{ "groups": [ { "name": "executives", "members": ["person:alex"] } ] }',
    response: '{ "ok": true }'
  },

  // ---- Sign-in and OAuth ----
  {
    method: 'GET', path: '/auth/github', group: 'oauth', auth: 'none',
    summary: 'Starts the GitHub login and returns to the page you came from. A login not on the allowed list lands on /not-allowed.',
    response: '302 redirect'
  },
  {
    method: 'GET', path: '/auth/dev', group: 'oauth', auth: 'none',
    summary: 'Dev-only sign-in as the first allowed login. Needs pnpm dev and NUXT_DEV_LOGIN=1; a production build answers 404.',
    response: '302 redirect'
  },
  {
    method: 'GET', path: '/.well-known/oauth-protected-resource', group: 'oauth', auth: 'none',
    summary: 'RFC 9728 metadata: tells Claude which authorization server protects /mcp. Also served at /.well-known/oauth-protected-resource/mcp.',
    response: '{ "resource": "https://…/mcp", "authorization_servers": ["https://…"] }'
  },
  {
    method: 'GET', path: '/.well-known/oauth-authorization-server', group: 'oauth', auth: 'none',
    summary: 'RFC 8414 metadata: the authorize, token and register URLs.',
    response: '{ "issuer": "https://…", "authorization_endpoint": "https://…/oauth/authorize", "token_endpoint": "https://…/oauth/token", "registration_endpoint": "https://…/oauth/register" }'
  },
  {
    method: 'POST', path: '/oauth/register', group: 'oauth', auth: 'none',
    summary: 'Dynamic client registration (RFC 7591). Answers 201 with a client_id, or 400 invalid_redirect_uri.',
    request: '{ "client_name": "Claude", "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"] }',
    response: '{ "client_id": "…", "client_id_issued_at": 1762526520, "redirect_uris": ["…"], "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"], "token_endpoint_auth_method": "none" }'
  },
  {
    method: 'POST', path: '/oauth/token', group: 'oauth', auth: 'none',
    summary: 'Exchanges an authorization code (with PKCE) or a refresh token for a sealed access token. Form-encoded, as OAuth requires; failures answer 400 with { error, error_description }.',
    request: 'grant_type=authorization_code&code=…&code_verifier=…&client_id=…&redirect_uri=…',
    response: '{ "access_token": "vc1.…", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "vc1.…" }'
  },
  {
    method: 'POST', path: '/api/oauth/consent', group: 'oauth', auth: 'session',
    summary: 'The consent page\'s steps, behind the owner login. step: start lists the identities Claude may sign in as, choose picks one and returns its token hash to file, continue checks the filed token and returns where to send the browser, deny sends it back with access_denied. A refusal answers 200 with ok: false.',
    request: '{ "step": "start" | "choose" | "continue" | "deny", "query": { …the authorize request\'s query… }, "agent_id": "agt-…" }  // agent_id only for choose',
    response: '{ "ok": true, "redirect": "https://claude.ai/…?code=…&state=…" }  // continue and deny\n{ "ok": false, "reason": "This sign-in expired. Start again from Claude." }'
  },

  // ---- Other ----
  {
    method: 'GET', path: '/api/status', group: 'misc', auth: 'session',
    summary: 'The header\'s build and pull request counts. Cached 60 seconds. A service whose env is unset, or that fails, comes back null.',
    response: '{ "deploy": { "state": "ready", "url": "https://…", "createdAt": "…", "branch": "main", "sha": "9ef29e6" }, "prs": { "open": 2, "url": "https://github.com/…/pulls" } }'
  },
  {
    method: 'POST', path: '/api/manager', group: 'misc', auth: 'session',
    summary: 'One turn with the board manager chat (the offline helper). 503 until NUXT_ANTHROPIC_API_KEY is set on the server.',
    request: '{ "messages": [ { "role": "user", "content": "Archive everything done last week" } ] }  // the whole conversation so far',
    response: '{ "reply": "Archived 12 cards.", "actions": [] }'
  }
]

/** The first sentence of a summary, shown under the path while the row is closed. A dot only ends it when a space or the end follows. */
export function leadSentence(summary: string): string {
  const m = /^.*?\.(?=\s|$)/.exec(summary)
  const first = m ? m[0] : summary
  return first.length > 140 ? summary.slice(0, 137).trimEnd() + '…' : first
}

/** Does an endpoint match what the reader typed? Every word must appear in the method, path, auth label or summary. */
export function matchesQuery(e: ApiEndpoint, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${e.method} ${e.path} ${API_AUTH[e.auth].label} ${e.summary}`.toLowerCase()
  return words.every(w => hay.includes(w))
}

/** The first call to try, with this install's address filled in. */
export function quickStartCall(origin: string): string {
  return `curl -X POST ${origin}/api/agent/list_claimable \\
  -H "Authorization: Bearer $AGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{}'`
}

/** Route files the docs do not list, with the reason. The test accepts these and nothing else. */
export const UNDOCUMENTED = [] as const

/** The file a route lives in, as Nitro maps it: server/api/board/[op].post.ts is POST /api/board/:op. */
export function routeOfFile(file: string): { method: string, path: string } | null {
  const m = /^server\/(api|routes)\/(.+?)(?:\.(get|post|put|delete|patch))?\.ts$/.exec(file)
  if (!m) return null
  const [, root, rest, method] = m
  let path = '/' + (root === 'api' ? 'api/' : '') + rest!.replace(/\[([^\]]+)\]/g, ':$1')
  if (path.endsWith('/index')) path = path.slice(0, -'/index'.length) || '/'
  return { method: (method ?? 'POST').toUpperCase(), path }
}
