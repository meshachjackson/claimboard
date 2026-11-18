# Template: Docs-only task

Use when the whole change is documentation and the diff should touch only named files. It is the safest first task for a new agent or backend.

| Field | Value |
|---|---|
| Linear name | `Docs-only task` (team MES, standard template) |
| Title | `Document {{thing}} in {{repo}}` |
| Filled by | The owner or the Architect. |
| Labels preset | `Chore` (type). Author adds one `repo:<folder>` and one `tier:`; optional `agent:nous`. |
| Status preset | Backlog |
| Delegate preset | none, never |
| Required before delegating | Named output file, a check that the doc matches the code, a diff-limit line. |
| Runner use | Same as Build task. The diff-limit line (`git diff --stat` shows only these files) is what stops a docs run from touching code. |

## Body

```md
## Summary

* **Goal:** {{one sentence: which doc exists and what it covers}}
* **Repo and tier:** {{repo folder}} / {{early-dev or live}}
* **Owner agent:** Builder (laptop), builder {{claude or nous}}
* **Checks:** {{number}} lines below
* **Needs owner:** no

## Done when

* [ ] {{the new file exists at a path and has these headings or columns}}
* [ ] {{a command that proves the doc matches the code, for example a grep of names found in code against the doc}}
* [ ] {{a command that proves no secret value appears in the file}}
* [ ] `git diff --stat` shows only {{the named files}}.
* [ ] The repo's test command exits 0.

## Out of scope

* No code changes, no new dependencies, no deploy.

+++ Agent notes

* Repo folder: {{folder under ~/Code}} (default branch {{main or master}}).
* Read first: {{files to describe}}
* Do not touch: everything outside the named files.
* Depends on: {{issue id and title, or none}}

+++

## Rules

* No secrets, tokens or client data in code, comments, logs or this issue. Name a variable, never its value.
* Work only in this issue's repo and worktree. Never push to main. Push, merge and deploy follow the repo's tier in `config/authority.json`; at tier live, stop at a pull request.
* Spend, secrets, deleting data, DNS, public release, agent permissions and client data are the owner's. Stop and ask.
* Blocked or unsure: finish with BLOCKED and a kind. Never guess a repo and never weaken a check.
* Stop when every line under Done when holds. Do no extra work. End with COMPLETE, REVIEW or BLOCKED.
```

## Filled example (example issue ENG-104)

Original: ENG-104 - Document every environment variable in example-lib (Nous runner test 2), 11/12/2026. It already carried good Done when lines. What it lacked: a header the owner could scan, and its "do not delegate until the retry_after fix is merged" rule sat in prose under Agent notes, so the issue was delegated first. The comments on it show a Nous 429 rate limit (retry after 139 seconds) on its first run. The rewrite moves that into a `Depends on` line.

```md
## Summary

* **Goal:** One table lists every environment variable example-lib reads, with no values.
* **Repo and tier:** example-lib / early-dev
* **Owner agent:** Builder (laptop), builder nous
* **Checks:** 6 lines below
* **Needs owner:** no

## Done when

* [ ] `docs/ENVIRONMENT.md` exists.
* [ ] Every `NUXT_` name found by `grep -rhoE "NUXT_[A-Z0-9_]+" server app shared nuxt.config.ts .env.example render.yaml README.md | sort -u` appears in `docs/ENVIRONMENT.md`.
* [ ] The table has the columns Name, Purpose, Required, Set where.
* [ ] `grep -nE "sk-|Bearer [A-Za-z0-9]" docs/ENVIRONMENT.md` prints nothing.
* [ ] README.md links to `docs/ENVIRONMENT.md` under "Project map" (`grep -n "ENVIRONMENT.md" README.md` prints a line).
* [ ] `npm test` exits 0, and `git diff --stat` shows only `docs/ENVIRONMENT.md` and `README.md`.

## Out of scope

* No code changes, no dependencies, no deploy.

+++ Agent notes

* Repo folder: example-lib (default branch main). Read `.env.example`, `nuxt.config.ts`, `server/`, `render.yaml` and README "What you must provide".
* Do not touch: everything outside the two named files.
* Depends on: the pull request that makes the Nous backend wait out rate limits (not an issue; a pull request, so the lint can only check an issue id. Illustrative: file it as an issue and name that issue here). Do not delegate until it is Done.
* The `nous` label routes this to the Nous backend. A Nous run stops at a pull request by design (`may_merge` false).

+++

## Rules

* No secrets, tokens or client data in code, comments, logs or this issue. Name a variable, never its value.
* Work only in this issue's repo and worktree. Never push to main. Push, merge and deploy follow the repo's tier in `config/authority.json`; at tier live, stop at a pull request.
* Spend, secrets, deleting data, DNS, public release, agent permissions and client data are the owner's. Stop and ask.
* Blocked or unsure: finish with BLOCKED and a kind. Never guess a repo and never weaken a check.
* Stop when every line under Done when holds. Do no extra work. End with COMPLETE, REVIEW or BLOCKED.
```
