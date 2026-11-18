# Template: Agent or backend test

Use for the first real run of a new agent, model or runner backend. The task is deliberately small so a failure points at the agent, not the task.

| Field | Value |
|---|---|
| Linear name | `Agent or backend test` (team MES, standard template) |
| Title | `{{small docs task}} in {{repo}} ({{agent}} test)` |
| Filled by | The owner, or the session that built the backend. |
| Labels preset | `Chore` (type), `tier:early-dev`. Author adds the `repo:` label and the `agent:` child label under test. |
| Status preset | Backlog |
| Delegate preset | none, never. The owner delegates when ready. |
| Required | A docs-only target, the backend under test, a "What to record" list, and a `Depends on` line for any fix still unmerged. |
| Runner use | Same as Build task. The "What to record" list is for the person reading the result, not for the verifier. |

## Body

```md
## Summary

* **Goal:** {{agent or backend}} completes one small docs task end to end.
* **Repo and tier:** {{repo folder}} / early-dev
* **Owner agent:** Builder (laptop), builder {{backend under test}}
* **Checks:** {{number}} lines below
* **Needs owner:** yes, to delegate it and to read the result

## Done when

* [ ] {{the one new file exists with these headings}}
* [ ] {{a command that proves it matches the code}}
* [ ] The repo's test command exits 0, and `git diff --stat` shows only {{the named files}}.

## Out of scope

* No code, no dependencies, no deploy.

+++ Agent notes

* Repo folder: {{folder under ~/Code}} (default branch {{main or master}}).
* Backend under test: {{name}}. It stops at a pull request ({{may_merge false or true}} in `config/authority.json`).
* Depends on: {{issue id and title of any unmerged fix, or none}}. Do not delegate until it is Done.

+++

## What to record

Fill after the run, in a comment.

* Did it reach a finishing line (COMPLETE, REVIEW or BLOCKED)? {{yes or no}}
* Did the verifier grade it? {{yes or no}}
* Where did it stop, and the exact error text: {{text}}
* Cost: {{dollars from the run summary}}
* Number of times the owner touched it: {{count}}

## Rules

* No secrets, tokens or client data in code, comments, logs or this issue. Name a variable, never its value.
* Work only in this issue's repo and worktree. Never push to main. Push, merge and deploy follow the repo's tier in `config/authority.json`; at tier live, stop at a pull request.
* Spend, secrets, deleting data, DNS, public release, agent permissions and client data are the owner's. Stop and ask.
* Blocked or unsure: finish with BLOCKED and a kind. Never guess a repo and never weaken a check.
* Stop when every line under Done when holds. Do no extra work. End with COMPLETE, REVIEW or BLOCKED.
```

## Filled example (example issue ENG-103)

Original: ENG-103 - Add a CONTRIBUTING.md to example-app (Nous runner test), 11/12 and 11/13/2026. The comments show two stops on HTTP 400 "missing tags" and a third on a 429 rate limit (retry after 95 seconds); the result was merged by hand with the runner's verifier never grading it. The rewrite adds the header, the "What to record" list (filled with what actually happened), and a `Depends on` line that would have held the delegation until the tags fix landed.

```md
## Summary

* **Goal:** The Nous backend completes one small docs task end to end.
* **Repo and tier:** example-app / early-dev
* **Owner agent:** Builder (laptop), builder nous
* **Checks:** 6 lines below
* **Needs owner:** yes, to delegate it and to read the result

## Done when

* [ ] `CONTRIBUTING.md` exists at the repo root.
* [ ] It has three headings: "Add an app", "Check your change", "Open a pull request".
* [ ] "Check your change" tells the reader to run `npm test` and `npm run build`, and `grep -n '"test"\|"build"' package.json` prints two lines.
* [ ] The required catalog fields it lists match what `scripts/validate-catalog.mjs` checks.
* [ ] `grep -n "CONTRIBUTING.md" README.md` prints a line.
* [ ] `npm test` exits 0, and `git diff package.json` is empty.

## Out of scope

* No code, no dependencies, no deploy.

+++ Agent notes

* Repo folder: example-app (default branch main).
* Backend under test: nous. It stops at a pull request (`may_merge` false in `config/authority.json`).
* Depends on: the Nous request-tags fix (merged). Do not delegate until it is Done.

+++

## What to record

(filled from the comments on ENG-103; illustrative layout, real facts)

* Did it reach a finishing line? No. It stopped on HTTP 429 (retry after 95 s).
* Did the verifier grade it? No. Claude checked the six lines by hand.
* Where did it stop: first two tries HTTP 400 "missing tags"; third try HTTP 429 rate limit.
* Cost: $0 (free model).
* Times the owner touched it: 3 delegations and 1 merge request.

## Rules

* No secrets, tokens or client data in code, comments, logs or this issue. Name a variable, never its value.
* Work only in this issue's repo and worktree. Never push to main. Push, merge and deploy follow the repo's tier in `config/authority.json`; at tier live, stop at a pull request.
* Spend, secrets, deleting data, DNS, public release, agent permissions and client data are the owner's. Stop and ask.
* Blocked or unsure: finish with BLOCKED and a kind. Never guess a repo and never weaken a check.
* Stop when every line under Done when holds. Do no extra work. End with COMPLETE, REVIEW or BLOCKED.
```
