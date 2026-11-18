# The Linear runner

`scripts/linear-run.mjs` works Linear issues that are delegated to its app user. For each one it finds the repo, runs a builder agent in the issue's own git worktree, has a separate verifier grade the result against the issue's "Done when" lines, and reports to Linear as agent activities. What it may push, open and merge comes from `config/authority.json`, read fresh for every issue.

Written 11/12/2026. It has run live on the laptop since 11/12/2026 (test issues, login and handoff verified); the items in the last section are still unchecked. Overview of all the agents: `docs/linear-agents.md`.

## How to run it

Use Node 24 (`nvm use`).

```bash
node scripts/linear-run.mjs --dry-run
```

Lists what it would start and writes nothing: no Linear write, no agent, no git, no `gh`. It reads the runner's app user and its delegated issues, then prints one line per issue.

```bash
node scripts/linear-run.mjs --once
```

Works the queue one time and exits.

```bash
node scripts/linear-run.mjs --poll 60
```

Keeps running and checks Linear every 60 seconds. The bridge (`bridge/`) answers Linear's webhook inside 5 seconds and posts the first activity, so the runner only needs to poll.

What an issue needs:

- The runner's app user as its delegate.
- Exactly one `repo:<folder>` label, where `<folder>` is a git repo directly under the code folder (`~/Code`). The name must match the folder exactly, capitals included, because the authority file lists repos by exact name. A worktree folder does not count as a repo. No label, two labels, a name that is not a plain folder, or no repo there: the runner asks in Linear and starts nothing. It never guesses.
- A "Done when" line followed by bullet lines. The verifier grades against these. With none, the check is "the issue is resolved".

The runner works one issue at a time, urgent first, then oldest.

To stop it starting new work, create the kill switch file `linear-run.off` in the settings folder (`~/.config/os`). Delete the file to resume. Today's spend is kept in `linear-run.json` in the same folder. These are the runner's own files, separate from the board runner's `board-run.off` and `board-run.json`.

Limits come from `limits` in `config/authority.json`: `per_run_usd` caps each builder attempt and each verifier pass, `per_day_usd` stops new runs for the day, `max_retries` is how many times a verifier FAIL goes back to the builder.

Tests: `node --test test/linear-run.test.ts`. They use a fake Linear API, a fake agent and fake git and `gh`. Nothing leaves the machine.

## The env names

Names only. Values live in `~/.config/os/secrets.env` or the shell, never in this repo.

| Name | What it is |
|---|---|
| `LINEAR_RUN_TOKEN` | The runner app user's Linear token. Read in `scripts/lib/linear-api.mjs` only. Never printed or logged, and never passed to the agent. Required. |
| `LINEAR_ARCHITECT` | The name of the architect app user in Linear. Blocked work is handed to this user. Unset means every block goes to the owner. |
| `LINEAR_RUN_CODE` | The folder that holds the repos. Default `~/Code`. |
| `OS_CONF` | The settings folder for the kill switch and spend files. Default `~/.config/os`. |

The builder and verifier get the runner's environment with every name containing TOKEN, SECRET, PASSWORD or KEY removed, except `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` (the Claude program's long-lived login).

## How handoff works

Every run ends by taking the issue off the runner's queue. So "delegated to the runner" always means "work to do", and the runner does not pick the same issue up again on the next poll.

| What happened | Linear activity | Where the issue goes |
|---|---|---|
| No usable `repo:` label | `elicitation` asking which repo | Delegate cleared. Fix the label and delegate again. |
| The repo's tier is `client` | `error` | Delegate cleared. No worktree is made and no agent starts. |
| Builder ends with COMPLETE, verifier says PASS | `response` | Acts by authority (below), then In Review or Done, delegate cleared. |
| Builder ends with REVIEW, verifier says PASS | `response` | Pushed and a pull request opened if allowed. Never merged. In Review. |
| Verifier says FAIL | `thought` with the reasons | Back to the builder, up to `max_retries` more times. Then `error`, delegate cleared, work left on the local branch. |
| `BLOCKED needs_input` | `elicitation` to the owner | Delegate cleared. |
| `BLOCKED dependency` or `BLOCKED capability` | `elicitation` naming the architect | Delegate set to the architect. With no architect found, it goes to the owner instead. |
| `BLOCKED transient`, or a rate limit or network error | none while retrying | Two free retries, then `error`, delegate cleared. |
| A turn with no finishing line | none while nudging | Two reminders in the same agent session, then `error`, delegate cleared. |

Acting by authority, after COMPLETE and PASS. Each step happens only if `may(authority, repo, action)` says yes:

1. `push_branch`: the runner pushes the branch `linear/<issue id>-run`.
2. `open_pr`: the runner opens a pull request with `gh pr create`.
3. `merge`: the runner merges with `gh pr merge --squash`, but only when every item in the tier's `merge_requires` is met. `verifier_pass` is met by the PASS. `checks_pass` is met when `gh pr checks --watch` exits clean. An item the runner does not know counts as unmet. A repo with no checks at all counts as unmet, so that pull request waits for the owner.

A merged issue moves to the team's first completed status. Anything else moves to In Review (or the first started status if the team has no status named In Review).

The runner does not deploy. `vercel` is denied on every run. A deploy happens only through whatever the repo already does on a merge.

After a merge, the closing `response` on the issue adds one sentence from `deploy_on_merge` in `config/authority.json`: what ships on merge and where to watch it, or `Merged, not deployed.` with the gap. It only describes. A tier's `deploy: true` does not make the runner deploy, and a repo with no entry gets the "not deployed" sentence.

The builder's tools follow the same file. The deny list is built per run:

- Always denied: `vercel`, `rm -rf`, package publishes, dependency adds, force pushes, pushes to main.
- `git push` is denied unless `push_branch` is true.
- All of `gh` is denied unless `open_pr` is true. When it is true, only `gh pr create` is allowed.
- `gh pr merge` is allowed only when `merge` is true and `merge_requires` is empty. When a merge has requirements, the builder cannot merge. The runner checks the requirements and merges itself.

This removes the old contradiction, where the publish step told the agent to push while the deny list refused every push. The prompt tells the builder not to push, open pull requests or merge, because the runner does that after the verifier passes. In an `early-dev` or `live` repo the tool lists would still let a builder push or open a pull request before the verifier runs. It cannot merge there.

If a Linear write fails in the middle of a run, the runner logs it and leaves that issue alone until the runner restarts, so a broken write cannot cause a loop.

## What came from board-run.mjs

`scripts/board-run.mjs` is unchanged. The runner uses these parts of it.

Imported as they are:

- From `scripts/board-run.mjs`: `baseFor` (which branch a worktree starts from), `childEnv` (strips secrets from the agent's environment), `parseClaudeJson`, `parseVerdict`, `verifierCommand` (the `loop-verifier` agent with read-only tools) and `blockedByEnvironment`.
- From `app/utils/dispatch.ts`: `parseEnd`, `FINISH_RULES`, `nudgeText`, `MAX_NUDGES`, `MAX_TRANSIENT` and `isTransient`. This is the COMPLETE, REVIEW or BLOCKED finishing line and its two-nudge rule.

Copied, because `board-run.mjs` does not export them or hard-codes board names. Each copy has a comment naming its source:

- `AGENT_TOOLS` (the allow list), unchanged.
- `gate` and `recordSpend` (kill switch and daily cap), with the runner's own file names.
- `worktreeFor`, with branch `linear/<issue id>-run` in place of `board/<task id>-run`.
- `exec`, `agentCommand` and the verifier call, adapted to take per-run tool lists and an issue in place of a card.
- The turn loop from `runStep`: free retries for transient errors, two nudges, then stop.

Not carried over: board claims and leases, heartbeat timers, the architect plan role, the orchestrator's chat steps, the cloud wake and the push stream. The always-on deny of `git push` and `gh` is replaced by the per-run lists above.

When `scripts/board-run.mjs` retires in Wave 3, the six imported functions must move first (for example into `scripts/lib/`), or the runner will stop loading.

## What is unverified against the live Linear API

Field and mutation names were checked on 11/12/2026 against Linear's developer pages (`linear.app/developers/agents`, `linear.app/developers/agent-interaction`) and Linear's public GraphQL schema file. No call has been made to the live API. Confidence is Medium until one real run.

Confirmed in the schema or pages, not yet tried live:

- `agentActivityCreate` with `agentSessionId` and `content` (`type` of `thought`, `elicitation`, `response`, `error`, with `body`).
- `issueUpdate` with `delegateId` and `stateId`.
- `agentSessionCreateOnIssue` with `issueId`.
- `viewer { id }`, the `agentSessions` query, the `delegate` issue filter, the team `states` query and the `users` filter.

Unverified, to check on the first live run:

1. Whether `issueUpdate` accepts `delegateId: null` from an app user's token to clear the delegate. Every terminal ending relies on it.
2. Whether an app user may set another app user as delegate (the architect handoff). The schema says delegation "requires permission to invoke that agent".
3. Whether the `agentSessions` query, called with an app token, returns the session Linear opened when the issue was delegated. If it does not, the runner opens a second session with `agentSessionCreateOnIssue` and its activities land in a different thread from the bridge's first activity.
4. Whether the `users` query returns app users, so `LINEAR_ARCHITECT` can be found by name.
5. Whether the issue filter `delegate: { id: { eq: <app user id> } }` works with an app token.
6. Session timing. Linear marks a session stale after 30 minutes with no activity. The runner posts an activity at each stage but has no timer, so a long builder turn may show as stale. Linear's pages say a later activity recovers it.
7. Which activity Linear treats as closing the session. The runner ends with `response`, `error` or `elicitation` and sets no `signal`.
8. The token's lifetime. Linear's pages say an app token from the authorization-code flow lasts 24 hours and a client-credentials token lasts 30 days. The runner does not refresh tokens.
9. The team status named "In Review". The runner looks for that name and falls back to the first started status.
10. The checks race. `gh pr checks` can exit with an error before checks register on a new pull request. An `early-dev` merge may then stop at In Review even in a repo that has checks.
11. Unpushed commits on local `main`. The worktree starts from local `main` when it is ahead of origin (`baseFor`). The pull request then carries those commits too, and an `early-dev` repo would merge them.
12. Label groups. If `repo` is a Linear label group with child labels, the API may return only the child's name, and the `repo:` prefix would not match. The runner expects flat labels named `repo:<folder>`.
13. The real `claude`, `git push` and `gh` calls. Tests fake all of them. `gh pr checks --watch` on a repo with slow checks will hold the runner, since it works one issue at a time.

## The Architect

`scripts/linear-architect.mjs` is a second small program with its own Linear identity (the Architect app). It works issues a builder handed over because it was blocked.

```bash
node scripts/linear-architect.mjs --dry-run
```

```bash
node scripts/linear-architect.mjs --once
```

- It reads the issue, the builder's block reason and the repo, read-only. It cannot edit, commit, push or merge.
- It rules from `docs/architect-policy.md`. Edit that file to change how it judges.
- What it may decide is the `architect_may_decide` list in `config/authority.json`. A kind on `always_owner`, or on neither list, goes to the owner whatever the agent wrote.
- A decision is posted as a comment that starts "Handoff: Architect to ..." (`docs/linear-templates/comment-handoff.md`), and the issue is delegated to the builder again. The builder's next run reads the issue's last 10 comments.
- A question for the owner is posted as a comment that starts "Blocked (kind)" (`docs/linear-templates/comment-blocked-report.md`; the runner's own block comments use the same shape, all under 700 characters), asked in the agent session, and the issue is left with no agent. Answer in a comment and delegate the issue to the builder again.
- After more rulings on one issue than `limits.max_retries`, the next block goes to the owner.
- Env: `LINEAR_ARCHITECT_TOKEN` (required; mint it with `node scripts/linear-token.mjs LINEAR_ARCHITECT_TOKEN` using the Architect app's client ID and secret), `LINEAR_BUILDER` (the builder's name, default "Builder (laptop)"). It shares the runner's daily cap, spend file and kill switch.

Unverified until a live block happens: that one agent's token may set another agent as the delegate, and that an agent's token may add a comment.

### Tuning the Architect

Three files change how the Architect works. Each is read fresh on every run, from the checkout the Architect runs in, so a change takes effect once it is merged and that checkout is pulled. No restart.

| File | What it changes |
|---|---|
| `docs/architect-policy.md` | How it judges: the steps, the standards, when to escalate. |
| `config/authority.json` | What it may decide alone (`architect_may_decide`), what always goes to the owner (`always_owner`), spend and retry limits (`limits`). |
| `docs/architect-stack.md` | The platforms the owner prefers, when to use each, and links to their official docs. |

The stack file is the Architect's knowledge of current infrastructure. Its text goes into the ruling and design prompts. Every `https://` link's host becomes a `WebFetch(domain:<host>)` entry on the Architect's allow list (`architectTools` in `scripts/linear-architect.mjs`), so it can read the current docs on those sites and no others. `WebSearch` is denied. Builders do not get web access from this file. Checked live 11/16/2026 with claude 2.1.318 in `dontAsk` mode: that build has no direct WebFetch tool, so the Architect fetches through the built-in `web-fetch` subagent, and the domain rules still apply there (vercel.com/docs fetched, example.com refused). A platform missing from the file is a new vendor and goes to the owner as `new_spend_or_vendor`.

## Up-front design

An issue with the label `needs:design` gets a design pass from the Architect before any builder starts. The label is a plain label with that exact name. The owner creates it in Linear by hand, once. Nothing here creates it.

- The issue must be delegated to the Architect. The Architect only sees issues delegated to it. An issue with the label that is delegated straight to the builder skips the design; `scripts/linear-run.mjs` does not check the label yet.
- The Architect reads the issue and the repo, read-only, and posts one comment that starts "Design:" with Approach, Files, Risks and Decisions. It stays under 780 characters, because a builder reads each comment cut to 800.
- Each decision it makes is a kind. If every kind is on `architect_may_decide`, the issue is delegated to the builder. If any kind is on `always_owner` or on neither list, or the Architect ends with a question, it posts a "Blocked (kind)" comment, asks in the session and leaves the issue with no agent. A reply it cannot read also goes to the owner, with no design posted.
- A designed issue never gets a second design. If the builder later blocks and the issue comes back, the Architect rules on it as before. The code is `scripts/lib/architect-design.mjs`.

## Backends

The builder is Claude by default. An issue can pick another builder by adding a child of the Linear label group `agent` (for example `nous`; the runner reads it as `agent:nous`); the runner process can pick one with env `LINEAR_RUN_BACKEND`; `backends.default` in `config/authority.json` is the fallback. The verifier is always Claude.

| Backend | What it is | Switch |
|---|---|---|
| `claude` | The Claude CLI in the issue's worktree. The default, no entry needed. | none |
| `nous` | A Nous Portal model (free ones included) through `scripts/lib/nous-agent.mjs`: a tool loop with the same allow and deny lists, finishing line and caps. | `backends.nous.enabled` in `config/authority.json`, shipped `false` |

A backend that is off, unknown or named twice makes the runner ask in Linear and start nothing. A non-Claude builder stops at a pull request, even in an `early-dev` repo, until `backends.<name>.may_merge` is `true`.

Names only: `LINEAR_NOUS_API_KEY` (the Nous Portal key; the `LINEAR_` prefix is what lets the launchd runner load it from `~/.config/os/secrets.env`). Everything else about the Nous backend (`base_url`, `model`, timeouts, prices) is in `backends.nous`.

## Cloud worker

The cloud worker runs the same agents on GitHub Actions, one role per job, for repos on `cloud_repos` in the authority file. Nothing waits on a laptop. The code is `scripts/linear-job.mjs`. It keeps no state of its own: each step reads the issue as it is now (delegate, status, labels, the last 50 comments) and acts on that. A step whose role is not the issue's delegate exits and changes nothing, so a duplicate or lost dispatch does no harm.

### How an issue moves

| Status | Who holds it | What the job does |
|---|---|---|
| Architecting | Architect | Designs every new issue (as if it had `needs:design`), or rules on a builder's block. Then delegates to `Builder (cloud)` and sets Building. A decision that is the owner's sets Blocked and clears the delegate. |
| Building | Builder (cloud) | Builds on branch `linear/<id>-run` and commits. A separate step pushes, opens the pull request (or reuses the open one), delegates to `Verifier` and sets Verifying. `agent:nous` picks the Nous builder. A `needs_input` block sets Blocked and hands the issue to the owner; other blocks go to the Architect. |
| Verifying | Verifier | `loop-verifier` checks the branch against "Done when", read-only. FAIL: a `**Verifier: FAIL**` comment with the reasons, and back to `Builder (cloud)`. The retry count is the number of those comments; past `limits.max_retries` the issue goes to the owner. PASS: the next step merges. |
| Deploying | Verifier | The job's code, not the model, merges the verified commit (`gh pr merge --squash --match-head-commit`), only when the authority file allows a merge and `merge_requires` is met. Then it waits up to 10 minutes for the commit status named in `deploy_on_merge.<repo>.status_context` on the merge commit. |
| Done | nobody | The deploy status succeeded. The job posts its link. On a timeout the job says "Merged, deploy not confirmed", clears the delegate and leaves Deploying. A failed deploy sets Blocked. |

Add the statuses Architecting, Building, Verifying, Deploying and Blocked to the Linear team by hand. A missing one falls back to the team's first "started" status. If the team's Git automation moves issues on pull request events (to In Review when a pull request opens, to Done when it merges), turn that off for the team: otherwise the status can read In Review during verification, and Done will not mean deployed.

### Input contract (`.github/workflows/linear-agent.yml`)

The receiver and the sweep start a job with `workflow_dispatch` on `main`. The run is named `<role> <issue>`; the sweep reads that name to see which issues already have a job.

| Input | Required | Value |
|---|---|---|
| `role` | yes | `architect`, `builder` or `verifier`: the role of the app user the event is for. |
| `issue` | yes | The issue identifier, like `ENG-12`. |
| `session` | no | The Linear agent session id from the event. Empty: the job uses the open session of its app user on the issue, or opens one. |
| `prompt` | no | The comment text from a `prompted` session event. The Architect answers it as a response; the builder reads it as part of the work. Leave it empty for a `created` event. |
| `repo` | yes | The target repo name, which must be on `cloud_repos` and match the issue's `repo:` label. |

Jobs on one issue run one at a time (`concurrency: linear-issue-<issue>`, queued, never cancelled). GitHub keeps one waiting run per group and drops older waiting ones; that is safe because every job reads Linear's current state when it starts. Each job has a 45-minute timeout.

### Steps and tokens

| Step | GitHub token | What it does |
|---|---|---|
| Check out the target repo | `AGENT_GH_TOKEN` (read), only after the repo is checked against `cloud_repos` | `persist-credentials: false`, so no later step inherits it. |
| Gate | the job's own token (`actions: read`) | Kill switch, today's run count, `cloud_repos`, and "is this role the delegate". Posts "Paused" when stopped. |
| Work | none | The architect's design or ruling, the builder's build, the verifier's verdict. The only step that runs a model. |
| Publish (builder) | `AGENT_GH_WRITE_TOKEN` | Push and pull request. No model runs here. |
| Merge (verifier, PASS only) | `AGENT_GH_WRITE_TOKEN` | Merge by authority, then the deploy wait. No model runs here. |
| Report a crash | none | Runs when an earlier step failed or the job timed out and nothing was reported: one `error` activity, and the issue goes to the owner. |

A fine-grained GitHub token cannot allow a push and refuse a merge, so the builder's publish step holds the same write secret as the merge step. The model never runs in either, and neither trusts the model's checkout with the token: git copies the branch into a fresh bare repo (no hooks, no repo config) and pushes from there, and gh runs outside the checkout. The merge step also requires a `**Verifier: PASS** on <commit>` comment, posted by the verdict step's code, that is newer than any FAIL. The model's environment drops every name with TOKEN, SECRET, PASSWORD or KEY except the Claude login, and the step-output files, so it cannot hand a verdict to the merge step. Steps pass results through step outputs, written by `linear-job.mjs` after the model has exited.

### Limits and switches

- Kill switch: the repo variable `AGENT_LOOP_ENABLED`. Anything but `true` stops new work; a job posts "Paused" and changes nothing.
- Run limit: `limits.runs_per_day` in the authority file, default 40 runs of `linear-agent.yml` a day (UTC). It stands in for the dollar cap, which does not apply to a Claude login token. Count your Actions minutes against it: on a private repo the free allowance is small.
- Egress: the job limits outbound hosts to `scripts/linear-egress-hosts.txt` with `scripts/runner-egress.py`. The hosts the Claude login token needs are not confirmed yet (the TODO in that file). For the first live run, set the repo variable `LINEAR_AGENT_EGRESS` to `off`, note the hosts, add them, and remove the variable.
- The laptop Architect uses the same Architect app user, so it skips any issue whose repo is on `cloud_repos`. The laptop builder is a different app user and is not affected.

### The sweep (`.github/workflows/linear-sweep.yml`)

On a schedule, and by hand, `node scripts/linear-job.mjs --sweep` lists the open issues delegated to each cloud app user and starts one `linear-agent.yml` run for each one in a `cloud_repos` repo with no run queued or running. It catches a webhook that never arrived and a dispatch that failed. It obeys the kill switch and the run limit.

The repo variable `LINEAR_SWEEP_CRON` picks the schedule: `*/15 * * * *` (the default), `*/30 * * * *` or `0 * * * *`. A sweep that runs bills at least one Actions minute, so every 15 minutes costs about 96 minutes a day; on a private repo with a small monthly allowance, hourly is the safer choice. A schedule that is not chosen is skipped before it starts and costs nothing.

### Secrets and variables (names only)

- Secrets: `LINEAR_ARCHITECT_CLIENT_ID`, `LINEAR_ARCHITECT_CLIENT_SECRET`, `LINEAR_BUILDER_CLIENT_ID`, `LINEAR_BUILDER_CLIENT_SECRET`, `LINEAR_VERIFIER_CLIENT_ID`, `LINEAR_VERIFIER_CLIENT_SECRET` (each job mints its app's token with the client credentials grant, `scripts/lib/linear-oauth.mjs`, and gets only its own role's pair); `CLAUDE_CODE_OAUTH_TOKEN`; `AGENT_GH_TOKEN` (read the target repo); `AGENT_GH_WRITE_TOKEN` (push, pull request and merge on the target repo); `LINEAR_NOUS_API_KEY` (builder, `agent:nous` only).
- Variables: `AGENT_LOOP_ENABLED`, `LINEAR_AGENT_EGRESS`, `LINEAR_SWEEP_CRON`.
- Env in the job: `LINEAR_JOB_CHECKOUT` (the target repo folder), `LINEAR_BUILDER` (default `Builder (cloud)`), `LINEAR_VERIFIER` (default `Verifier`), `LINEAR_ARCHITECT` (default `Architect`), `LINEAR_JOB_PROMPT` (the `prompt` input, passed through env so comment text never reaches the command line).

### Running it by hand

`node scripts/linear-job.mjs --role builder --issue ENG-12 --dry-run` reads the issue and says what it would do, with no writes. With no credentials it stops before any network call and names the missing value. Tests: `node --test test/linear-job.test.ts`.

### Not verified live yet

- The whole loop: no job has run against live Linear. The first live runs are the canaries in the cloud loop plan.
- That the client credentials grant works for the Builder (cloud) and Verifier apps.
- The Claude login token's hosts (egress TODO above).
- The publish step's push (a fresh bare repo, with the token as an HTTP header) has never reached GitHub; only the local copy into the bare repo was tried.
- That the issue query returns comments oldest first. The builder's FAIL feedback and the merge step's PASS check both read the newest one; if the order were reversed, the merge step would refuse to merge, not merge wrongly.
- That a pull request behind its base merges: the merge step does not update the branch, because that would add a commit the verifier never saw. A repo that requires up-to-date branches stops at In Review.
