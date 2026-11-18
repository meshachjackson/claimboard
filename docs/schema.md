# Schema

Field names and allowed values for the tables the board reads and writes. Names and enum values are exact: the board, the agent ops and the stores all use them as written. The `gov_` prefix is a name, not a dependency. Types are `string`, `number`, `boolean` and `date`. A value written as `a|b|c` is a closed list. A blank value is allowed unless the note says otherwise.

This page is a copy of the schema the board was built against. When a field changes, change it here and in `app/types/board.ts` in the same pull request.

## Tables

| Table | Key | Holds |
|---|---|---|
| `gov_tasks` | `task_id` | One row per card. |
| `gov_task_steps` | `step_id` | One row per unit of agent work on a card. |
| `gov_task_notes` | `note_id` | Notes and messages on a card. |
| `board_columns` | `column_id` | The stage columns. |
| `board_events` | `event_id` | An append-only log of board changes. |
| `board_tokens` | `agent_id` | Agent token hashes for the board. |
| `gov_registry` | `agent_id` | One row per registered agent. |

## `gov_tasks`

One row per card. Key: `task_id`.

| Field | Type | Notes and allowed values |
|---|---|---|
| `task_id` | string | TSK-nnnnnn, allocated by the writer or the board |
| `title` | string | short label for the card |
| `original_request` | string | the requester's words, verbatim; never edited after creation |
| `acceptance_requirements` | string | what done means, in checkable lines; macro verification reads only this |
| `task_type` | string | operational\|build\|upgrade |
| `proposed_assignee` | string | the orchestrator's proposal at task_create; assignment is a separate event (task_assign) |
| `assignee` | string | agt-<id> or person:<name> |
| `upgrade_target` | string | agt-<id>, only when task_type=upgrade |
| `execution_policy` | string | auto\|manual\|ask (resolved from gov_policy at assignment; ask when no row) |
| `approval_state` | string | not_required\|pending\|approved\|rejected |
| `work_state` | string | backlog\|awaiting_start\|in_progress\|needs_input\|blocked\|verifying\|done |
| `current_step` | number | pointer into gov_task_steps |
| `steps_total` | number |  |
| `outputs_ref` | string | ticket ids and evidence references, never payloads |
| `internal_verification` | string | none\|pass\|send_back\|fail plus the verdict source ticket id |
| `macro_verification` | string | none\|pass\|send_back\|fail plus the verification ticket id |
| `escalation` | string | none, or step_id plus stop_reason |
| `priority` | string | a person's call |
| `project_id` | string | board swimlane |
| `created_by` | string | person:<name> or the orchestrator agent |
| `created_at` | date |  |
| `due_at` | date |  |
| `updated_by` | string |  |
| `updated_at` | date |  |
| `stage` | string | backlog\|architecture\|build\|review\|done; blank means the board derives it (agent-board PLAN section 3) |
| `tags` | string | comma-separated lowercase slugs, each ^[a-z0-9_-]+$ |
| `archived_at` | date | set once by the board's archive_task on a done card; blank means not archived. Nothing is deleted; a gateway keeps returning the row. |
| `retry_count` | number | automatic builder retries the orchestrator has started after a verifier FAIL; blank means 0 |
| `retry_cap` | number | most automatic retries for this card; blank means 2 (Data Tables hold no column defaults, so the orchestrator applies the default) |

## `gov_task_steps`

One row per unit of agent work on a card. Key: `step_id`.

| Field | Type | Notes and allowed values |
|---|---|---|
| `step_id` | string | STP-nnnnnn |
| `task_id` | string | gov_tasks.task_id |
| `step_no` | number | ordered within the task |
| `assignee` | string | the specialist for this step: agt-<id>, or pool:<agent_type> until a claim writes the claimer's agent_id |
| `goal` | string | what the orchestrator sent that specialist |
| `input_ref` | string | previous step's output_ref when handed off |
| `target_action` | string | read unless the receiving agent's gov_access row allows more |
| `target_ticket_ref` | string | the specialist's own ticket id (AND-, GOV-, ARC-) once dispatched |
| `step_state` | string | awaiting_start\|awaiting_pull\|dispatched\|served\|needs_input\|failed\|verified (awaiting_pull: assignee's reachability is outbound_only or unreachable_when_asleep; written by the orchestrator, claimed by a gateway); verified is also set by the board's approve_plan on a served architect step |
| `stop_reason` | string | copied from the specialist's Ledger |
| `verdict` | string | copied from the specialist's Ledger |
| `budget_used` | string | attempts and tokens, copied from the specialist's Ledger |
| `output_ref` | string | reference to the Ledger row, never the payload |
| `output_summary` | string | short summary copied by a gateway; never the payload |
| `vera_ticket_ref` | string | the verification ticket that created or last changed this step |
| `created_at` | date |  |
| `dispatched_at` | date |  |
| `ended_at` | date |  |
| `updated_at` | date |  |
| `claim_key` | string | idempotency key pull:<step_id>; written by the writer when it creates the step; never changed |
| `lease_owner` | string | <puller or gateway workflow name>@<agent_id> (a gateway@... or the writer@...); blank when unclaimed |
| `lease_expires_at` | date | claim time plus lease_sec (proposed 900); host clock only; blank when unclaimed |
| `acked_at` | date | set once by the ack; an acked step is never claimable again |
| `cancelled` | boolean | true only by the orchestrator or a person; a cancelled step is never claimable |
| `claim_count` | number | incremented by every successful claim; more than 1 means a lease expired and the step was re-claimed with the same key |
| `last_claimed_at` | date | audit; set by every successful claim |
| `role` | string | architect\|builder\|consult\|auditor\|cleanup\|chat; blank on live steps means always active; chat is a board message step that belongs to no column, is never listed by the pull queue and never moves its card |
| `activity` | string | at most 140 characters of plain status; never a payload |
| `heartbeat_at` | date | host clock |
| `job_id` | string | job:<task_id>:<step_no>:<attempt>; set by the orchestrator's dispatch_job; blank on steps not run as an async job. Echoed in the a gateway callback |
| `timeout_sec` | number | seconds after dispatched_at with no heartbeat before the timeout sweep flags the step; blank means the role default in gov_config board.timeouts |
| `tokens_in` | number | input tokens the step spent, from the callback; budget_used stays the free-text field |
| `tokens_out` | number | output tokens the step spent, from the callback |

## `gov_task_notes`

Notes and messages on a card. Key: `note_id`. Append only.

| Field | Type | Notes and allowed values |
|---|---|---|
| `note_id` | string | NTE-nnnnnn |
| `task_id` | string | gov_tasks.task_id |
| `step_id` | string | blank for card-level notes |
| `author_id` | string | agt-<id> or person:<name> |
| `kind` | string | comment\|question\|proposal\|summary\|status |
| `body` | string | rule 7 as amended: at most 2,000 characters |
| `created_at` | date |  |

## `board_columns`

The stage columns. Key: `column_id`.

| Field | Type | Notes and allowed values |
|---|---|---|
| `column_id` | string | stg-<name> or st-<work_state> |
| `view` | string | stages\|states |
| `name` | string |  |
| `position` | number |  |
| `match` | string | stage=<value> or work_state=<value> |
| `hint` | string |  |
| `roles_json` | string | JSON array of {role, required, agent_types, request_types, action, pool} |

## `board_events`

An append-only log of board changes. Key: `event_id`. Append only.

| Field | Type | Notes and allowed values |
|---|---|---|
| `event_id` | string | unique; dedupe key for writers (a repeated event_id writes nothing) |
| `task_id` | string | gov_tasks.task_id |
| `step_id` | string | blank for card-level events |
| `job_id` | string | gov_task_steps.job_id; blank when no job |
| `actor` | string | agt-<id>, person:<name> or system |
| `kind` | string | status_change\|dispatch\|callback\|verify\|retry\|escalate\|timeout\|token_spend |
| `old_value` | string | value before the change; at most 500 characters, never a payload (rule 7) |
| `new_value` | string | value after the change; at most 500 characters, never a payload (rule 7) |
| `tokens_in` | number | input tokens, on token_spend and callback events |
| `tokens_out` | number | output tokens, on token_spend and callback events |
| `created_at` | date |  |

## `board_tokens`

Agent token hashes for the board. Key: `agent_id`.

| Field | Type | Notes and allowed values |
|---|---|---|
| `agent_id` | string | gov_registry.agent_id |
| `token_hash` | string | SHA-256 hex of the token (rule 7 as amended) |
| `active` | boolean |  |
| `created_at` | date |  |

## `gov_registry`

One row per registered agent. Key: `agent_id`.

| Field | Type | Notes and allowed values |
|---|---|---|
| `agent_id` | string | ^agt-[a-z0-9-]+$, unique, never reused |
| `name` | string |  |
| `description` | string |  |
| `owner` | string | a person |
| `domain` | string | personal\|catalyst\|infrastructure\|cross_domain |
| `lifecycle_status` | string | proposed\|in_development\|active\|paused\|retired\|template |
| `schema_version` | string | 1.0\|1.1\|1.2: the schema version the row was written under (form.gov-register-agent writes 1.2 from 2026-10-02; rows written earlier stay 1.0) |
| `impl_version` | string |  |
| `expected_version` | string | what the registry believes is deployed; audits compare, never overwrite |
| `last_reviewed_at` | date |  |
| `last_reviewed_by` | string |  |
| `responsibilities` | string |  |
| `expected_outputs` | string |  |
| `exclusions` | string | the never list |
| `intended_users` | string |  |
| `runtime` | string | n8n_cloud\|n8n_droplet\|n8n_local\|chatgpt\|local_tool\|local_harness\|other |
| `environment` | string |  |
| `deploy_ref` | string |  |
| `deploy_state` | string | proposed\|declared\|verified\|unknown |
| `deploy_verified_at` | date |  |
| `deploy_evidence` | string |  |
| `triggers` | string | chat\|slack\|telegram\|schedule\|workflow\|mcp\|webhook |
| `caller` | string |  |
| `input_contract` | string |  |
| `output_contract` | string |  |
| `interfaces` | string |  |
| `status_interface` | string | ledger_table\|get_agent\|read_workflow\|self_report\|none |
| `loop_contract_ref` | string |  |
| `loop_contract_version` | string |  |
| `memory_location` | string |  |
| `retention_owner` | string |  |
| `correction_path` | string |  |
| `depends_on` | string |  |
| `escalation_owner` | string |  |
| `log_location` | string | table name only, never rows |
| `incident_contact` | string |  |
| `fact_grades` | string | JSON: field -> grade for every field not covered by deploy_state |
| `notes` | string |  |
| `agent_type` | string | coordinator\|registrar\|advisor\|builder\|analyst\|bookkeeper\|locator\|template\|gateway\|door\|auditor; blank until filed; gateway is a gateway workflow outside every Container, such as the laptop puller a gateway and later the reporter a gateway; door is the owner through one Claude account, and its agent_id starts agt-door-; auditor checks another agent's work read-only and returns a verdict, and never builds |
| `type_version` | string | version of the type definition (types/<type>/) the instance runs; blank until filed |
| `host` | string | laptop\|hosted\|catalyst_cloud; where the credentials live; blank until filed |
| `inference` | string | none\|local\|cloud; blank until filed |
| `reachability` | string | addressable\|outbound_only\|unreachable_when_asleep; blank until filed |
| `request_types` | string | comma-separated request type names (draft_workflow); blank until filed |
