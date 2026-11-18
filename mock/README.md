# Fixtures

Demo data for fixtures mode (`NUXT_BOARD_SOURCE=fixtures`, `NUXT_REGISTRY_SOURCE=fixtures`). Every row is synthetic. Field names and values follow `docs/schema.md`. Like the live data tables, every value is a string, number, boolean, date string, or null. Lists are comma-separated strings (`tags`, `request_types`), and `roles_json` is a JSON string.

| File | Rows | What it holds |
|---|---|---|
| `gov_registry.json` | 10 | The agent roster the board reads (trimmed to the fields the board uses) |
| `gov_tasks.synthetic.json` | 9 | Cards that cover the states: pool step, in progress with two roles, blocked, approval pending, verifying, needs input in Architecture, done, backlog, a second approval pending |
| `gov_task_steps.synthetic.json` | 8 | Steps for those cards |
| `gov_task_notes.json` | 12 | Notes on those cards |
| `board_columns.json` | 17 | The Stages and States presets (`docs/architecture.md`) |

## Rules

- Synthetic IDs use the 900000 range (`TSK-9000nn`, `STP-9000nn`, `NTE-9000nn`). Show them in the UI like any other row.
- Fields beyond the base schema (`stage` and `tags` on tasks; `role`, `activity` and `heartbeat_at` on steps; a `pool:<agent_type>` assignee on steps) appear only on some rows. The store must handle rows without them.
- **Stage fallback** for rows without `stage`:
  - `backlog` → backlog
  - `verifying` → review
  - `done` → done
  - any other `work_state` → architecture if the current step's assignee has `agent_type = advisor`, otherwise build
- `person:owner` and `system` are valid authors and assignees but aren't in the registry. Handle them in `app/types/board.ts`.
- No secrets, tokens, or credential values belong here.
- No private or client data belongs here. Write new rows by hand; do not copy them from a live board.
