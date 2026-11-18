# Template: Follow-up

Use at session close or run end, for real work found but out of scope. One follow-up per issue. It is filed ready to read, never ready to run.

| Field | Value |
|---|---|
| Linear name | `Follow-up` (team MES, standard template) |
| Title | `{{verb}} {{thing}} in {{repo}}` |
| Filled by | Any agent at close, using this template through `save_issue` (the Linear MCP `get_template` text says a template can be passed to `save_issue`; not yet tried here). The owner reviews before delegating. |
| Labels preset | none. The filer copies `repo:` and `tier:` from the parent and picks one type. |
| Status preset | Backlog |
| Delegate preset | none, never. An agent must not delegate its own follow-up. |
| Required | `Found in`, why it was not done now, Done when lines. |
| Runner use | Same as Build task once delegated. Today a follow-up with a leftover `{{ }}` and a `repo:` label would still run, with the placeholders as its checks. The lint (follow-up F1 in the plan) will refuse it. |

## Body

```md
## Summary

* **Goal:** {{one sentence: what is true when this is finished}}
* **Repo and tier:** {{repo folder}} / {{early-dev or live}}
* **Owner agent:** {{agent that should take it}}, builder {{claude or nous}}
* **Checks:** {{number}} lines below
* **Needs owner:** {{yes if the owner must choose or approve first, otherwise no}}

## Why this exists

* **Found in:** {{issue id and title, or PR number and title}}
* **Not done there because:** {{out of scope, needs a decision, too big for one run}}

## Done when

* [ ] {{a file and what it contains}}
* [ ] {{a command and its expected result}}

## Out of scope

* {{what this follow-up must not grow into}}

+++ Agent notes

* Repo folder: {{folder under ~/Code}}
* Starting files: {{paths}}
* Do not touch: {{paths}}
* Depends on: {{issue id and title, or none}}

+++

## Rules

* No secrets, tokens or client data in code, comments, logs or this issue. Name a variable, never its value.
* Work only in this issue's repo and worktree. Never push to main. Push, merge and deploy follow the repo's tier in `config/authority.json`; at tier live, stop at a pull request.
* Spend, secrets, deleting data, DNS, public release, agent permissions and client data are the owner's. Stop and ask.
* Blocked or unsure: finish with BLOCKED and a kind. Never guess a repo and never weaken a check.
* Stop when every line under Done when holds. Do no extra work. End with COMPLETE, REVIEW or BLOCKED.
```

## Filled example (example: the follow-up named in the ENG-103 comment)

Source: the last comment on ENG-103 - Add a CONTRIBUTING.md to example-app (Nous runner test), 11/12/2026 (local time): "Follow-up needed: honor Nous retry_after so a free-model run can finish on its own." It was a sentence in a comment. PR #187 - Nous backend: wait out rate limits instead of failing and PR #188 - Nous rate limits: one wait budget per run were the work. The Done when lines below are written from the behavior those PRs describe (waits up to 180 seconds per call and 600 seconds per run, from `config/authority.json`); they are illustrative, not copied from either PR.

```md
## Summary

* **Goal:** A Nous run waits out a 429 rate limit and finishes on its own.
* **Repo and tier:** agent-board / live
* **Owner agent:** Builder (laptop), builder claude
* **Checks:** 3 lines below
* **Needs owner:** no

## Why this exists

* **Found in:** ENG-103 - Add a CONTRIBUTING.md to example-app (Nous runner test)
* **Not done there because:** the run stopped mid-task on HTTP 429 (retry after 95 seconds) before the verifier graded it.

## Done when

* [ ] `scripts/lib/nous-agent.mjs` sleeps for the `retry_after` seconds in a 429 answer, up to `rate_limit_max_wait_s` per call and `rate_limit_budget_s` per run from `backends.nous` in `config/authority.json`.
* [ ] A test with a fake Nous server that answers 429 once and then 200 passes: `node --test test/` exits 0.
* [ ] Past the budget the run ends with BLOCKED transient, not a silent stop.

## Out of scope

* Switching to the alternate models Nous lists in the 429 answer.

+++ Agent notes

* Repo folder: agent-board (default branch main).
* Starting files: scripts/lib/nous-agent.mjs, config/authority.json, test/linear-run.test.ts.
* Do not touch: the Claude backend path.
* Depends on: none.

+++

## Rules

* No secrets, tokens or client data in code, comments, logs or this issue. Name a variable, never its value.
* Work only in this issue's repo and worktree. Never push to main. Push, merge and deploy follow the repo's tier in `config/authority.json`; at tier live, stop at a pull request.
* Spend, secrets, deleting data, DNS, public release, agent permissions and client data are the owner's. Stop and ask.
* Blocked or unsure: finish with BLOCKED and a kind. Never guess a repo and never weaken a check.
* Stop when every line under Done when holds. Do no extra work. End with COMPLETE, REVIEW or BLOCKED.
```
