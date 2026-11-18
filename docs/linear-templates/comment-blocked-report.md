# Comment format: Blocked report

Not a Linear template. It is the comment an agent posts when it ends a turn with `BLOCKED <kind>`. The runner already posts one (`**Builder blocked (kind):** reason`) and the Architect posts another (`**Needs owner (kind):** ...`). This format makes both read the same.

| Field | Value |
|---|---|
| When | A turn ends with BLOCKED. |
| Kinds | `needs_input` (a question only the owner can answer, goes to the owner), `dependency` (another issue must finish, goes to the Architect), `capability` (a tool, key or access is missing, goes to the Architect), `transient` (a rate limit or network error; the runner retries twice, then stops). These match the runner in `scripts/linear-run.mjs` and `docs/linear-runner.md`. |
| Who writes it | The blocked agent, through the runner. For `needs_input` and for anything on `always_owner` in `config/authority.json`, the Architect repeats the question as a Decision needed issue. |
| Length | Under 700 characters. Lead with the kind and the one question. |

## Body

```md
**Blocked ({{needs_input, dependency, capability or transient}}):** {{the one question or missing thing, one sentence}}
**Tried:** {{what the agent already did, one line}}
**Need:** {{the answer or access that unblocks it}}. Options: a) {{...}} b) {{...}}. My pick: {{letter}}.
**Then:** delegate this issue to {{agent}} again.
```

## Filled example (example: ENG-102 - Confirm tests and CI pass on main, 11/12/2026)

The real builder comment said "Blocked (capability), so I am handing this to Architect: the runner denies `env -u NIMBLE_API_KEY pytest tests/ -q` ...". The Architect then wrote its own comment in a different shape. In the format:

```md
**Blocked (capability):** The runner denies `env -u NIMBLE_API_KEY .venv/bin/pytest tests/ -q`, so Done when line 2 cannot be run.
**Tried:** the plain `pytest` form, and the `.venv/bin/pytest` form; both are denied.
**Need:** the command added to the runner allowlist. Options: a) that one exact command b) the broader `env -u NIMBLE_API_KEY pytest *` pattern. My pick: a.
**Then:** delegate this issue to Builder (laptop) again.
```
