# Linear agents: overview

One page on the agents that work Linear issues, what each does, and what is live. Written 11/12/2026 from the repo docs and config. Details live in the pages linked under each agent. If this page and a linked page disagree, the linked page wins; fix this one.

## The idea in four lines

1. You delegate a Linear issue to an agent.
2. The agent does the work in a git worktree and reports back in Linear.
3. A separate verifier checks the result against the issue's "Done when" lines.
4. What the agent may push, open or merge comes from `config/authority.json`, by repo tier.

## The agents

| Agent | What it does | Where it runs | Status |
|---|---|---|---|
| Builder (laptop) | Takes a delegated issue, builds it in a worktree, ends with `COMPLETE`, `REVIEW` or `BLOCKED <kind>`. | `scripts/linear-run.mjs`, launchd job `<label-prefix>.linear-run`, polls Linear every 60 seconds | Live. Login and one test issue verified 11/12/2026. |
| Architect | Takes issues a builder blocked on `dependency` or `capability`. Rules from `docs/architect-policy.md`, read-only. Hands the issue back to the builder, or asks the owner. In the cloud it also designs every new issue first. | `scripts/linear-architect.mjs`, launchd job `<label-prefix>.linear-architect`, which skips repos on `cloud_repos`; for those, an `architect` job of `.github/workflows/linear-agent.yml` | Laptop: live, first ruling verified 11/12/2026. Cloud: built, not run live yet. |
| Verifier | Grades the builder's result against "Done when". Read-only. PASS or FAIL. On the laptop the runner calls it after each builder turn. In the cloud it is its own app user: delegated to after the builder opens a pull request, and on PASS the job's code merges and waits for the deploy. | The `loop-verifier` Claude agent: inside the laptop runner, or a `verifier` job of `.github/workflows/linear-agent.yml` | Live inside the laptop runner. Cloud job built, not run live yet. |
| Builder (cloud) | Builds an issue in a repo on `cloud_repos`, pushes `linear/<id>-run`, opens a pull request and hands it to the Verifier. | A `builder` job of `.github/workflows/linear-agent.yml` (`scripts/linear-job.mjs`), started by the webhook receiver or the 15-minute sweep | Built, not run live yet. |
| Nous builder | An alternative builder backend on a Nous Portal model. Picked by an `agent:nous` label or `LINEAR_RUN_BACKEND`. Stops at a pull request. | `scripts/lib/nous-agent.mjs` | Enabled in `config/authority.json`, `may_merge` false. |

The bridge (`bridge/`) is not an agent. It is a draft n8n workflow that answers Linear's webhook inside 5 seconds and forwards events to hosts. It is not created or published, and `bridge/routes.json` still has placeholder URLs. The laptop runner works without it.

## How one issue flows

1. The issue has exactly one `repo:<folder>` label, a "Done when" line with bullets, and the builder as delegate.
2. The runner makes a worktree on branch `linear/<issue id>-run` and starts the builder.
3. The verifier grades. FAIL goes back to the builder, up to `limits.max_retries` times, then the issue stops with an error.
4. On PASS the runner acts by tier: push the branch, open a pull request, and merge only where the tier allows and `merge_requires` is met.
5. The issue moves to In Review or Done, and the delegate is cleared.
6. A block goes to the Architect (`dependency`, `capability`) or to the owner (`needs_input`). A transient error gets two free retries.

Full table of outcomes: `docs/linear-runner.md`. In a repo on `cloud_repos`, each step is its own GitHub Actions job instead, and the issue moves through the statuses Architecting, Building, Verifying, Deploying and Done (`docs/linear-runner.md`, "Cloud worker").

## What agents may do: `config/authority.json`

| Tier | Push | Pull request | Merge | Repos |
|---|---|---|---|---|
| `early-dev` | yes | yes | yes, after checks and verifier pass | example-app-a, example-app-b, example-app-c |
| `early-dev-no-checks` | yes | yes | yes, after verifier pass | example-app |
| `live` (default for unlisted repos, including agent-board) | yes | yes | no | everything else |
| `client` | no | no | no, nothing starts | client-repo-a, client-repo-b, client-repo-c |

- Limits: $2 per run, $30 per day, 2 retries.
- Never done by any agent: deploy through `vercel`, force push, push to main, publish a package, add a dependency.
- The Architect may decide: scope, approach, naming, which agent, retry or split, close stale.
- Always the owner: new spend or vendor, secrets, deleting data or repos, DNS, public release, agent permissions, client data.

## Controls

- Kill switch: create `~/.config/os/linear-run.off`. Delete it to resume. Cloud jobs: the repo variable `AGENT_LOOP_ENABLED` (anything but `true` stops them), and a run limit of `limits.runs_per_day` (default 40).
- Daily spend file: `~/.config/os/linear-run.json`.
- Claude login: the runner needs a long-lived Claude token in its environment (`claude setup-token`).
- Logs: `/tmp/linear-run.log`, `/tmp/linear-architect.log`.
- Tests: `node --test test/linear-run.test.ts test/linear-job.test.ts`.

## Names of secrets (values never in the repo)

`LINEAR_RUN_TOKEN`, `LINEAR_ARCHITECT_TOKEN`, `LINEAR_ARCHITECT`, `LINEAR_BUILDER`, `CLAUDE_CODE_OAUTH_TOKEN`, `LINEAR_NOUS_API_KEY`. Cloud jobs: `LINEAR_<ROLE>_CLIENT_ID`, `LINEAR_<ROLE>_CLIENT_SECRET` (ROLE is ARCHITECT, BUILDER or VERIFIER), `AGENT_GH_TOKEN`, `AGENT_GH_WRITE_TOKEN`. Bridge only: `LINEAR_WEBHOOK_SECRET_<KEY>`, `LINEAR_TOKEN_<KEY>`, `LINEAR_BRIDGE_ROUTES`, `LINEAR_BRIDGE_FORWARD_SECRET`.

## Where to read more

| Question | Page |
|---|---|
| How do I run the runner or the Architect? | `docs/linear-runner.md` |
| How does the Architect judge? | `docs/architect-policy.md` |
| How do I write an issue the runner accepts? | `docs/linear-templates/` |
| How do I add another builder? | `docs/linear-runner.md`, section "Backends" |
| How would the bridge go live? | `bridge/README.md` |

## Known gaps

- Several Linear API behaviors are still unverified live (clearing the delegate, delegating to another app, which session the runner reads). The list is in `docs/linear-runner.md`.
- The runner still imports six functions from `scripts/board-run.mjs`. Move them to `scripts/lib/` before that file is deleted.
- `docs/runner-actions.md` describes an older hosted runner and may be partly obsolete.
