# Preferred stack

**Reviewed by the owner 11/16/2026.** The owner chose the platforms, asked for the hosting and data rules to weigh performance, scalability and cost, and chose "cheapest model that works". The wording of the rules is Claude's; edit any line to change it.

The Architect reads this file on every run, next to `docs/architect-policy.md`. It designs and rules with these platforms first. Edit it to change what it prefers.

Every `https://` link in this file does two things: the Architect sees it in its prompt, and its host is added to the Architect's fetch allowlist, so it can read the current docs on that site (and only those sites) before ruling on a version, an API or a config. Add a link to give it a new docs site; remove the link to take the site away. It takes effect on the next poll once the change is merged and pulled on the host that runs the Architect; no restart.

Each link's site must serve its docs on that same host. A link that redirects to another domain is refused (docs.claude.com moved to platform.claude.com, for example).

A platform that is not in this file is a new vendor. The Architect escalates it to the owner as `new_spend_or_vendor`.

## Choosing between them

Weigh three things, in this order, and say in the design which one decided it: **cost** (what it adds to the monthly bill or the daily cap), **performance** (latency the user feels, run time), **scalability** (what breaks first at 10x the load). Check current limits and prices in the linked docs before citing them; do not quote them from memory.

### Where code runs: Vercel or the droplet

| Pick | When |
|---|---|
| **Vercel** | It answers a web request and finishes in seconds: pages, API routes, webhooks that reply fast. Traffic is spiky or public. It needs a CDN or preview deploys. |
| **Droplet** | It runs longer than a function may, polls, holds a lease or a lock, keeps state in memory, or runs on a timer every few minutes. It must reach Postgres or n8n on the droplet's private network. |

- **Cost.** The droplet is a fixed monthly price already paid, so work that fits on it adds nothing. Vercel bills by use: a poller or a chatty background job there costs every hour it runs. A job that runs all day belongs on the droplet.
- **Performance.** Vercel is close to the user and fast for short requests, with cold starts. The droplet has no cold start and no time limit, but it is one machine in one region.
- **Scalability.** Vercel scales out on its own. The droplet does not: watch memory on the 4 GB box (n8n, Postgres and the runner share it). If a design would push the droplet past about 70% memory or CPU at normal load, say so and escalate as `new_spend_or_vendor` (a bigger droplet or a second one is spend).
- **Split it when both fit.** A fast web front on Vercel that hands slow work to a worker on the droplet is the default shape for anything with both.

### Where data lives: n8n data tables or Postgres

| Pick | When |
|---|---|
| **n8n data tables** | Small reference or config data (hundreds of rows, not tens of thousands) that n8n workflows read, written rarely, by n8n or by the owner through a form. |
| **Postgres on the droplet** | Anything read or written often, anything with joins, transactions, leases or ordering, anything an app or script reads on every request, and anything that grows without bound (events, logs, history). |

- **Cost.** Every read of an n8n table from outside n8n is a workflow run. On the board, gateway reads were the main load and needed a cache to cut about 240 runs a day. A hot path through n8n costs runs; the same read from Postgres costs nothing extra.
- **Performance.** A Postgres query is milliseconds. A read through an n8n gateway is a full workflow run, usually hundreds of milliseconds or more.
- **Scalability.** n8n tables have no indexes you control, no transactions and no joins. Postgres has all three. Data expected to pass a few thousand rows, or to be written by more than one process at once, goes in Postgres.
- **One home per fact.** Never keep the same data in both. If n8n needs Postgres data, n8n reads Postgres; it does not copy it into a table.
- **No new managed database.** Neon was dropped after its quota ran out (11/7/2026). A new hosted database is `new_spend_or_vendor`.

## Hosting: Vercel

- Use for: Nuxt apps and small web front ends. The board runs here.
- Not for: long-running workers, pollers or anything that holds a lease. Those go on the droplet.
- Docs: https://vercel.com/docs

## App framework: Nuxt 4 and Nuxt UI

- Use for: any web UI. Match the board's layout (`app/`, `server/`, `shared/`).
- Docs: https://nuxt.com/docs and https://ui.nuxt.com/docs

## Automation: n8n (self-hosted on the droplet)

- Use for: scheduled jobs, webhooks, gateways between services.
- Not for: logic that needs tests in a repo. Put that in a script and call it.
- Docs: https://docs.n8n.io

## Server and database: DigitalOcean droplet, Postgres

- Use for: workers, the runner, the step store. One small droplet with Postgres, shared with n8n and the runner.
- Not for: a new managed database or a second server without the owner's go.
- Docs: https://docs.digitalocean.com and https://www.postgresql.org/docs/current/

## Work tracking: Linear

- Use for: issues, agent delegation and agent activity. The board is frozen.
- Docs: https://linear.app/developers

## AI: Claude API and Claude Code

- Use for: any model call or agent run.
- Model choice, cheapest that works: Haiku for simple, high-volume steps (classify, extract, route). Sonnet by default. Opus only for hard reasoning or long agent runs, and say why in the design. Check current model names and prices in the docs.
- Docs: https://platform.claude.com/docs

## Code and CI: GitHub and GitHub Actions

- Use for: repos, pull requests, CI checks.
- Docs: https://docs.github.com

## Runtime: Node 24, pnpm

- Use for: scripts and apps. Node's built-in test runner for scripts.
- Docs: https://nodejs.org/docs/latest/api/
