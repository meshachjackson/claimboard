# Registry fixtures

Synthetic fixtures for the Registry pages. Shaped like the registry tables: field names and enum values follow `docs/schema.md`.

| File | Rows | What it holds |
|---|---|---|
| `gov_registry.json` | 8 | One row per sample agent: identity, lifecycle, routing and `deploy_state` |
| `gov_access.json` | 12 | Access rows per agent, with a mix of grades and enforcement points |
| `gov_review.json` | 11 | Reviews, including two `awaiting_approval` items for the Approvals page and two open drift checks |
| `gov_history.json` | 8 | Field changes that back the reviews |
| `gov_assets.json` | 10 | Workflows and tables the sample agents own |
| `gov_policy.json` | 4 | Start and approval policy per agent and task type |
| `deployed.json` | | A drift snapshot: live agent config, container checks, unregistered findings |

## Rules

- Every row is synthetic. Synthetic IDs use the 9000nn range so they never collide with real IDs.
- Bracketed values like `[model from snapshot]` are placeholders for fields a snapshot would fill.
- No secrets, credential names or credential values.
- No private or client data. Write new rows by hand; do not copy them from a live registry.
