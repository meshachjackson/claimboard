# claimboard

A kanban board for people who work with AI agents. Cards move through Backlog, Architecture, Build, Review and Done.
Agents claim steps over REST or MCP with their own token. You approve plans and answer questions on the board.

The board keeps everything in one SQLite file and needs no other service except a GitHub OAuth app for sign-in.
That is the default, and the install below. claimboard is MIT licensed (`LICENSE`); report security problems as `SECURITY.md` says.

Where to go next:

- [`docs/architecture.md`](docs/architecture.md): the model, columns, steps and the storage seam.
- [`docs/design/open-source.md`](docs/design/open-source.md): the design of the storage seam and the two adapters.
- [`docs/schema.md`](docs/schema.md): table fields and allowed values.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how to set up, test and send a pull request.

## Install

You need Node 24 (`.nvmrc`) and pnpm, or Docker.

1. Get the code and install: `pnpm install`
2. Run the setup: `pnpm run setup`. (Use `pnpm run setup`: plain `pnpm setup` is a different, built-in pnpm command.)
   It asks for your GitHub login and name, then writes `.env` (mode 600, already git-ignored) and an empty `.data/access.json`.
   It will not overwrite an existing `.env` unless you pass `--force`.
3. Create the sign-in (below), and put its id and secret in `.env`.
4. Start it:
   - Docker: `docker compose up`
   - Without Docker: `pnpm build && set -a && . ./.env && set +a && node .output/server/index.mjs`
5. Open http://localhost:3000 and sign in with GitHub. The board starts empty.

## Sign-in

Create a GitHub OAuth app (GitHub, Settings, Developer settings, OAuth Apps, New). Set the callback URL to
`<your address>/auth/github`, for example `http://localhost:3000/auth/github`. Copy the client id and secret into
`NUXT_OAUTH_GITHUB_CLIENT_ID` and `NUXT_OAUTH_GITHUB_CLIENT_SECRET` in `.env`. Only the logins in `NUXT_ALLOWED_LOGINS`
can sign in.

While developing (`pnpm dev`), set `NUXT_DEV_LOGIN=1` and open `/auth/dev` to sign in as the first allowed login without GitHub.

## Letting an agent in

Agents need a token. Make one, give the agent the token, and add its hash to `access.json`:

```
node scripts/board-token.mjs agt-my-agent
```

It prints the token once and its SHA-256. Put the token in the agent's own config. Add the hash to the access file
(`.data/access.json`, or `/data/access.json` in Docker):

```json
{ "agents": [ { "agent_id": "agt-my-agent", "token_sha256": "<the hash>" } ] }
```

An entry may also list `"ops"` to limit what that agent may call. The file is read on every request, so no restart is needed.
An agent must also have a row in the board's `registry` table. The registration page at `/registry/join` files a request for
the owner to approve, and the approval writes that row. The `agent_id` must match the access entry.

## Settings

| Setting | What it does |
|---|---|
| `NUXT_ALLOWED_LOGINS` | GitHub logins that may sign in, comma-separated |
| `NUXT_PUBLIC_BOARD_OWNER` | The person the board writes as, `person:<name>` |
| `NUXT_PUBLIC_BOARD_OWNER_NAME` | The owner's name on cards and notes |
| `NUXT_PUBLIC_DEFAULT_RUNNER` | The `agt-<name>` agent that Start gives unassigned cards to. Blank means the pool |
| `NUXT_BOARD_BACKEND` | Where the board keeps its rows. Unset or `reference`: SQLite (the default). `n8n-gateway`: the optional n8n adapter below |
| `NUXT_BOARD_DB`, `NUXT_BOARD_ACCESS` | Where the SQLite file and the access file are |
| `NUXT_PUBLIC_APP_NAME` | The name in the header and the browser tab. Default `claimboard` |
| `NUXT_PUBLIC_FEATURE_ORCHESTRATOR` | `true` turns on the optional orchestrator features below. Off by default |

`.env.example` lists every setting.

## Optional: n8n gateway mode

The board can instead read and write through two n8n workflows, `gw.gov-board-read` and `gw.gov-board-write`, with
permission checks in n8n. Set `NUXT_BOARD_BACKEND=n8n-gateway` and the gateway URLs and header credentials listed in
`.env.example`. With `NUXT_BOARD_SOURCE=fixtures` this adapter runs on built-in sample rows instead. This is an adapter for deployments that already run those workflows; the SQLite install does not need it.
The seam is described in [`docs/design/open-source.md`](docs/design/open-source.md).

## Optional: orchestrator features

`NUXT_PUBLIC_FEATURE_ORCHESTRATOR=true` turns on the parts built for one orchestrator agent that answers the owner:
the orchestrator history screen (`/orchestrator`), the Claude connector sign-in (`/oauth/*` and the
`/.well-known/oauth-*` metadata), and the `ask_vera` and `vera_reply` tools on `/mcp`. They need a gateway that
answers those ops, so most installs leave the flag off. With it off, `/mcp` still serves the full agent contract.

## Develop

`pnpm dev`, `pnpm test`, `pnpm typecheck`. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/architecture.md`](docs/architecture.md).
