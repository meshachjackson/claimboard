# Template: Bug fix

Use when something that worked, or was meant to work, is broken. The fix must come with a test that fails before and passes after.

| Field | Value |
|---|---|
| Linear name | `Bug fix` (team MES, standard template) |
| Title | `Fix {{what is wrong}} in {{repo}}` |
| Filled by | The owner, the Architect, or any agent that finds the bug (as a follow-up). |
| Labels preset | `Bug` (type). Author adds one `repo:<folder>` and one `tier:`. |
| Status preset | Backlog |
| Delegate preset | none, never |
| Required before delegating | Expected, Actual, Evidence (a command or message), at least one Done when line that is a regression test. |
| Runner use | Same as Build task. The Evidence section is what the builder reproduces first. |

## Body

```md
## Summary

* **Goal:** {{one sentence: the broken thing works again}}
* **Repo and tier:** {{repo folder}} / {{early-dev or live}}
* **Owner agent:** Builder (laptop), builder {{claude or nous}}
* **Checks:** {{number}} lines below
* **Needs owner:** no

## What is wrong

* **Expected:** {{what should happen}}
* **Actual:** {{what happens}}
* **Evidence:** {{the command, URL or exact error text. Names only, no secret values.}}
* **First seen:** {{issue id and title, run, or date}}

## Done when

* [ ] {{the evidence command now gives the expected result}}
* [ ] {{a new test that failed before the fix passes: test name and the command that runs it}}
* [ ] {{the repo's full test command exits 0}}

## Out of scope

* {{related problems to file as follow-ups, not fix here}}

+++ Agent notes

* Repo folder: {{folder under ~/Code}} (default branch {{main or master}}).
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

## Filled example (illustrative: no real Bug issue exists in Linear yet)

Source: the Nous runner failure on ENG-103 - Add a CONTRIBUTING.md to example-app (Nous runner test), 11/12/2026. The runner got HTTP 400 "missing tags" from Nous Portal, and a later fix closed it. No bug issue was filed at the time. This is how the issue would have read. Everything here is a rewrite of what the comments and PR #186 say; the Done when lines are illustrative, not the lines PR #186 used.

```md
## Summary

* **Goal:** The Nous builder gets past its first model call.
* **Repo and tier:** agent-board / live
* **Owner agent:** Builder (laptop), builder claude
* **Checks:** 3 lines below
* **Needs owner:** no

## What is wrong

* **Expected:** A run labeled `agent:nous` calls Nous Portal and starts work.
* **Actual:** The run stops on its first call: Nous Portal HTTP 400, "missing tags".
* **Evidence:** The agent comment on ENG-103 - Add a CONTRIBUTING.md to example-app (Nous runner test), 11/12/2026: "The agent stopped: Nous Portal HTTP 400 ... Additional info: missing tags".
* **First seen:** ENG-103, first live Nous run.

## Done when

* [ ] The request body built in `scripts/lib/nous-agent.mjs` carries the `product=` and `user=` tags from `backends.nous.tags` in `config/authority.json`.
* [ ] A new case in `test/` fails when the tags are absent and passes when present: `node --test test/` names it and exits 0.
* [ ] `pnpm typecheck` exits 0.

## Out of scope

* Rate limits (the 429 retry_after wait is its own issue).

+++ Agent notes

* Repo folder: agent-board (default branch main). Do not call the live Nous API from a test.

+++

## Rules

* No secrets, tokens or client data in code, comments, logs or this issue. Name a variable, never its value.
* Work only in this issue's repo and worktree. Never push to main. Push, merge and deploy follow the repo's tier in `config/authority.json`; at tier live, stop at a pull request.
* Spend, secrets, deleting data, DNS, public release, agent permissions and client data are the owner's. Stop and ask.
* Blocked or unsure: finish with BLOCKED and a kind. Never guess a repo and never weaken a check.
* Stop when every line under Done when holds. Do no extra work. End with COMPLETE, REVIEW or BLOCKED.
```
