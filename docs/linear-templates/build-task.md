# Template: Build task

Use for code work in a repo an agent may change. This is the default template.

| Field | Value |
|---|---|
| Linear name | `Build task` (team MES, standard template) |
| Title | `{{verb}} {{thing}} in {{repo}}` |
| Filled by | The owner or the Architect. A builder files one only as a follow-up (see `follow-up.md`). |
| Labels preset | `Deliverable` (type), `tier:early-dev`. Author adds exactly one `repo:<folder>`. Optional `agent:nous` to pick the Nous builder. |
| Status preset | Backlog |
| Delegate preset | none, never. Delegating is the go signal. |
| Required before delegating | Goal, repo label, 1 to 5 Done when lines that each name a file, command or URL, Out of scope, Do not touch. |
| Runner use | Today the runner reads the `repo:` label, the `agent:` label and the Done when list, and the tier comes from `config/authority.json`. |

## Body

```md
## Summary

* **Goal:** {{one sentence: what is true when this is finished}}
* **Repo and tier:** {{repo folder}} / {{early-dev or live}}
* **Owner agent:** Builder (laptop), builder {{claude or nous}}
* **Checks:** {{number}} lines below
* **Needs owner:** no

## Done when

* [ ] {{a file and what it contains}}
* [ ] {{a command and its expected result}}
* [ ] {{a URL or screen and what shows there}}

## Out of scope

* {{what this issue must not change}}

+++ Agent notes

* Repo folder: {{folder under ~/Code}} (default branch {{main or master}}).
* Starting files: {{paths that exist today}}
* Do not touch: {{files, folders, settings}}
* Needs install first: {{npm ci, pip install, or none}}. If the runner refuses it, finish with BLOCKED capability.
* Depends on: {{issue id and title, or none}}. Do not delegate until it is Done.
* Never run: {{commands that spend money, write real records or call live services}}

+++

## Rules

* No secrets, tokens or client data in code, comments, logs or this issue. Name a variable, never its value.
* Work only in this issue's repo and worktree. Never push to main. Push, merge and deploy follow the repo's tier in `config/authority.json`; at tier live, stop at a pull request.
* Spend, secrets, deleting data, DNS, public release, agent permissions and client data are the owner's. Stop and ask.
* Blocked or unsure: finish with BLOCKED and a kind. Never guess a repo and never weaken a check.
* Stop when every line under Done when holds. Do no extra work. End with COMPLETE, REVIEW or BLOCKED.
```

## Filled example (example issue ENG-101, rewritten into the format)

Original: ENG-101 - Add server-side usage limits for /api/run. It ran on 11/12/2026: the first run was failed by the verifier three times because `npm run typecheck` was not on its allowlist, and the work stayed on a local branch. A later run passed the verifier and the runner pushed, opened and merged pull request 1. The rewrite adds the header, Out of scope and Rules, and an explicit "Needs install" line. Lines marked (added) are new.

```md
## Summary

* **Goal:** The app refuses the 11th run request from one client address in an hour.
* **Repo and tier:** example-lib / early-dev
* **Owner agent:** Builder (laptop), builder claude
* **Checks:** 5 lines below
* **Needs owner:** no

## Done when

* [ ] The 11th POST to /api/run from one client address inside one hour returns HTTP 429 with a Retry-After header, and the first 10 pass through.
* [ ] A new test file in tests/ proves it: `npm test` exits 0 and its output lists a passing test whose name contains "rate limit".
* [ ] `npm run typecheck` exits 0.
* [ ] `.env.example` contains the line `NUXT_RUN_LIMIT_PER_HOUR=10` and the code reads that variable with 10 as the default.
* [ ] docs/HOSTING.md no longer says the app has no server-side limiter; it states the limit, that it is per client address, and that it resets when the server restarts.

## Out of scope

* (added) No database, no new dependency, no change to the n8n workflow.

+++ Agent notes

* Repo folder: example-lib (default branch main).
* Starting files: server/api/run.post.ts, server/middleware/team-auth.ts, nuxt.config.ts, tests/contract.test.ts, .env.example, docs/HOSTING.md, docs/ARCHITECTURE.md.
* Do not touch: n8n/agent-team.json, render.yaml, shared/contract.ts, any real credential or .env file.
* Needs install first: `npm ci`. If the runner refuses it, finish with BLOCKED capability.
* Depends on: none.
* Never run: the live n8n webhook or OpenAI from a test.
* (added) Verifier allowlist must include `npm run typecheck` before this is delegated. This is the check that failed it three times.

+++

## Rules

* No secrets, tokens or client data in code, comments, logs or this issue. Name a variable, never its value.
* Work only in this issue's repo and worktree. Never push to main. Push, merge and deploy follow the repo's tier in `config/authority.json`; at tier live, stop at a pull request.
* Spend, secrets, deleting data, DNS, public release, agent permissions and client data are the owner's. Stop and ask.
* Blocked or unsure: finish with BLOCKED and a kind. Never guess a repo and never weaken a check.
* Stop when every line under Done when holds. Do no extra work. End with COMPLETE, REVIEW or BLOCKED.
```
