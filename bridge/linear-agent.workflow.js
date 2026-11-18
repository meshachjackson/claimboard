import { workflow, node, trigger, ifElse, expr, nodeJson, sticky } from '@n8n/workflow-sdk';

// Linear agent bridge. One receiver for every Linear agent app.
// Each Linear app's webhook URL ends in ?agent=<key>, where <key> is a key in bridge/routes.json.
// Order of work: answer 200 -> check signature -> look up route -> first activity -> forward.

// 1. Webhook. responseMode 'onReceived' makes n8n send the 200 the moment the request
//    arrives, before any later node runs. This is what meets Linear's 5 second rule.
//    rawBody keeps the exact bytes, which the signature is computed over.
const linearWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.2,
  config: {
    name: 'Linear Webhook',
    parameters: {
      httpMethod: 'POST',
      path: 'linear-agent',
      authentication: 'none',
      responseMode: 'onReceived',
      options: { rawBody: true },
    },
    position: [240, 300],
  },
  output: [
    {
      headers: { 'linear-signature': 'made-up-hex' },
      query: { agent: 'builder-cloud' },
      body: { action: 'created', webhookTimestamp: 1789000000000, agentSession: { id: 'sample-session-id' } },
    },
  ],
});

// 2. Check the signature and find the route. Secrets and tokens come from environment
//    variables on the droplet, read by name. Nothing secret is stored in this file.
const verifyAndRoute = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Verify and Route',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Needs NODE_FUNCTION_ALLOW_BUILTIN=crypto and env access in the Code node (see README).
const crypto = require('crypto');
const item = $input.first();
const agent = String(item.json.query.agent || '').toLowerCase();
const envKey = agent.toUpperCase().replace(/-/g, '_');
const body = item.json.body || {};
const raw = await this.helpers.getBinaryDataBuffer(0, 'data');

// Signature: hex HMAC-SHA256 of the raw body, in the Linear-Signature header.
// Each Linear app has its own secret. An agent with no route uses the DEFAULT secret.
const secret = $env['LINEAR_WEBHOOK_SECRET_' + envKey] || $env.LINEAR_WEBHOOK_SECRET_DEFAULT || '';
const sent = String(item.json.headers['linear-signature'] || '');
const expected = crypto.createHmac('sha256', secret).update(raw).digest();
const sentBuf = /^[0-9a-f]{64}$/i.test(sent) ? Buffer.from(sent, 'hex') : Buffer.alloc(0);
// timingSafeEqual throws on unequal lengths, so only compare 32 byte values.
const sigOk = Boolean(secret) && sentBuf.length === expected.length && crypto.timingSafeEqual(sentBuf, expected);
// Replay guard: webhookTimestamp (milliseconds) must be within one minute of now.
const fresh = Math.abs(Date.now() - Number(body.webhookTimestamp)) <= 60000;
const sessionId = (body.agentSession && body.agentSession.id) || body.agentSessionId || null;
// Bad signature, stale timestamp or no session: drop. The 200 is already sent.
if (!sigOk || !fresh || !sessionId) { return []; }

// routes.json lives in the LINEAR_BRIDGE_ROUTES environment variable (see README).
const routes = JSON.parse($env.LINEAR_BRIDGE_ROUTES || '{}');
const route = routes[agent] || null;
const query = 'mutation AgentActivityCreate($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }';
const first = body.action === 'prompted' ? 'Follow-up received for ' + agent : 'Queued for ' + agent;
const activity = (content) => ({ query, variables: { input: { agentSessionId: sessionId, content } } });

return [{ json: {
  agent,
  hasRoute: route !== null,
  // laptop-poll agents read Linear themselves, so nothing is forwarded for them.
  forward: route !== null && route.kind !== 'laptop-poll',
  forwardUrl: route ? route.target : '',
  // Use the app's own token when set, even with no route line, else the DEFAULT one.
  tokenEnv: (route || $env['LINEAR_TOKEN_' + envKey]) ? 'LINEAR_TOKEN_' + envKey : 'LINEAR_TOKEN_DEFAULT',
  queuedPayload: activity({ type: 'thought', body: first }),
  errorPayload: activity({ type: 'error', body: 'No route for agent "' + agent + '". Add it to bridge/routes.json.' }),
  event: body,
} }];`,
    },
    position: [540, 300],
  },
  output: [
    {
      agent: 'builder-cloud',
      hasRoute: true,
      forward: true,
      forwardUrl: 'https://example.invalid/hook',
      tokenEnv: 'LINEAR_TOKEN_BUILDER_CLOUD',
      queuedPayload: {},
      errorPayload: {},
      event: {},
    },
  ],
});

// 3. Known agent or not.
const routeFound = ifElse({
  version: 2.3,
  config: {
    name: 'Route Found?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            leftValue: expr('{{ $json.hasRoute }}'),
            operator: { type: 'boolean', operation: 'true', singleValue: true },
            rightValue: '',
          },
        ],
        combinator: 'and',
      },
    },
    position: [840, 300],
  },
});

// 4a. Known agent: first activity ("Queued for ...") must land inside Linear's 10 seconds.
const postQueued = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Post Queued Activity',
    // If Linear's API is slow or down, still forward the event to the host.
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: 'https://api.linear.app/graphql',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('Bearer {{ $env[$json.tokenEnv] }}') }],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json.queuedPayload }}'),
      options: { timeout: 5000 },
    },
    position: [1140, 200],
  },
  output: [{ data: { agentActivityCreate: { success: true } } }],
});

// 5. Forward the original event to the host. laptop-poll agents skip this step.
const needsForward = ifElse({
  version: 2.3,
  config: {
    name: 'Needs Forward?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            leftValue: nodeJson(verifyAndRoute, 'forward'),
            operator: { type: 'boolean', operation: 'true', singleValue: true },
            rightValue: '',
          },
        ],
        combinator: 'and',
      },
    },
    position: [1440, 200],
  },
});

const forwardEvent = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Forward to Host',
    // A dead host must not break the run. Linear already has its first activity.
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: nodeJson(verifyAndRoute, 'forwardUrl'),
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        // The shared secret lets the host tell the bridge from anyone else who finds its URL.
        parameters: [
          { name: 'X-Bridge-Agent', value: nodeJson(verifyAndRoute, 'agent') },
          { name: 'X-Bridge-Secret', value: expr('{{ $env.LINEAR_BRIDGE_FORWARD_SECRET }}') },
        ],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: nodeJson(verifyAndRoute, 'event'),
      options: { timeout: 8000 },
    },
    position: [1740, 100],
  },
  output: [{ ok: true }],
});

// 4b. Unknown agent: one error activity on the session. Never a silent drop.
const postNoRoute = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Post No Route Error',
    parameters: {
      method: 'POST',
      url: 'https://api.linear.app/graphql',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: {
        parameters: [{ name: 'Authorization', value: expr('Bearer {{ $env[$json.tokenEnv] }}') }],
      },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json.errorPayload }}'),
      options: { timeout: 5000 },
    },
    position: [1140, 420],
  },
  output: [{ data: { agentActivityCreate: { success: true } } }],
});

const note = sticky(
  'Draft. Answers Linear at once (Webhook responds on receipt), checks the signature, posts a first activity, then forwards by routing table. See bridge/README.md.',
  [linearWebhook, verifyAndRoute],
  { color: 4 },
);

export default workflow('bridge-linear-agent', 'bridge.linear-agent')
  .add(linearWebhook)
  .to(verifyAndRoute)
  .to(
    routeFound
      .onTrue(postQueued.to(needsForward.onTrue(forwardEvent)))
      .onFalse(postNoRoute),
  )
  .add(note);
