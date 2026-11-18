# Agent board: taxonomy and usability map

> **Snapshot and regenerate when.** This map is a snapshot of commit `ecee635`. Regenerate it when the sitemap, nav, labels, settings or shortcuts change. `docs/ux/glossary.md` lists the current labels.

For a UX agent who needs the full picture of the app before advising on structure and wording.

## 1. How to read this document

- **Snapshot.** Commit `ecee635` ("Add Ask the board manager button to the sidebar so it opens from any page"). Written 11/7/2026.
- **Method.** Everything here comes from reading the code. The app was not run to produce this map, so every page entry is marked `Not run`. Treat on-screen wording as "what the code says"; a live check may differ where data changes the text (agent names, counts, fixtures versus live rows).
- **Not read.** Server internals beyond the first comment of each route file, the `docs/design` canvases, the dispatcher script (`scripts/board-run.mjs`), and CSS. Registry detail panels (`app/components/registry/Agent*.vue`) were skimmed, not inventoried field by field.
- **Citations.** `path:line` points at the code that holds the word or rule. Wording is quoted exactly as the code has it. Where a label is built from data, the entry says so.
- **Labels for claims.** `Observed` means read directly in code. `Inferred` means a reasoned guess from the code.
- **What the app is.** A kanban board for one owner (the board owner) and a set of AI agents. Cards are work items (`gov_tasks`). Agents pick up steps (`gov_task_steps`) that the board creates when a card enters a column. The owner decides, approves and signs off. Hosted on Vercel; also runs locally with fixtures.
- **Who uses it.** Mainly one person on a laptop and a phone, plus agents through an HTTP and MCP contract. A small access model (groups and levels) exists for more people.
- **Where words live.** All status words, stage names, colors and help text are in app/types/board.ts:364 and its neighbors. Page and menu labels are written inline in the components, so a rename touches many files. Section 11 lists where each word lives.

## 2. Sitemap

25 page files. The nav lights the "Place" column for each route (from app/composables/useNav.ts:12).

| Route | Title on screen | Place it belongs to | Reached from | Kind |
|---|---|---|---|---|
| `/` | Floor | Floor | Rail "Floor", `G F`, logo link, phone tab | Main |
| `/board` | Board | Board | Rail "Board", `G B` | Main |
| `/agents` | Agents (tab "Live") | Agents | Rail "Agents", `G A` | Main |
| `/registry` | Agents (tab "Roster", view "Fleet") | Agents | Tab "Roster" | Sub-page |
| `/registry/table` | Agents (view "Table") | Agents | View switch on Roster | Sub-page |
| `/registry/map` | Agents (tab "Map") | Agents | Tab on Roster | Sub-page |
| `/registry/attention` | Agents ("Agent problems" heading) | Agents | Tab "Problems" on Roster | Sub-page |
| `/registry/approvals` | Agents ("Approvals" heading) | Agents | Tab "Approvals" on Roster | Sub-page |
| `/registry/activity` | Agents ("Activity" heading) | Agents | Tab "Activity" on Roster | Sub-page |
| `/registry/:agentId` | Agents (the agent's panel, breadcrumb "Agents / Roster / name") | Agents | Deep link, `agt-` id | Detail |
| `/registry/new` | Agents ("Plan an agent" heading) | Agents | "New agent" button on Roster | Wizard |
| `/registry/join` | Agents ("Add an agent" heading) | Agents | No link found in the nav or menus; reference install only (Inferred) | Wizard |
| `/orchestrator` | Orchestrator (tab "Orchestrator") | Agents | Tab "Orchestrator", "Open full history" in the Orchestrator panel | Sub-page |
| `/shipped` | Shipped (tab "Log") | Shipped | Rail "Shipped", `G S` | Main |
| `/report` | Report (tab "Report", subheading "Board report") | Shipped | Tab "Report", Board tools menu | Sub-page |
| `/plan` | Plan (tab "Plan") | Board (lit as part of Board) | Rail "Plan", palette "Plan", phone More "Plan" | Utility |
| `/sketch` | Sketch (tab "Sketch") | Board | Tab on Plan | Utility |
| `/settings` | Settings | none | Rail "Settings", `,`, account menu, board tools menu | Utility |
| `/access` | Access | none | Settings > Account > "Open Access", account menu "Access and groups" | Utility |
| `/onboarding` | Set up your team / Groups / Review | none | Account menu "Set up your team", Access page | Wizard |
| `/help` | Help | none | Rail "Help", Board tools menu, card panel link, palette. Has a Keyboard shortcuts section | Utility |
| `/api` | API (menu text: "API reference") | none | Board tools menu, command palette | Utility |
| `/login` | (logo and GitHub button) | none | Redirect when signed out | System |
| `/not-allowed` | Not allowed | none | Redirect after a refused GitHub sign-in | System |
| `/oauth/authorize` | Connect a Claude account to Orchestrator | none | Redirect from an outside app asking to connect | System |

Layers the pages do not show:

- A card opens over any page as a right-hand panel when the URL carries `?task=<id>` (app/layouts/default.vue:12). It is not a route.
- The Orchestrator panel ("Ask Orchestrator"; it also holds the Board manager voice) opens over any page (app/components/AppRail.vue:13). It is not a route.
- The card editor, command palette and shortcuts dialog are dialogs mounted in the layout (app/layouts/default.vue:55).
- Retired URLs: `?view=flow` and `?view=states` open Stages; `?quick=needs|blocked|unassigned` and `tstage`/`tprio` are rewritten (app/utils/boardUrl.ts:10). Registry `?quick=` becomes `?show=` (app/components/registry/Shell.vue:9).

## 3. Navigation

Four "places" are the whole top level (app/composables/useNav.ts:1): **Floor**, **Board**, **Agents**, **Shipped**. The desktop rail, the phone bottom tabs and the command palette list the same four with the same counts and the same `G` chords.

### 3.1 Primary items

| Item | Key | Count shown | Lights up for |
|---|---|---|---|
| Floor | `G F` | Number of cards waiting on the owner; amber when above 0 | `/` |
| Board | `G B` | Open (not archived) cards | `/board`; on phone also `/plan`, `/sketch` (on desktop the rail "Plan" link lights instead) |
| Agents | `G A` | Agents working now | `/agents`, `/registry/*`, `/orchestrator` |
| Shipped | `G S` | Cards shipped today | `/shipped`, `/report` |

### 3.2 Desktop rail (app/components/AppRail.vue:18), top to bottom

1. Logo text "Agent board" (links to `/`) and a "Hide sidebar" button (`[`).
2. "Ask Orchestrator" button (opens the Orchestrator panel). Same toggle as the "Orchestrator" button in the board bar.
3. The four places (above).
4. "Saved views" list (only when at least one is saved).
5. "Search or command" (`⌘K`).
6. "Plan" link (the `PLAN_LABEL` constant, app/types/board.ts) to `/plan`.
7. "Settings" (`,`).
8. "Help": opens `/help`. The `?` key still opens the shortcuts dialog.
9. Account menu (see 3.4).

The four places sit inside `nav[aria-label="Main"]`; the current one carries `aria-current="page"`. Each badge shows a dash until the board has loaded and carries a tooltip and aria-label saying what it counts.

### 3.3 Phone

- Bottom tab bar with the four places (app/components/AppTabs.vue:7). Phone is below 768px (app/composables/useIsPhone.ts:10).
- The Floor header has a search icon (opens the palette), "New card" and an account menu. Other pages get these through their own headers.
- Board tools live in the "More actions" menu (app/components/PhoneMore.vue:33) and include "Plan", "How the board works" and "Settings".

### 3.4 Account menu (app/components/AccountMenu.vue:29)

Signed-in login name (label), "Settings", "Access and groups" (or "Set up your team" before onboarding; admins only), "Sign out".

### 3.5 Page-level tabs

- **Agents group:** tabs "Live" (`/agents`), "Roster" (`/registry`), "Orchestrator" (`/orchestrator`) (app/pages/agents.vue:19).
- **Shipped group:** tabs "Log" (`/shipped`), "Report" (`/report`) (app/pages/shipped.vue:23).
- **Plan group:** tabs "Plan" (`/plan`), "Sketch" (`/sketch`) (app/pages/plan.vue:63).
- **Roster tabs (desktop and phone):** "Fleet", "Table", "Map", "Problems · n", "Approvals · n", "Activity" (app/components/registry/Bar.vue, Header.vue). Phone leaves out Table.
- **Board views:** "Stages" (key `1`) and "Table" (key `2`) (app/types/board.ts:920).

### 3.6 Command palette (`⌘K`, app/components/CommandPalette.vue:32)

Four groups:

- **Go to:** Floor, Board, Agents, Shipped, "Board report", "Agent roster (registry)", "Plan", "Settings", "How the board works", "API reference".
- **Actions:** "New card", "Triage the board", "Find duplicates", "Export cards as CSV", "Import CSV", "Board in Stages view (drag and drop)", "Board as a table", "Refresh the board", "Hide the sidebar" / "Show the sidebar", "Keyboard shortcuts".
- **Cards:** every card by title with its id as prefix.
- **Ask:** `Ask Orchestrator: "<what you typed>"` (app/components/CommandPalette.vue:72).

Placeholder text: "Type a page, a card, an action or a question". Typed text also offers "Ask Orchestrator" and "Ask the board manager" (bulk edits) rows.

### 3.7 Board tools menu (the `⋯` button on the Board bar, app/components/BoardMenu.vue:41)

"Board report", "Triage board", "Find duplicates", "Export shown as CSV", "Import CSV…", "How the board works", "API reference", "Settings", "Keyboard shortcuts". The phone "More actions" menu is a different list (app/components/PhoneMore.vue:15).

### 3.8 One destination, several names

| Destination | Names in use |
|---|---|
| `/plan` | "Plan" everywhere (rail, palette, phone More, page title, tab) |
| `/report` | "Board report" (menu, palette, heading), "Report" (tab, page title) |
| `/registry` | "Roster" (tab), "Fleet" (view), "Agents" (page title), "Agent roster (registry)" (palette), "Agents" (document title) |
| `/help` | "Help" (rail, page title), "How the board works" (menus, palette) |
| `/api` | "API" (page title), "API reference" (menus) |
| Orchestrator panel | "Ask Orchestrator" (rail, stuck-card band, palette, button on `/orchestrator`), "Orchestrator" (bar button, panel header, tab); the palette row "Ask the board manager" opens the bulk-edit voice |

## 4. Page inventory

Each entry lists purpose, parts, actions and notes. Every entry is `Not run` (read in code only).

### `/` Floor

Source: app/pages/index.vue

Not run. Purpose: "who needs to move next" at a glance. Three zones side by side on wide screens: **Needs you** (cards waiting on the owner), **On the floor** (agents working now), **Shipped today** (app/pages/index.vue:49).

- Header: page title "Floor" (hidden below 900px, where "Agent board" shows), live-status dot with a Refresh action, "New card" button (label hides below 900px), search icon and account menu on phone.
- Each zone has a big count, a one-line summary ("Nothing waits on you", "Oldest has waited ...", "Working now. n queued.", "n in all"), a link (desktop "All agents" and "All"; phone "See all agents" and "See all"), a full-screen button and a hide button. Hiding a zone folds it to a strip; one zone must stay open.
- Phone: a three-tab strip ("Zones") shows one zone at a time (app/pages/index.vue:130).
- Content: "Needs you" rows group cards stuck for the same reason; "On the floor" rows are per agent; "Shipped today" lists finished cards.

### `/board` Board

Source: app/pages/board.vue

Not run. Purpose: the full set of cards in columns (Stages) or one row per card (Table). Desktop parts, top to bottom: the board bar (title, search, attention pills, applied-filter tokens, Filters button, View switch, New card, Orchestrator, Board tools), a filter panel (with View options and Saved views at its foot) (when open), a load banner, the columns or table, and the bulk bar (when cards are selected) (app/pages/board.vue:54).

- Columns are the five stages Backlog, Architecture, Build, Review, Done. Cards drag between them; the column rules decide what a move does (see section 6).
- Group by (None, Project, Epic, Milestone) splits the board into lanes; grouped boards can show lanes as columns or as one-line lists.
- Phone: a column tab strip, a "View" switch fixed near the bottom, a "More actions" menu and a filter sheet (app/pages/board.vue:50).
- Opening a card opens the card panel over the page (`?task=`).

### `/agents` Agents, Live

Source: app/pages/agents.vue

Not run. Purpose: which agent is working on what right now. A header with tabs Live / Roster / Orchestrator, a "Nudge dispatcher" button, the "On the floor" summary, then one block per agent with its cards. Empty text: "No agent has work on the board." (app/pages/agents.vue:39).

### `/registry` Agents, Roster (Fleet)

Source: app/pages/registry/index.vue

Not run. Purpose: a board of agents whose columns are lifecycle status; drag an agent to change lifecycle (opens a "Confirm change" sheet). Parts: Registry bar (search "Search agents", attention pills, filters, queue links, "New agent"), fleet columns, a templates shelf, a footer line saying whether rows are live or fixtures. Phone has its own list, `registry/PhoneFleet`.

### `/registry/table` Agents, Table

Source: app/pages/registry/table.vue

Not run. Purpose: one dense row per agent, sortable, with saved column sets ("sets") and a field picker. Signal columns: "Activation gap", "Version drift", "Access not current", "Unknown facts", "Review", "Change in flight", "Live version" (app/pages/registry/table.vue:15).

### `/registry/map` Agents, Map

Source: app/pages/registry/map.vue

Not run. Purpose: where agents run, in three lanes (Laptop, Hosted, Cloud) with arrows for what may call what. Agents with no known host sit in "Host unknown". Called "Map" in the Roster tabs on desktop and phone.

### `/registry/attention` Agents, Problems

Source: app/pages/registry/attention.vue

Not run. Purpose: computed problems as a queue, grouped by kind, one primary action per item. Heading "Agent problems"; tab label "Problems".

### `/registry/approvals` Agents, Approvals

Source: app/pages/registry/approvals.vue

Not run. Purpose: review events waiting for the owner. Queue on the left, the chosen review in full on the right (inline on phone). Actions: Approve or Reject with a note. A "Decided here" list sits below. Decisions are stored in this browser in fixture mode.

### `/registry/activity` Agents, Activity

Source: app/pages/registry/activity.vue

Not run. Purpose: every review event and field change, newest first. Filters: agent, event type, severity, dates.

### `/registry/:agentId` Agent page

Source: app/pages/registry/[agentId].vue

Not run. Purpose: deep link to one agent. Same panel as the drawer that opens over the Roster. Tabs inside come from `?tab=` (default `overview`); the panel has tabs Overview, Access, Deployment and Activity (app/components/registry/AgentPanel.vue:81).

### `/registry/new` Plan an agent

Source: app/pages/registry/new.vue

Not run. Purpose: a wizard that follows the n8n registration form's sections and labels, then rehearses the registration and records it with a review awaiting approval. Used on the n8n deployment.

### `/registry/join` Add an agent

Source: app/pages/registry/join.vue

Not run. Purpose: for the reference install only. A short form (Agent id, Name, Webhook URL, permissions) files a pending request; approving it shows the token once. Sections "Waiting for you" and "Decided".

### `/orchestrator` Orchestrator history

Source: app/pages/orchestrator.vue

Not run. Purpose: the full conversation history with Orchestrator, grouped by day. Search box ("Words or a card id"), a "Clear" button when filtering, an "Ask Orchestrator" button that opens the panel. Empty text: "No conversation with Orchestrator yet. Ask her anything and it starts here."

### `/shipped` Shipped, Log

Source: app/pages/shipped.vue

Not run. Purpose: finished cards by day, under a "Shipped today" summary with "n in all".

### `/report` Shipped, Report

Source: app/pages/report.vue

Not run. Purpose: "Board report": tiles (orphan cards, cards to batch, close to done, projects behind, due dates, project progress, open cards by field), a map, and report panels. A "Showing" chip row filters the report by project or other fields. Selecting a finding sends the owner to the Board with that filter (app/types/board.ts:76).

### `/plan` Plan

Source: app/pages/plan.vue

Not run. Purpose: epics, milestones and releases. "Plan at a glance" counts; sort by Deadline, Name or Card count; a "New epic, milestone or release" form (name placeholder "auth, beta, 1.0"); lists with progress bars, "Past deadline" and "Release" badges, deadline fields (saved in this browser only); and an "Unplanned" list of open cards with no epic or milestone, with dropdowns to assign one. Epic and milestone are stored as tags on the card.

### `/sketch` Sketch

Source: app/pages/sketch.vue

Not run. Purpose: free-form scratch boards (blank, with notes) or boards tied to a project. Buttons "New blank board", "Clear board", "Delete board"; per column "Add a note" or "Add a card"; "New column". A saved sketch becomes a project whose cards show on the main board, grouped by column tag (app/pages/sketch.vue:4). Where blank-board notes are stored was not traced.

### `/settings` Settings

Source: app/pages/settings.vue

Not run. Purpose: personal and shared options. Nine sections (section 7). A section list follows the scroll; a person icon marks sections that change the board for everyone.

### `/access` Access

Source: app/pages/access.vue

Not run. Purpose: groups and rules for who can see and change each board, project and card. Sections "Groups" and "Rules"; "With no rule" default level; "New rule" form; "Save access" button; an "Unsaved changes" flag. Before onboarding: "No groups yet" with "Start onboarding".

### `/onboarding` Set up your team

Source: app/pages/onboarding.vue

Not run. Purpose: a three-step wizard (Start, Groups, Review) that creates the first groups and makes the first allowed person the admin. If done: "Already set up" with a link to Access.

### `/help` How the board works

Source: app/pages/help.vue

Not run. Purpose: glossary. Sections "What a card's status means", "What each column waits for", "Who does what" (agents, plus "If an agent is not responding") and "Things that surprise people". The section list reads: Card status, Columns, Who does what, Surprises (app/pages/help.vue:20).

### `/api` API reference

Source: app/pages/api.vue

Not run. Purpose: every route the board serves, who may call it and what it returns. Search ("Search routes, e.g. claim or token"), a first-call example, copy buttons, expand all.

### `/login` Sign in

Source: app/pages/login.vue

Not run. Purpose: GitHub sign-in. Error text: "GitHub sign-in didn't finish. Try again."

### `/not-allowed` Not allowed

Source: app/pages/not-allowed.vue

Not run. Text: "This board is private. The GitHub account you used doesn't have access." Link "Back to sign in".

### `/oauth/authorize` Connect a Claude account to Orchestrator

Source: app/pages/oauth/authorize.vue

Not run. Purpose: consent screen for an outside Claude account to connect to Orchestrator. Choices: "The owner, through this account" or "An agent identity", plus deny. Shows a copyable hash for agent identities.


## 5. Objects and vocabulary

### 5.1 The objects

| Object | Plain meaning | What the UI calls it | Code name | Where defined |
|---|---|---|---|---|
| Card | One piece of work | "card" everywhere on screen; "task" only in code, API and `?task=` | `GovTask`, `task_id` like `TSK-` plus six digits | app/types/board.ts:155 |
| Step | One unit an agent claims and does | "Steps" list in the card, step chips on cards | `GovTaskStep`, `step_id` like `STP-930292` | app/types/board.ts:190 |
| Note | A message in a card's thread | "Thread", "note", "Reply", "Question", "Proposal", "Summary", "Status" | `GovTaskNote` | app/types/board.ts:245 |
| Event | A logged change (feed, not shown as a list) | not shown by name | `BoardEvent` | app/types/board.ts:230 |
| Column | A stage on the board | "column" (Help), "Stage" (filter, bulk bar) | `BoardColumn` | app/types/board.ts:267 |
| Agent | An AI worker or Orchestrator | "agent", "Roster", "Fleet", registry row | `RegistryAgent` | app/types/board.ts:278 |
| Pool | A group of agents of one type that may take a step | "Open to any agent", `pool:<type>` in Help | `pool:` prefix | app/types/board.ts:339 |
| Project | A grouping label on a card | "Project", lane | `project_id` | app/types/board.ts:174 |
| Epic, Milestone, Release | Planning groups, stored as tags | "Epic", "Milestone", "Release", "Plan" | tags | app/pages/plan.vue:35 |
| Saved view | A named board link | "Saved views" | local storage | app/components/SavedViews.vue:49 |
| Group (access) | A set of people and agents | "Groups", "Admins", "Everyone" | `Group` | shared/access.ts:24 |
| Rule (access) | A level for a group on a board, project or card | "Rules", "New rule" | `Rule` | shared/access.ts:26 |
| Class | A data-sensitivity tag on a card; a scoped agent works only its classes | `class-general` style tags in Help | `board:class:*` rows | shared/agentAccess.ts:37 |
| Sketch board | A scratch board of notes | "Sketch" | local storage | app/pages/sketch.vue:117 |

IDs on cards use the form `TSK-` plus six digits; agents `agt-<name>`; people `person:<name>`; pools `pool:<type>` (app/types/board.ts:339).

### 5.2 Work state (what is happening to a card now)

One value on every card. Shown as a colored pill; Backlog shows no pill. Labels come from app/types/board.ts:364; help text from app/types/board.ts:950.

| Value | On-screen label | Help text (summary) |
|---|---|---|
| `backlog` | Backlog (no pill) | Nothing is working on it |
| `awaiting_start` | Awaiting start | An agent is lined up but has not started |
| `in_progress` | Working | An agent has claimed a step |
| `needs_input` | Needs you | An agent asked something, or a plan waits for approval |
| `blocked` | Blocked | A step failed or was cancelled; the owner picks the next move |
| `verifying` | Ready for review | Agent work finished and passed its check; is ready for your sign-off |
| `done` | Done | Signed off; archived after 14 days |

### 5.3 Stage (which column)

Five columns, left to right (app/types/board.ts:350, help in app/types/board.ts:961).

| Value | Label | What it waits for |
|---|---|---|
| `backlog` | Backlog | Ideas and requests. No agent touches a card here |
| `architecture` | Architecture | An advisor posts a plan; the owner approves it, then moves the card to Build |
| `build` | Build | A builder does the work; the card moves itself to Review when required steps pass |
| `review` | Review | The owner's sign-off. Move to Done to approve, or send it back |
| `done` | Done | Finished |

### 5.4 Step state (what is happening to one step)

Shown on step chips and in the card's Steps list (app/types/board.ts:374).

| Value | Label |
|---|---|
| `awaiting_start` | Awaiting start |
| `awaiting_pull` | Waiting for an agent |
| `dispatched` | Working |
| `served` | Done, checking |
| `needs_input` | Needs you |
| `failed` | Failed |
| `verified` | Verified |

A step waiting for a pool agent shows the pill "Open to any agent" (app/types/board.ts:515).

### 5.5 Other enumerations

| Enum | Value | Label |
|---|---|---|
| Approval (`APPROVAL_STATES`) | `not_required` | Not required |
| | `pending` | Approval pending |
| | `approved` | Approved |
| | `rejected` | Rejected |
| Task type (`TASK_TYPES`) | `operational` | Operational |
| | `build` | Build |
| | `upgrade` | Upgrade |
| Priority (`PRIORITIES`) | `low` | Low |
| | `normal` | Normal |
| | `high` | High |
| | `urgent` | Urgent |
| Sort (`SORT_KEYS`) | `created` | Created |
| | `updated` | Updated |
| | `priority` | Priority |
| | `due` | Due date |
| | `title` | Title |
| Density (`DENSITIES`) | `comfortable` | Comfortable |
| | `compact` | Compact |
| Agent switch (`SWITCH_MODES`) | `on` | On |
| | `auto` | Auto |
| | `off` | Off |

Sources: app/types/board.ts:387, app/types/board.ts:358, app/types/board.ts:38, app/types/board.ts:144, app/types/board.ts:928, app/utils/availability.ts:14. `priority` is free text in the data; only these four are offered, and "medium" is read as Normal (app/utils/priority.ts:5).

### 5.6 Notes

| Value (`NOTE_KINDS`) | On-screen label (from `NOTE_KIND_STYLES`) |
|---|---|
| `comment` | no label (plain bubble) |
| `question` | Question |
| `proposal` | Proposal |
| `summary` | Summary |
| `status` | Status |
| `system` | not shown (fixtures only) |

`NOTE_KIND_STYLES` is at app/types/board.ts:586. Step roles have plain-language labels: Plans the work, Builds it, Gives a second opinion, Checks the result, Logs and archives, Answers a message (app/types/board.ts:970).

### 5.7 Triage vocabulary

Triage ("Triage board") proposes actions for cards using rules.

| `TRIAGE_ACTIONS` value | Label | Can the app apply it? |
|---|---|---|
| `close` | Close | Yes |
| `archive` | Archive | Yes |
| `fold` | Fold | No, advice only |
| `rewrite` | Rewrite | No, advice only |
| `keep` | Keep | No, advice only |

| `TRIAGE_RULES` value | Label |
|---|---|
| `stale` | No activity |
| `test_card` | Test card |
| `duplicate` | Likely duplicate |
| `done_old` | Done a while ago |
| `done_open_steps` | Done with open steps |
| `unreachable_step` | Step nobody can pick up |
| `no_reply` | Comment with no reply |
| `no_criteria` | No acceptance criteria |

Sources: app/types/board.ts:107, app/types/board.ts:119, app/types/board.ts:111.

### 5.8 Card parts the owner sees

- Card face (app/components/TaskCard.vue:112): id, title, status pill, step chips, "Pinned" and "Archived" badges, tags, note count, a red "Needs your attention" dot on Compact cards, "Saving..." while a write runs.
- Card panel (app/components/TicketPanel.vue:215): header buttons (Back, Previous `K`, Next `J`, pin, Edit, Close), status pill, "Next move" band, then sections Details, Steps, "Done when", "Original request", Thread. Detail rows: Project, Plan, Tags, Type, Due, Approval, Created, Stage, Assignee.
- Thread composer: three modes by context. "Leave a note for the record…", `Ask <agent> something…`, and "Answer the question, or leave a note…". Message receipts show Sent, Received, Working, Replied or Question.
- Attention words: "Needs you" (Floor zone, pill and bar pill), "Needs your attention" (dot), "No reply" (card shows when a message waits too long; hours in app/types/board.ts:95).

### 5.9 Filters

Nine facet columns, in order: State, Stage, Who, Project, Epic, Milestone, Priority, Type, Tags (app/composables/useBoardFacets.ts:13). The bar also shows two always-visible pills, "Needs you" and "Blocked" (app/types/board.ts:559), and a token for each active filter. Options carry counts that update as other filters change.

## 6. Actions

### 6.1 How an action reaches the server

- The browser calls `POST /api/board/:op` (owner session). Agents call `POST /api/agent/:op` or the MCP endpoint `/mcp` with a bearer token ([[server/api/board/[op].post.ts|POST /api/board/:op]], [[server/api/agent/[op].post.ts|POST /api/agent/:op]]).
- A small shared verb set sits on top of the wire ops so people and agents use one vocabulary (shared/verbs.ts:9). A name that is not a verb passes through as a wire op.
- Column moves run the column rules in app/utils/boardOps.ts:20; with the step store on, steps and notes live in Postgres.

### 6.2 Verbs

| Verb | Owner op | Agent op | Reached in the UI by |
|---|---|---|---|
| `create` | `create_task` | `create_task` | "New card" (`N`), "Create and start" (`⌘Enter`), CSV import |
| `assign` | `assign` | none | Assignee select in card panel (`A`), bulk bar "Assignee" |
| `claim` | none | `claim_step` | No UI (agents only) |
| `heartbeat` | none | `heartbeat` | No UI (agents only) |
| `comment` | `add_note`, `reply`, `message_agent` | `add_note`, `message_agent` | Thread composer |
| `complete` | `done_no_steps` | `complete_step` | Owner: move a stepless card to Done. Agent: no UI |
| `block` | none | `complete_step` or `update_step` | No UI (agents only) |
| `request_review` | none | `complete_step` | No UI (agents only) |
| `request_changes` | `send_back` | none | "Send back" button on a Review card |
| `archive` | `archive_task` | none | "Archive" button; "Clean up n" and "Archive all n" in the Done column; triage |
| `split` | `split_task` | `split_task` | No UI found (Inferred: used by Orchestrator and architect steps) |

Gated verbs (owner only; agents are refused): `approve` (runs `approve_plan` or `approve_task`), `publish` (`publish_task`), `switch` (`set_switch`). UI: the Approve button in the Next move band, "Push and open draft PR" on a passed Review card, Settings > Agents (shared/verbs.ts:11).

### 6.3 Owner ops with no verb

Kept by name (shared/verbs.ts:37):

| Op | UI |
|---|---|
| `move_task` | Drag a card to another column; "Move" select in the card (`M`); bulk bar "Stage" |
| `update_task` | Card editor "Edit"; bulk bar (Stage, Assignee, Priority, Type, Project, Tag, Due date); Plan page dropdowns |
| `nudge` | "Respond now" in the thread composer; "Nudge dispatcher" on `/agents` |
| `cancel_step` | "Cancel <step id>" button in the Steps list |
| `pin_task`, `unpin_task` | Pin button in the card header ("Keep this card first in its column and out of cleanup") |
| `start_task` | "Start" or "Restart" button; "Create and start" |
| `reopen_task` | No UI found in components (store function `reopenTask`, app/stores/board.ts:652) |

### 6.4 Ops the Postgres step store answers

`STORE_OPS` (shared/agentAccess.ts:14): `claim_step`, `heartbeat`, `update_step`, `complete_step`, `add_note`, `list_claimable`, `get_task`, `message_agent`, `handoff_step`. `CARD_OPS` (shared/agentAccess.ts:21): `move_task`, `start_task`, `send_back`, `publish_task`, `reopen_task`, `assign`, `approve_plan`, `reply`, `cancel_step`, `nudge`, `message_agent`, `done_no_steps`, `archive_task`, `add_note`, `split_task`. Read ops agents also use: `whoami`, `my_steps`, `read_brief`, `read_task`. Other ops: `apply_rollup` (server-side card update after a step changes) and `create_task`.

### 6.5 UI action surfaces

| Action | Where | Notes |
|---|---|---|
| New card | Board bar, Floor header, rail palette, `N` | Opens the card editor |
| Create and start | Card editor, `⌘Enter` | Creates, assigns by rule and starts in one write (app/components/TicketEditor.vue:344); "Plan first" sends it to Architecture; "Create" only when approval is needed |
| Drag a card | Board columns, Registry fleet columns | Board: moves the stage. Registry: opens the Confirm change sheet |
| Select cards | `X`, checkbox on hover, "Select cards" (phone) | Opens the bulk bar |
| Bulk edit | Bulk bar (app/components/BulkBar.vue:95) | Edit Stage, Assignee, Priority, Type, Project, Tag, Due date; "Export selected"; "Done" clears |
| Triage board | Settings > Clean-up, Board tools, palette, phone More | Lists proposals before anything changes; applies Close and Archive |
| Find duplicates | Same places | Needs `archive_task` and write access |
| Export CSV | Board tools "Export shown as CSV", Settings "Export all as CSV", bulk bar "Export selected", palette "Export cards as CSV" | Three scopes: shown, all, selected |
| Import CSV | Board tools, Settings, palette | The board manager agent proposes a column mapping; the owner confirms |
| Archive done | Done column header | "Clean up n" (older than 14 days), "Archive all n" (app/components/ArchiveDone.vue:53) |
| Pin | Card header | A pinned card sorts first and is never archived |
| Ask Orchestrator | Rail, board bar "Orchestrator", palette "Ask Orchestrator", "Ask Orchestrator" in a stuck card's band | Opens the Orchestrator panel. The palette row "Ask the board manager" opens it on the bulk-edit voice |
| Save a view | Saved views (in the Filters panel) | Names the current filters and view |
| Refresh | Live status dot, Settings > Data "Refresh now", palette | `?fresh=1` skips the 5 minute server cache |
| Approve / Reject (registry) | `/registry/approvals` | Stored in this browser in fixture mode |
| Register an agent | `/registry/new`, `/registry/join` | |
| Edit access | `/access` | "Save access" |

### 6.6 API surface

Every route the server exposes (31 files). The `/api` page documents the same set in plain data (app/utils/apiDocs.ts:51).

| Path | Method | What it does |
|---|---|---|
| `/api/board` | GET | The board's rows from fixtures or the gateway (5 minute cache; `?fresh=1` skips it) |
| `/api/board/:op` | POST | The owner's board writes, behind the GitHub login |
| `/api/board/events` | GET | Server-sent "changed" stream for the local board; 404 on Vercel |
| `/api/board/feed` | GET | Event feed after a sequence number, with current steps and notes |
| `/api/board/nudge-dispatcher` | POST | Wakes the dispatcher now |
| `/api/board/csv-mapping` | POST | Asks the board manager agent for a CSV mapping; returns an id |
| `/api/board/csv-mapping/:id` | GET | Returns the proposal, or null until the agent answers |
| `/api/agent/:op` | POST | The agent contract, bearer token |
| `/api/agent/events` | GET | Push stream for an agent's local listener |
| `/api/agent/dispatch` | GET | Counts the dispatcher polls (no card text) |
| `/api/agent/csv-mapping` | GET | The board manager agent reads waiting CSV files |
| `/api/agent/csv-mapping/:id` | POST | The agent posts its proposed mapping |
| `/api/agent-switches` | POST | Owner sets an agent On, Auto or Off |
| `/api/manager` | POST | One turn with the board manager agent |
| `/api/status` | GET | Latest production build and open PR count for the header |
| `/api/registry` | GET | The Registry's rows (5 minute cache) |
| `/api/registry/requests` | GET | Pending agent requests, owner only |
| `/api/registry/requests` | POST | Files a pending agent request |
| `/api/registry/requests/:id/:decision` | POST | Approve or reject a request |
| `/api/access` | GET | The access policy and what you can do |
| `/api/access` | PUT | An admin replaces the policy |
| `/api/access/onboard` | POST | First-run groups |
| `/api/oauth/consent` | POST | Steps behind the consent page |
| `/mcp` | POST | The agent contract over MCP |
| `/oauth/register` | POST | Dynamic client registration |
| `/oauth/token` | POST | Authorization code and refresh grants |
| `/auth/github` | GET | GitHub sign-in |
| `/auth/dev` | GET | Dev-only sign-in |
| `/.well-known/oauth-authorization-server` | GET | Server metadata |
| `/.well-known/oauth-protected-resource` | GET | Resource metadata |
| `/.well-known/oauth-protected-resource/mcp` | GET | Same, path form |

## 7. Settings and options

### 7.1 Settings page (`/settings`)

Scope shows who a change affects: "This browser" is saved in local storage (app/composables/useSettings.ts:15); "Everyone" changes the board for all viewers. The header note reads "Saved in this browser, unless a section says Everyone."

| Section id | Control label | Scope | Default | Notes |
|---|---|---|---|---|
| `appearance` | Theme | This browser | System | System, Light, Dark |
| `appearance` | Card density | This browser | Comfortable | Compact hides the activity line |
| `layout` | Sidebar | This browser | Shown | Shown / Hidden; `[` toggles |
| `layout` | Floor: Needs you | This browser | On | Toggle; one zone must stay on |
| `layout` | Floor: On the floor | This browser | On | Same |
| `layout` | Floor: Shipped today | This browser | On | Same |
| `defaults` | Opens on | This browser | Stages | Stages or Table |
| `defaults` | Sort cards by | This browser | Created | See 5.5 |
| `defaults` | Group by | This browser | Project | None or Project (app/composables/useSettings.ts:19) |
| `defaults` | Remember the filter panel | This browser | On | Off: panel starts closed |
| `live` | Refresh the board | This browser | Off | Off, 2s, 5s, 15s, 1 min (app/composables/useSettings.ts:13) |
| `agents` | One row per agent in service (label is the agent name) | Everyone | On | On / Auto / Off; Orchestrator is excluded. Help text shows last seen |
| `cleanup` | Run triage | Everyone | n/a | Button "Triage board" |
| `cleanup` | Find duplicates | Everyone | n/a | Button; hidden when read only |
| `cleanup` | Thresholds | Everyone | read-only | Archive Done after 14 days; flag no activity after 7 days; flag unanswered comments after 24 hours. Set in code |
| `data` | Source | This browser | n/a | Button "Refresh now" with source status |
| `data` | Export all as CSV | Everyone | n/a | Button "Export all" |
| `data` | Import CSV | Everyone | n/a | Button "Import CSV…"; hidden when read only |
| `data` | Reset sample data | This browser | n/a | Only on the local fixtures board |
| `shortcuts` | (list) | n/a | n/a | Same list as section 8 |
| `account` | The signed-in login, else "Signed in" | n/a | n/a | Button "Sign out" |
| `account` | Access | Everyone | n/a | Button "Open Access" |

The page also carries two aria labels, "Settings sections" for the section list and "Changes for everyone" for the person icon. Source: app/pages/settings.vue:22.

### 7.2 Options outside Settings

| Option | Where | Stored | Notes |
|---|---|---|---|
| Filters (nine facets) | Filter panel on Board and Roster | URL query | Shareable link; legacy keys rewritten |
| Search | Board bar, Roster bar | URL `?q=` (Roster) | `/` focuses it |
| Needs-you pills | Board bar: "Needs you", "Blocked" | URL (work state filter) | |
| Layout | Board view switch: Stages / Table | URL `?layout=` | `1` and `2` |
| View options (in the Filters panel) | "Group by", "Groups show as" (Columns / List), "Cards" (density), "Show archived", link "Set defaults in Settings" | URL and this browser | app/components/ViewOptions.vue:24 |
| Display options (phone) | "Display": Group by None / Project / Epic / Milestone; "Show archived" | URL | app/components/BoardDisplay.vue:2 |
| Saved views | Filters panel and rail list | This browser | Max name length 40 |
| Floor zone folding | Zone buttons "Fill the screen with <zone>", "Hide <zone>" | This browser | Also in Settings |
| Sidebar hide | Button, `[`, palette | This browser | |
| Roster options | Search, attention pills, filters, lanes (Host, Domain), show retired, saved column sets (Table) | URL and this browser | app/composables/useRegistryFilters.ts:20 |
| Live refresh | Settings > Live updates | This browser | |
| Plan deadlines | Plan page date fields | This browser | "Deadlines are saved in this browser" |


## 8. Shortcuts

Single keys stand down while you type or a dialog is open (app/composables/useBoardKeys.ts:4). The list below is `SHORTCUTS` (app/types/board.ts:931), shown in the shortcuts dialog and in Settings.

| Keys | Action | Pages | Where handled |
|---|---|---|---|
| `⌘K` | Command palette: pages, cards, actions, or ask Orchestrator | All | Layout (app/layouts/default.vue:35) |
| `G  then  F B A S` | Floor, Board, Agents, Shipped | All | Layout (app/layouts/default.vue:39) |
| `/` | Focus search (Board, Agents Roster, Orchestrator history, Shipped) | Board, Roster, Orchestrator history, Shipped | app/composables/useBoardKeys.ts:30; Shipped and Orchestrator history pass their own handler (app/pages/shipped.vue, app/pages/orchestrator.vue) |
| `F` | Open or close filters (Board, Registry) | Board, Roster | app/composables/useBoardKeys.ts:31 |
| `N` | New card | All (not read only) | Layout (app/layouts/default.vue:36) and also a page handler |
| `1  2` | Stages, Table (Board) | Board | app/composables/useBoardKeys.ts:33 |
| `X` | Select the focused card | Board | app/composables/useBoardKeys.ts:35 |
| `J  K` | Next or previous card, with a card open | Card panel | app/components/TicketPanel.vue:30 |
| `R  M  A` | Reply, Move, Assign, with a card open | Card panel | Same line |
| `Esc` | Close the top panel, then clear the selection. Also works while typing in a field | All | app/composables/useBoardKeys.ts:36 |
| `Tab` | Next control. The first stop is a "Skip to content" link | All | app/layouts/default.vue |
| `,` | Settings | All | Layout (app/layouts/default.vue:37) |
| `[` | Hide or show the sidebar (desktop) | Desktop | Layout (app/layouts/default.vue:38) |
| `?` | Keyboard shortcuts | All | app/composables/useBoardKeys.ts:38 |

Also in code but not in the list: `⌘Enter` in the card editor runs "Create and start" (app/components/TicketEditor.vue:134); the palette shows `1` and `2` beside its two view actions.

Mismatches to know about:

- A code comment in the layout says the page keys are "/, F, X, 1 2 3 4, ?" (app/layouts/default.vue:30), but only `1` and `2` exist now (Flow and States were retired). Comment only, no user impact (Observed).
- `N` is bound twice: in the layout and as an optional page handler (app/composables/useBoardKeys.ts:32) (Observed).
- `/` works on Board, Agents Roster, Orchestrator history and Shipped (the pages with a search field). Floor and Plan have no search field, so the key does nothing there, and the shortcuts list says which pages it works on (Phase 6, 11/7/2026). `F` still works only on Board and Roster.
- `[` hides the sidebar but on phone there is no sidebar; the key does nothing there (app/layouts/default.vue:38).

## 9. Who can do what

Two separate gates. First, who can open the app: only allowed GitHub logins get a session (server/middleware/auth.ts:13). Second, what a signed-in person or agent can do on each board, project and card: groups and levels `none < view < edit < manage` (shared/access.ts:11).

| Role | Can see | Can change | Notes |
|---|---|---|---|
| Board owner (signed in, writes through the browser) | Everything | All board ops through `/api/board/:op`; approves, publishes, switches agents | The server sets `as_person` to the owner; no token ([[server/api/board/[op].post.ts|POST /api/board/:op]]) |
| Admin (member of the `admins` group) | Everything, plus the rules | Groups, rules, access policy (`PUT /api/access`) | Always has `manage`; cannot be locked out (shared/access.ts:20) |
| Signed-in, not admin | Cards where their level is view or more; no rules | Edit where level is edit or manage | Gets only own id and groups from `GET /api/access` (server/api/access/index.get.ts:2) |
| Everyone group | Default level applies when no rule matches (new install: `edit`) | Same | shared/access.ts:35 |
| Agent (bearer token) | Cards in its classes; its own steps | Agent ops only (claim, heartbeat, update, complete, notes, list, get, message, handoff); pool claims need a `board:role:<role>` access row | shared/agentAccess.ts:78; class rule at shared/agentAccess.ts:58 |
| Door agent (`agt-door-*`) | Reads | Only ask, read and message: `ask_vera`, `vera_reply`, `read_brief`, `read_task`, `my_steps`, `message_agent` | shared/agentAccess.ts:8 |
| Read-only mode (no write gateway, or no live op) | Everything allowed | Nothing; buttons hide or explain | "Read only: board writes are off until the write gateway is connected." (app/components/TicketNextMove.vue:121); app/stores/board.ts:102 |
| Agent switched Off | n/a | Cannot claim, receive messages, wake or be assigned | Settings > Agents (app/utils/availability.ts:3) |

Rules the UI applies on top:

- Buttons appear only when the host has that op live: `board.canUse('start_task')` and similar (app/stores/board.ts:110).
- Registry and access writes (`gov_registry`, `gov_access`) are never made by the app; they go through n8n forms (project `CLAUDE.md`).

## 10. Phone and desktop

Phone means a viewport narrower than 768px (app/composables/useIsPhone.ts:10). The Floor changes layout at 900px and 1280px (app/pages/index.vue:3).

| Component or page | Where | What differs |
|---|---|---|
| `AppRail` | Desktop only | The sidebar. Phone gets `AppTabs` (four bottom tabs) instead (app/layouts/default.vue:51) |
| `AppTabs` | Phone only | Bottom tab bar, same four places and counts |
| `PhoneBoard` | Phone only | Board columns as a swipeable tab strip with one list; "Table" renders as phone table (app/pages/board.vue:50) |
| `PhoneMore` | Phone only | "More actions" menu replaces the desktop `⋯` Board tools menu; adds "Select cards", drops "Board report" and "API reference" (app/components/PhoneMore.vue:23) |
| `PhoneFilterRow` | Phone only | Search plus a Filters button with a badge, then a scrolling row of pills and tokens (app/components/PhoneFilterRow.vue:2) |
| `FilterSheet` | Phone only | Filters as accordion sections, then Display controls, "Clear all" and "Show n cards" (app/components/FilterSheet.vue:2) |
| `registry/PhoneFleet` | Phone only | Roster as a tab strip across lifecycle, floating "New agent" button; lifecycle moves via "Move to…" in the agent sheet instead of drag (app/components/registry/PhoneFleet.vue:2) |
| Registry header | Phone: `registry/Header`; desktop: `registry/Bar` | Same tab labels: desktop Fleet / Table / Map / Problems / Approvals / Activity; phone drops Table (app/components/registry/Header.vue:10) |
| Floor | Both | Under 900px: tab strip of zones and a compact header; 900px and wider: zones side by side (app/pages/index.vue:130) |
| Card panel | Both | Slides over from the right; on phone the header buttons show icons only and a Back arrow (app/components/TicketPanel.vue:130) |
| Selection | Both | Desktop: hover checkbox and `X`. Phone: "Select cards" in More, then checkboxes (app/components/TaskCard.vue:56) |
| Sidebar hide | Desktop only | `[` and the hide button; no phone equivalent |
| Registry Table | Desktop only | Phone has no Table tab, and `/registry/table` on a phone shows "The Table is desktop only" with links to Fleet, Problems and Approvals. This is a decision, not a gap (Phase 6, 11/7/2026) |
| Keyboard shortcuts | Desktop only in practice | Single keys need a keyboard (Inferred) |
| Settings, Help, Access, Plan | Both | Section list becomes a horizontal scroll strip under 820px of container width ([[app/pages/settings.vue|@max-[820px]:flex-row]]) |

## 11. Wording inconsistencies

Each entry: the terms in conflict, where they appear, and why it matters. All are `Observed` in code unless marked.

1. **Done / Logged / Complete.** Resolved in wave 3 (11/7/2026): work state `verifying` is "Ready for review", work state `done` is "Done" (stage `done` was already "Done"). "Logged" and "Complete" are gone from the screen.
2. **Working.** The work state `in_progress` and the step state `dispatched` both show "Working"; step `served` shows "Done, checking" (app/types/board.ts:377, app/types/board.ts:367). The Floor zone "On the floor" and the Agents tab "Live" also mean working. Why it matters: a card "Working" can have a step "Served".
3. **Needs you.** Resolved in wave 3 (11/7/2026): the Floor zone is now "Needs you", the same phrase as the pills; the registry queue is "Agent problems" (tab "Problems"). The red dot "Needs your attention", "Waiting for your approval" and "No reply" stay as small variants.
4. **Board / Stages / Registry / Agents / Roster / Fleet.** The nav item is "Board" and the view inside is "Stages" (app/types/board.ts:920); "Stages" is also the name of a Settings choice and a palette action "Board in Stages view (drag and drop)". For agents: nav "Agents", tab "Roster", view "Fleet", palette "Agent roster (registry)", document title "Agents" (app/pages/registry/index.vue:5). Why it matters: one object, five names; the code word "registry" leaks into titles.
5. **Floor zone names versus Settings.** Zone titles are "Needs you", "On the floor", "Shipped today" (app/pages/index.vue:50); Settings repeats them behind a "Floor:" prefix (app/pages/settings.vue:54). The strings match, but the zone link labels differ between layouts: desktop "All agents" and "All" (app/pages/index.vue:51) versus phone/compact "See all agents" and "See all" (app/pages/index.vue:118). Why it matters: "On the floor" sits inside a page called "Floor", and "Shipped today" inside a place called "Shipped".
6. **Ticket / Card / Task.** Resolved in wave 3 (11/7/2026): the screen says "card" everywhere ("New card", "Card panel", "Cards" in the palette, "Show n cards", "This card needs your approval"). The `?task=` URL, `task_id` and `gov_tasks` keep their code names.
7. **Plan.** Resolved in Phase 4: the rail, palette and phone More each have one link, "Plan", to `/plan`. Sketch is a tab on that page (app/components/AppRail.vue).
8. **Run it / Start / Restart / Create.** Resolved in wave 3 (11/7/2026): the card button stays "Start" and "Restart"; the editor submit button is "Create and start", with "Create" (when approval is needed first) and "Plan first" as the other choices.
9. **Shipped / Report / Log.** The place is "Shipped", its tabs are "Log" and "Report". Phase 4 made the Report page title "Report" (app/components/PageTitle.vue); the page still opens with the subheading "Board report", and the palette and Board tools menu say "Board report". Why it matters: reports about the board's health live under the "shipped work" place.
10. **Archive / Fold / Close / Clean up.** Triage offers Close, Archive, Fold, Rewrite, Keep, but only Close and Archive can be applied (app/types/board.ts:111). The Done column offers "Clean up n" and "Archive all n"; Settings has a "Clean-up" section; the card has "Archive". "Fold" also means collapsing a Floor zone (app/components/FloorFold.vue:2) and, in code, grouped cards. Why it matters: "Fold" and "Close" have no matching action; "Close" also closes the card panel.
11. **Orchestrator / board manager / helper.** Resolved in wave 3 (11/7/2026): one panel with two named voices. The header says "Orchestrator: answers and routes" or "Board manager: edits cards in bulk", and each reply carries its speaker. Every entry point says "Ask Orchestrator"; only the palette row for bulk edits says "Ask the board manager".
12. **Awaiting start / Awaiting pull.** Resolved in wave 3 (11/7/2026): step state `awaiting_pull` is "Waiting for an agent", `served` is "Done, checking", and the pool pill is "Open to any agent". "Awaiting start" stays for the work state and the step state `awaiting_start`.
13. **Respond now / Nudge dispatcher / nudge.** The thread has "Respond now" (wake one agent for its open message), `/agents` has "Nudge dispatcher" (wake the runner) (app/components/NudgeDispatcher.vue:31); the op for the first is `nudge`. Why it matters: two wake buttons, different targets, similar words.
14. **Help.** Resolved in Phase 4 (11/7/2026): the rail item is "Help" and opens `/help`, titled "Help", which has a Keyboard shortcuts section. The `?` key still opens the shortcuts dialog. Menus and the palette still say "How the board works" (app/components/AppRail.vue).
15. **Settings word "Everyone".** "Everyone" is a Settings scope label and also a group name ("Everyone group") in Access (app/pages/settings.vue:121, shared/access.ts:18). Why it matters: a setting that is "for everyone" is different from a rule for the Everyone group (Inferred).
16. **Project / Epic / Milestone / Plan.** Resolved in wave 3 (11/7/2026): the card panel row that joined epic and milestone now reads "Epic · milestone", so "Plan" names only the page and the "Plan first" choice. The filter panel still splits Epic and Milestone; "Project" is separate.

## 12. Structure observations

1. **Plan entries.** Resolved in Phase 4: one "Plan" link in the rail, palette and phone More (app/components/AppRail.vue).
2. **Sketch is reachable only from Plan.** `/sketch` has no rail link and no palette entry; it is a tab on Plan (app/pages/sketch.vue:109). Observed. Whether it is still used is unknown (Inferred).
3. **The Agents place has three kinds of page.** Live (work now), Roster (registry), Orchestrator (chat history), plus six registry sub-pages. Live and Roster answer different questions but share one nav item (app/composables/useNav.ts:16). Observed.
4. **Registry tabs.** Resolved in Phase 4: desktop and phone both use the tabs Fleet, Table (desktop only), Map, Problems, Approvals, Activity (app/components/registry/Bar.vue, Header.vue).
5. **Settings live in three places.** `/settings`, the View options (Group by, density, Show archived) and Floor zone buttons all change the same stored values (app/pages/settings.vue:138). Observed. This is deliberate, but it means an option can be found at three depths.
6. **Board tools are menus with different contents.** Desktop `⋯` (9 items), phone More (adds Select cards, Plan; drops Board report and API reference), palette Actions and Settings > Clean-up/Data all expose overlapping subsets (app/components/BoardMenu.vue:41, app/components/PhoneMore.vue:33). Observed.
7. **Features reachable only by keyboard or palette.** `J`/`K` card stepping, `R`/`M`/`A` focus jumps, `G` chords, `X` select (app/components/TicketPanel.vue:30); "Board as a table" and "Refresh the board" are in the palette and elsewhere. Observed.
8. **Hidden-by-state controls.** Start, Find duplicates, Import CSV, Reset sample data and Approve appear only when the host allows the op or the board is not read only; a person on a read-only board sees a smaller UI without being told which features exist (app/components/TicketNextMove.vue:28). Observed.
9. **Retired routes and views still accepted.** `?view=flow`, `?view=states`, `?quick=`, `tstage`, `tprio` are rewritten; old Registry `?quick=` too (app/utils/boardUrl.ts:10). Observed. Safe, but code and tests keep carrying them.
10. **Help is split across two surfaces.** `/help` (glossary), the shortcuts dialog, Settings > Keyboard shortcuts, each card's "How the board works" link and `/api` (app/pages/help.vue:48). Observed.
11. **The Floor counts and the Board count mean different things.** Floor badge = cards waiting on the owner; Board badge = all open cards; Agents badge = agents working; Shipped badge = cards shipped today (app/composables/useNav.ts:14). Observed. Four badges use four rules, only one is "needs action".
12. **Page titles and nav labels.** Resolved in Phase 4 for `/report` ("Report"), `/registry` ("Agents"), `/plan` ("Plan"), `/shipped` ("Shipped") and `/help` ("Help") (app/components/PageTitle.vue).
13. **Dense Board bar.** Resolved in wave 2 (11/7/2026): the bar holds search, Filters, the view switch, New card, Orchestrator and the tools menu. View options and Saved views moved into the Filters panel (app/components/BoardBar.vue).
14. **Admin pages are mixed into Settings.** Access sits under Settings > Account > "Open Access", and onboarding is reached from the account menu; neither is a top-level place (app/pages/settings.vue:229). Observed.
15. **The card panel is long.** Details, Steps, Done when, Original request and Thread stack in one scroll with a "Next move" band on top (app/components/TicketPanel.vue:215). Observed. Order of sections is a UX call.
16. **Jargon reaches the owner.** Mostly resolved in wave 3 (11/7/2026): "Waiting for an agent", "Done, checking", "Open to any agent" and "Confirm change" replace "Awaiting pull", "Served", "claimable" and "gate". "dispatcher", "lease", "pool", "handoff" and "ghost card" still appear in a few help lines (app/types/board.ts, app/pages/registry/index.vue:15).

## 13. Questions for the UX agent

1. **One name for the work item?** Answered 11/7/2026: "Card" everywhere. See section 11 (entry 6).
2. **How many words for "finished"?** Answered 11/7/2026: "Ready for review" for `verifying`, "Done" for `done`. See section 11 (entry 1).
3. **Should "Needs you" be one concept?** Answered 11/7/2026: yes, the Floor zone and the pills both say "Needs you"; the registry queue is "Agent problems". See section 11 (entry 3).
4. **Collapse the two Plan links (decided in Phase 4).** The rail has one "Plan" link and Sketch is a tab. See section 3.2 and section 12 (entry 1).
5. **Is Sketch worth a place?** It has no rail entry and uses browser storage. See section 12 (entry 2). Options: retire, keep as tab, or promote.
6. **Which name for the agents area?** "Agents" (nav), "Roster", "Fleet", "Registry". See section 3.8 and section 11 (entry 4).
7. **Should the three registry queues share one pattern?** Desktop uses a group of links, phone uses tabs. See section 3.5 and section 12 (entry 4). Options: tabs on both, or a menu on both.
8. **Split Orchestrator from the board manager?** Answered 11/7/2026: one panel, two named voices. See section 11 (entry 11).
9. **Where should settings live?** Settings, View options and the Floor zone buttons overlap. See section 7.2 and section 12 (entry 5). Options: keep the three entry points with one source of truth, or remove the on-screen copies.
10. **Is the Board bar too full?** Eleven controls in one row. See section 12 (entry 13). Answered in wave 2: Saved views and View options moved into the Filters panel.
11. **What should the four badges count?** See section 12 (entry 11) and section 3.1. Options: show only "needs action" counts; or label each badge so the rule is visible.
12. **Help (decided in Phase 4).** The rail item is "Help", opens `/help`, which has a Keyboard shortcuts section. See section 11 (entry 14).
13. **Which start verb?** Answered 11/7/2026: "Start" on the card, "Create and start" in the editor, with "Create" and "Plan first" as choices. See section 11 (entry 8) and section 6.5.
14. **How much agent jargon belongs in the owner's UI?** Answered 11/7/2026: plain words in labels, the technical term in a tooltip where it helps. See section 11 (entry 12) and section 12 (entry 16).
15. **Should the shortcuts match across pages?** `/` and `F` only work on two pages; `1`/`2` only on Board. See section 8. Options: add `/` to every page with a list; or show keys only where they work.
16. **Is the phone a full product or a reduced one?** Registry has no Table on phone; board tools differ; no sidebar toggle. See section 10. Options: parity for the common tasks, or an explicit "phone does these five things" list.
17. **Should archive-like actions merge?** Archive, Close, Fold, Clean up, Logged. See section 11 (entry 10) and section 5.7.
