# Architecture

A short tour of how the board works. Field names and allowed values are in [`schema.md`](schema.md). The storage seam is specified in [`design/open-source.md`](design/open-source.md).

## What the board is

The board is a view of two tables: cards (`gov_tasks`) and steps (`gov_task_steps`). People and agents share it. The board owns no agents and no permissions; it reads the registry and the access rules and never writes them.

- **UI:** a Nuxt 4 app (Vue 3, TypeScript, Nuxt UI, Pinia).
- **Server:** Nitro inside Nuxt. It handles sign-in, the REST mirror and the MCP endpoint at `/mcp`. Every data call goes through the storage seam.
- **Agents:** each agent has one bearer token. The server stores only token hashes.

## Cards, steps and notes

- **Card:** one `gov_tasks` row. Its pill is `work_state`: `backlog | awaiting_start | in_progress | needs_input | blocked | verifying | done`.
- **Stage:** `gov_tasks.stage` (`backlog | architecture | build | review | done`) places the card in a column. When it is blank, the board derives it from `work_state` and the current step's assignee.
- **Step:** one `gov_task_steps` row. Agents act on steps, never on cards. A step has a `role` (`architect`, `builder`, `consult`, `auditor`, `cleanup`, `chat`), a lease and a `step_state`: `awaiting_start | awaiting_pull | dispatched | served | needs_input | failed | verified`.
- **Pool assignee:** an assignee can be `pool:<agent_type>`. Any eligible agent may claim that step, and the first valid claim gets the lease.
- **Note:** one `gov_task_notes` row. Kinds are `comment`, `question`, `proposal`, `summary` and `status`.

## Columns

Columns are data (`board_columns`), so other presets can sit beside the default one. The default view uses five stage columns:

| Column | Roles (one step each) | Card leaves when |
|---|---|---|
| Backlog | none | The owner moves it |
| Architecture | `architect` | The architect step is served with PASS, a `proposal` note is posted, and the owner approves and moves the card |
| Build | `builder` (required), `consult` (optional) | All required steps are served with PASS; the card moves to Review on its own |
| Review | `auditor` (optional) | The owner approves (card goes to Done) or sends it back (card goes to Build with a note and a new builder step) |
| Done | `cleanup` (system) | Terminal. Done cards can be archived |

## Rollup

The server computes a card's `work_state` from its active steps. The UI only displays it.

1. Internal and macro verification both `pass`: `done`.
2. Any step `needs_input`: `needs_input`.
3. Any step `failed`, or `escalation` set: `blocked`.
4. Any step `dispatched`: `in_progress`.
5. All required steps `served`: `verifying`.
6. Otherwise: `awaiting_start`.

The rollup runs only while a card sits in an agent column (Architecture or Build). In Backlog, Review and Done, `work_state` follows the owner's move. An **active step** is one that is not cancelled and whose `role` belongs to the card's current column.

## Agent loop

Every agent pulls work; webhooks only nudge. Online and offline agents use the same path.

1. `list_claimable`: steps in pools the agent is eligible for, plus steps assigned to it.
2. `claim_step`: sets the lease. The server writes, re-reads, and backs off if another agent holds the lease.
3. `heartbeat`: records `activity` and extends the lease. An expired lease makes the step claimable again.
4. `add_note` and `update_step`: ask a question (`needs_input`) or report a failure (`failed` plus `stop_reason`).
5. `complete_step`: `served` with a `verdict`, `output_ref` and `output_summary`.

The same contract is served over REST (`POST /api/agent/:op`) and MCP (one tool per op at `/mcp`). Each caller sees only the tools it may call.

**Guards against collisions**

- Only the lease owner can write its step.
- A card has at most one active step per role.
- Card-level writes (stage, approval, columns, create, assign) belong to the owner.
- Every write carries the row's `updated_at`. On a mismatch the write is refused and the caller re-reads.

## Owner actions

Moving a card between columns, `start_task`, `send_back`, `assign`, `approve` and `message_agent` are owner actions. The op rules live in one file, `app/utils/boardOps.ts`, so every adapter enforces the same ones. Some rules worth knowing:

- Moving a card to Architecture or Build creates the step for that column. The step goes to the named agent if it is eligible, otherwise to the pool.
- A move or a reassignment cancels the open steps it makes stale.
- A builder step that fails, or ends served without a PASS, gets one retry while attempts stay under the card's budget (default 4, set with a `budget-N` tag).
- A card tagged `parent-<card>` waits in Backlog until the parent card is done.
- `split_task` creates 1 to 10 Backlog children.
- A turn ends with `COMPLETE:`, `REVIEW:` or `BLOCKED <kind>:`. A served builder or architect step with no verdict is refused.

## The storage seam

All board data goes through `BoardStore` (`server/utils/store.ts`). Two adapters implement it:

| Adapter | Setting | Stores data in |
|---|---|---|
| `reference` (default) | `NUXT_BOARD_BACKEND` unset or `reference` | A SQLite file, with permission checks against `access.json` |
| `n8n-gateway` (optional) | `NUXT_BOARD_BACKEND=n8n-gateway` | Two n8n workflows, with permission checks in n8n |

Any other value stops the server with an error (`server/utils/backend.ts`, checked at startup by `server/plugins/backend.ts`), so a typo never serves an empty board.

Optional features sit behind one flag each (`shared/features.ts`). `NUXT_PUBLIC_FEATURE_ORCHESTRATOR=true` turns on the orchestrator screen, the Claude connector (OAuth) and the ask tools on `/mcp`.

An optional Postgres step store (`NUXT_STEP_STORE=postgres`) keeps steps, notes and events in Postgres and runs the step rules in the server.

## Dispatcher and runners

`scripts/board-run.mjs` is the one process that starts agent work. It reads each step's assignee, finds its target (a local worktree, a cloud builder or a hosted runner) and runs or wakes it. The Linear runner and the Architect are described in [`linear-agents.md`](linear-agents.md) and [`linear-runner.md`](linear-runner.md).

## Conventions

- Dates in the UI use American format: 10/25/2026, 9:05 AM.
- Labels and colors live in one file, `app/types/board.ts`.
- Field names and enum values match [`schema.md`](schema.md) exactly. The UI does not rename them.
