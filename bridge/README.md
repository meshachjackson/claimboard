# Linear agent bridge

Draft n8n workflow for the Linear control plane (`docs/plans/2026-11-12-linear-control-plane.md`, Wave 1 step B). Not created or published on any n8n instance.

## What it does

1. Linear calls `POST /webhook/linear-agent?agent=<key>` when an agent is delegated an issue or mentioned (`AgentSessionEvent`, action `created` or `prompted`).
2. The Webhook node answers 200 on receipt, so Linear gets its reply inside 5 seconds.
3. A Code node checks the `Linear-Signature` header and a one minute replay window, then looks up `<key>` in the routing table.
4. A known agent gets a first `thought` activity ("Queued for <key>") on the session, then the event is forwarded to the host in `bridge/routes.json`. `laptop-poll` agents are not forwarded.
5. An unknown agent gets one `error` activity on the session.

### How the order is guaranteed

The **Linear Webhook** node setting `responseMode: onReceived` makes n8n send the 200 when the request arrives, before any later node runs. The respond step is the first node in the workflow code. A bad signature therefore also gets 200; the run just stops and posts nothing. A mistyped `?agent=` key with no secret of its own fails the signature check the same way, so it is dropped silently.

Adding an agent is one line in `routes.json` (plus its three environment variables below).

## Credentials by name

All are environment variables on the droplet. Names only; no values live in this repo. `<KEY>` is the route key in upper case with `-` as `_`, for example `BUILDER_CLOUD`.

- `LINEAR_WEBHOOK_SECRET_<KEY>`: signing secret of that agent's Linear app webhook.
- `LINEAR_TOKEN_<KEY>`: that app's OAuth access token (installed with `actor=app`).
- `LINEAR_WEBHOOK_SECRET_DEFAULT` and `LINEAR_TOKEN_DEFAULT`: used when the agent key is not in the routing table, so the error activity can still be posted. Use one installed app's values.
- `LINEAR_BRIDGE_ROUTES`: the contents of `routes.json` as one line.
- `LINEAR_BRIDGE_FORWARD_SECRET`: sent to hosts in the `X-Bridge-Secret` header on every forward, so a host can refuse callers that are not the bridge.

## Install steps for Meshach

The exact numbered runbook, with a rollback for every step, is `docs/handoffs/2026-11-13-bridge-go-live.md`. Nothing in it has been run. Every droplet step waits for your go.

### Validation

`validate_workflow` on the `n8n-droplet` MCP server, 11/12/2026 (re-run 11/12/2026 later that day after the fixes below, same result):

```
{"valid":true,"nodeCount":8}
```

Nothing was created, updated, published or executed on the instance.

Changes on 11/13/2026: the signature check no longer throws on a malformed header (`test/bridge.test.ts`), the first activity failing no longer stops the forward, and forwards carry `X-Bridge-Secret`.

## Replay the sample payloads against a test URL

Use the n8n test URL (`/webhook-test/linear-agent`) with the workflow open in the editor. The signature needs a fresh `webhookTimestamp`, so stamp and sign each time. `SECRET` is a throwaway test value that you also set as `LINEAR_WEBHOOK_SECRET_DEFAULT` (or the agent's own variable) on the test instance.

```bash
AGENT=builder-cloud
URL="https://<n8n host>/webhook-test/linear-agent?agent=$AGENT"
node -e 'const p=JSON.parse(require("fs").readFileSync("bridge/sample-agent-session-created.json","utf8"));p.webhookTimestamp=Date.now();process.stdout.write(JSON.stringify(p))' > /tmp/body.json
SIG=$(openssl dgst -sha256 -hmac "$SECRET" -hex < /tmp/body.json | awk '{print $NF}')
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' -X POST "$URL" \
  -H 'Content-Type: application/json' -H "Linear-Signature: $SIG" --data-binary @/tmp/body.json
```

Expect `200` in well under 5 seconds. The sample session id is made up, so Linear will reject the activity call; the run still shows which branch it took. Repeat with `sample-agent-session-prompted.json`, and with `AGENT=nobody` to see the no-route branch. Real activity posting needs a real session from a live delegation.

## What is unverified

Confirmed from Linear's docs on 11/12/2026: header `Linear-Signature` (hex HMAC-SHA256 of the raw body), `webhookTimestamp` in milliseconds with a one minute window, `agentActivityCreate` with `agentSessionId` and `content`, content types `thought`/`error` with a `body`, endpoint `https://api.linear.app/graphql` with `Authorization: Bearer <token>`, 5 second webhook and 10 second first-activity limits.

Not confirmed:

- **Session id location.** The docs name `agentSession` but not `agentSession.id` explicitly. The code reads `agentSession.id`, then `agentSessionId`. The sample payloads follow that guess.
- **Full payload shape.** The docs point to Linear's schema explorer for `AgentSessionEventWebhookPayload`, which was not read. Sample payloads are made up from the prose.
- **Agent identity.** No app user field was found, so the bridge uses the `?agent=` query string instead of reading a name from the payload.
- **Code node limits.** Whether the droplet allows `require('crypto')` and `$env` in the Code node is untested. Both are install step 2.
- **`rawBody`.** The signature uses the Webhook node's raw body binary (`data`). Untested on the droplet.
- **Unknown-agent error.** It is posted with the DEFAULT app's token. Linear may refuse a session that belongs to a different app.
- **Time.** No run was made, so the 5 and 10 second budgets are by design, not measured.
- **Loops.** Whether a Loop can delegate to a third-party agent is outside this step.
- **Task runner (found 11/12/2026).** The droplet runs n8n 2.42.7 with the built-in task runner, so Code nodes run in a separate process. Whether `NODE_FUNCTION_ALLOW_BUILTIN` reaches that process, whether `$env` works there, and whether `this.helpers.getBinaryDataBuffer` exists there are all untested. Runbook step 7 is the gate: no publish until the draft replay proves all three.
