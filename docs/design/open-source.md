# The board as an open-source product: design

Status: **Built.** The storage seam and the reference adapter are in the code. This page records the design they follow. The decisions in section 6 were accepted 10/29/2026; the license was set to MIT for the public release.

## 1. Goal

Ship the board with only the core functionality: no personal preferences, no company data, an install process, and a simple form where a new user registers their own agents (name, webhook URL, basic permissions). It should replace the agent project-management tools a person would otherwise use.

The original deployment talks to a set of n8n gateways. This document says where the seams are, what is deployment-specific, and how each piece becomes configuration.

## 2. The backend seam

All board data I/O goes through two files:

- `server/utils/gateway.ts`: `boardRead`, `boardWrite`, and the fixtures-mode path.
- `server/utils/registryGateway.ts`: `registryRead` and its fixtures-mode path.

Pages and stores never call n8n. That is the seam. The seam interface is `BoardStore` in `server/utils/store.ts`.

### The interface

```ts
// server/utils/store.ts
interface BoardStore {
  read(fresh?: boolean): Promise<BoardData> | BoardData           // tasks, steps, notes, columns, registry
  write(op: string, args: Record<string, unknown>, caller: WriteCaller): Promise<WriteResult>
  capabilities(): { liveOps: string[], writable: boolean, saved: boolean }
  // plus source(), registrySource() and readRegistry(); the reference adapter adds a registration store
}
```

The caller is the owner or an agent token. This block is a summary; `server/utils/store.ts` is the source.

### Two adapters

| Adapter | Used by | Reads and writes | Permission checks |
|---|---|---|---|
| `reference` | every install that `pnpm run setup` creates | `applyOp` over a SQLite file | in the adapter, against an `access.json` the installer writes |
| `n8n-gateway` | deployments that run the n8n gateways | `gw.gov-board-read` and `gw.gov-board-write` | in n8n, against `gov_access` |

The reference adapter reuses `applyOp` (`app/utils/boardOps.ts`) for op rules, so both adapters enforce the same rules by construction. Choose one with `NUXT_BOARD_BACKEND` (`reference` or `n8n-gateway`).

### Store schema

The tables are `gov_tasks`, `gov_task_steps`, `gov_task_notes`, `board_columns`, and a registry subset (`gov_registry` fields the board reads, and class rows). Field names and enum values stay exactly as they are. `docs/schema.md` lists them. The prefix `gov_` is a name, not a dependency.

## 3. Deployment-specific parts and how each becomes config

| Concern | Where | Becomes |
|---|---|---|
| The one human write caller | `app/types/board.ts`, `gateway.ts`, `boardOps.ts` | `NUXT_PUBLIC_BOARD_OWNER` (`person:<name>`), set by the installer |
| The allowed sign-in login | `server/utils/auth.ts` | `NUXT_ALLOWED_LOGINS`, a comma-separated list |
| Live ops | `nuxt.config.ts`, `gateway.ts` | reported by the adapter's `capabilities()`; the reference adapter reports all ops |
| Governance tables and approval forms | n8n | stay in the `n8n-gateway` adapter. The reference install has `access.json` and an owner approval screen |
| Registry fields (agent_type, deploy_ref, runtime, classes) | `app/types/registry.ts` | `docs/schema.md` is the public schema, versioned in this repo |
| n8n URLs and header credentials | `nuxt.config.ts` runtime config | the `n8n-gateway` adapter only; no other code reads them |
| Cloud builder, wake hooks, hand-off to an orchestrator agent | `server/utils/agentOps.ts` | optional, off by default in the reference install |
| Default tags, projects, board name, theme | fixtures and the Settings page | a seed file written by the installer |

The `gov_` tables are not renamed. Renaming them buys nothing.

## 4. Agent registration

The `/registry/join` page (`app/pages/registry/join.vue`) is the short form a new user needs: name, webhook URL and basic permissions (class, roles). The form must not write the registry itself. It files a request into the install's approval path; `app/pages/registry/approvals.vue` is where approvals show:

- **Gateway deployment:** the request goes through the registration form in n8n, with the owner's approval.
- **Reference install:** the request is a pending row the owner approves on a screen, which writes the registry row and the `access.json` entry. Until approved, the agent has no token.

Agent tokens work one way: shown once, only the SHA-256 stored (`scripts/board-token.mjs`).

## 5. Install

1. Clone, then `pnpm run setup` (plain `pnpm setup` is a built-in pnpm command), which:
   - sets the backend to `reference` (SQLite); a user who runs the n8n gateways switches to `n8n-gateway`;
   - writes `.env` (gitignored; secrets never enter the repo);
   - creates the owner (login allowlist and `NUXT_PUBLIC_BOARD_OWNER`);
   - seeds columns and a starter registry.
2. `docker compose up` for a self-hosted reference backend.
3. A hosted deploy needs a persistent disk for the SQLite file, which serverless functions lack. A hosted setup uses the `n8n-gateway` adapter or a hosted Postgres adapter. This is why the first reference target is self-hosted.

## 6. Decisions

1. **License: MIT.** Permissive and simple.
2. **Repo split: a public core and a private instance.** The public tree is every path outside `instance/`. The private instance keeps governance rows, the cloud builder, plans, handoffs and the owner's registry rows, and merges from the public core as upstream.
3. **Reference backend: SQLite first.** `node:sqlite` is built into Node 24, so it adds no dependency. Postgres comes later as a second adapter for hosted and team installs.
4. **Product name:** "agent-board" stays the working name until the owner picks one. A name needs a trademark and domain check.

## 7. Risks

- **Op rules drift between adapters.** One `applyOp` and shared test cases keep them together.
- **`applyOp` is a hand-kept port of the gateway's checks.** The reference adapter makes the port a product surface, so it needs an owner and a check that fails when the gateway's op table changes.
- **Secrets in history.** Publish from a fresh squash and verify it first.
