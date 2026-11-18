# Board reports

The board manager's briefing and the on-demand visual report use the same report tools (`app/utils/report.ts`).

- **Briefing.** When the board opens, `BoardBriefing.vue` shows one line per finding: orphan cards, cards that could be batched, projects close to done, projects behind. It shows nothing when there is nothing to say. Dismiss holds for the day.
- **Report page.** `/report` draws the briefing tools. `/report?tools=overdue,breakdown:priority` draws whichever tools the URL names. Also under ⋯ > Board report.
- **Agent op.** `board_report` (REST `/api/agent/board_report` and MCP) takes `tools` and returns the findings plus the `/report` link. "Show me the board report" is one call, with no code written.
- **Activity op.** `board_activity` (REST `/api/agent/board_activity` and MCP) takes optional `since` and `until` (ISO timestamps) and returns what changed in that window, newest first: cards created or moved, step changes, notes. A blank `since` starts at the owner's last action on the board (a card they last updated or a note they wrote), so "what happened overnight" is one call with no arguments. Each card and step shows its latest change once, so it is a recap, not a history. Cached board, so class-scoped callers are refused, as with `board_report`.

## Tools

| Tool | Finds |
|---|---|
| `orphans` | Open cards with no project and no assignee |
| `batchable` | 3 or more backlog cards of one project, type and person |
| `almost_done` | Projects with work done and 1 or 2 cards left (names them) |
| `behind` | Projects where at least 2 open cards are overdue and they are half or more of the open cards |
| `overdue` | Open cards past due |
| `breakdown:<field>` | Open cards counted by `work_state`, `stage`, `priority`, `assignee`, `project_id` or `task_type` |

A new tool is one entry in `REPORT_TOOLS`. It returns a `cards`, `bars` or `projects` block, and the page already draws those.

## Limits

- Each tool makes one pass over the cards, and lists are capped at 8 rows with "+N more". The test runs 600 cards in a few milliseconds.
- `board_report` reads the cached board, so class-scoped callers (OAuth, or an agent not named in `NUXT_UNSCOPED_AGENTS`) are refused.
- "Project" means `project_id`. Cards with no project are left out of the project tools.
- Not checked in a browser in this run: tests and typecheck pass, but the banner and page were not opened.
