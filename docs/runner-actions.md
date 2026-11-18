# The code runner on GitHub Actions

The builder needs a place to run code. This repo holds the workflow that does it.

The runner code itself lives in the runner repo under `runner/`. This repo holds only the workflow, in `.github/workflows/`:

- `runner-job.yml` is the entry point. It starts only by hand (`workflow_dispatch`), and later from n8n. It also decides the job's permissions.
- `runner-core.yml` holds the steps. It cannot be started on its own.
- `runner-verify.yml` is the verifier (phase C). It grades a `claude/` branch the runner pushed, read-only. See "Phase C".
- `scripts/runner-callback.py` signs and posts the callbacks to the orchestrator (phase C).

## What it does today (phase A)

You start it, it runs one job, it pushes nothing. It checks out `agent-board` and a pinned commit of the runner repo, installs Node, pnpm and the Claude Code CLI, and runs the runner CLI. Then it shows the result on the run page and keeps the files for 90 days. The job gets `contents: read` and nothing else, so it cannot push even by mistake.

Phase B (push a `claude/...` branch and open a draft PR) is in the file but locked. See "Before phase B" and "Egress allowlist".

## One-time setup (The owner)

The workflow file must be on `main` before the first run. GitHub only lists a manual workflow once its file is on the default branch. Merge the PR first.

Create two secrets in `agent-board` (Settings, Secrets and variables, Actions, New repository secret). The names must match exactly. Do not paste a value anywhere but the GitHub form.

| Secret name | What to put in it |
|---|---|
| `ANTHROPIC_RUNNER_KEY` | An Anthropic API key made in its own Console workspace for the runner, with that workspace's monthly spend limit set to $25 first. This limit is the hard stop on spend. |
| `LOCAL_LAB_READ_TOKEN` | A fine-grained GitHub token for the runner repository only, with the single permission "Contents: Read-only". Set a short expiry. |

Also confirm the Claude Code CLI version. `CLAUDE_CODE_VERSION` in `runner-core.yml` is a pin chosen on 11/2/2026 (the latest on npm then). Nobody has run it. Change it there if you want another one.

## Start a run (phase A)

1. Open the repo on GitHub, then Actions, then "Runner job", then "Run workflow". Leave the branch as `main`. The guard job refuses any other branch.
2. Fill in the form:
   - `card_id`: like `CARD-123`.
   - `spec_json`: the job spec as one JSON object (the same fields the old `POST /jobs` took).
   - `publish`: leave it off.
   - `egress_allowlist`: leave it off for a normal phase A run. Turn it on only to test the allowlist (see below).
   - `runner_sha`: the full 40-character commit of the runner repo to run. Use a commit that is merged to `main` and has the runner CLI in it.
   - `job_id` and `step_id`: the orchestrator fills these in phase C. For a run by hand, use any id (letters, digits, `-`, `_`), like `manual-1`, and `STP-930000`. With no callback secrets set, the callbacks are skipped.
3. Press the green button.

Only one runner job runs at a time. A second start waits.

## Where the results appear

- **The run page, Summary section:** the job state, wall time, peak memory and the job's own `summary.md`.
- **Artifacts, at the bottom of the run page:** `runner-<card id>-<run id>`, a zip of `out/` with `job.json`, `diff.patch`, `ledger.jsonl` and `summary.md`. Kept 90 days. Free accounts have 500 MB of artifact storage, shared with packages, so the diffs are small on purpose.
- A green run means `job.json` was written, not that the job passed. Read the state in the Summary (`passed`, `review_failed`, `verify_failed`, and so on).
- The job fails if `job.json` is missing. That means the runner broke before it could record the job; read the "Run the job" step log.

## Read the peak memory

The Summary shows "Peak memory (largest process)" against the runner's 8000 MB. It comes from `/usr/bin/time -v` and is the biggest single process the job started, not the total. Write the figure down after the first real job. It decides whether `ubuntu-slim` (5 GB) would be enough.

## Safety rules the workflow keeps

- Inputs never become shell code. The spec and card id go through environment variables and a file. The card id and commit id are checked first.
- Secrets sit in two places only: the runner repo checkout step, and the one step that runs the runner. The runner's harness cannot see them; its environment is a whitelist in the runner repo.
- Both checkouts set `persist-credentials: false`, and a step stops the job if a git credential or include is still set.
- Actions are pinned to full commit ids. The CLI is pinned to an exact npm version. Nothing is downloaded into a shell.
- A 60 minute limit and a one-job-at-a-time queue.
- `test/runner-workflow.test.ts` checks these rules. It runs with `pnpm test`.

Phase A accepts open outbound network access, as decided on 11/2/2026. Nothing is pushed and the only GitHub token is read-only. Phase B closes it with the allowlist below.

## Egress allowlist

Built. A no-push run with it on passed on 11/2/2026. The first publish run failed at the push because git used a GitHub address the list did not hold; the fix below (GitHub's published ranges, more resolve passes, a connect self-check) is not yet run on GitHub. It is on for every `publish` run, and for a no-push run when `egress_allowlist` is on.

**What it does.** Two steps in `runner-core.yml` wrap the harness step and nothing else. "Limit outbound hosts" runs right before "Run the job". "Remove the outbound limit" runs right after it, with `always()`, so it also runs when the job fails or is cancelled. Install, checkout, artifact upload and the summary all run with open egress.

**How.** `scripts/runner-egress.py` (with the host list in `scripts/runner-egress-hosts.txt`) adds one `iptables` chain with `sudo`. It lives in this repo, not in the runner repo, for three reasons: the runner repo droplet script uses `ufw`, which would need `ufw enable` on a runner and has no clean "remove" step; it keeps state for a droplet that stays up; and this repo's test can read and dry-run this one. The rules, in order:

1. Loopback is open.
2. Connections that already exist stay open. This keeps the runner's live connection to the Actions service, which streams the log.
3. DNS to the resolvers in `resolv.conf` is open.
4. HTTPS (port 443) is open to the addresses of: `github.com`, `api.github.com`, `api.anthropic.com`, `registry.npmjs.org`, `results-receiver.actions.githubusercontent.com`, plus the remote address of every HTTPS connection open at that moment. Names are looked up three times, 3 seconds apart, and the answers are joined, to cover DNS round-robin. For `github.com` and `api.github.com`, the IPv4 ranges in the `git`, `api` and `web` lists of `https://api.github.com/meta` are open too ([GitHub REST docs, "Get GitHub meta information"](https://docs.github.com/en/rest/meta/meta); the keys were read from the live answer on 11/2/2026).
5. Everything else is rejected at once (a refusal, not a silent drop), so a blocked call fails fast and does not hang. IPv6 is rejected except loopback and existing connections. The script reads only IPv4 ranges from `/meta`. Clients that try IPv6 first fall back to IPv4 on the instant refusal, and the self-check below connects the way a client does, so a break here would show up there.

**Self-check.** With the rules in, the script opens one TCP connection (no data) to each of `github.com:443`, `api.github.com:443`, `api.anthropic.com:443` and `registry.npmjs.org:443`, trying up to 3 times. It prints one `self-check <host>:443 ok` line per host, and the same lines go into the run Summary. If a host is still refused after 3 tries, the script names it, removes its rules and exits 1, so the run stops before the model step spends tokens.

**If it goes wrong.** The step has a 3 minute limit and a `timeout 120` around the script. If a host does not resolve, GitHub's `/meta` cannot be read (3 tries, then it stops; the filter is never turned on without it), a rule is refused, or the self-check is refused, the script removes what it added and the job stops before the harness starts, with the reason in the log and in the Summary. It never leaves a half-built filter. The `always()` cleanup removes the chain a second time; removing twice is safe.

**Where the list comes from.** GitHub's docs list the domains the Actions runner uses ([Self-hosted runners reference, "Communication"](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) and [GitHub-hosted runners reference, "Communication requirements"](https://docs.github.com/en/actions/reference/runners/github-hosted-runners); both read on 11/2/2026, no version stamp on either page). They name `github.com`, `api.github.com` and `*.actions.githubusercontent.com` for essential operations, and `results-receiver.actions.githubusercontent.com` and `*.blob.core.windows.net` for logs, summaries, artifacts and caches. The pages say the hosted runner needs outbound HTTPS on port 443 and that some of these names are CNAMEs.

**Honest limits.**
- This is an address filter, not a hostname filter. `iptables` cannot match names. A host on a shared CDN or cloud address shares that address with other sites, so the harness could reach those other sites too.
- Wildcards (`*.actions.githubusercontent.com`, `*.blob.core.windows.net`) cannot be resolved to addresses. They are covered only by the open-connection rule, and by the artifact upload running after the filter is removed. If the runner opens a new connection to an Actions service address it did not hold at that moment, it is rejected. I could not verify what the runner does in that case.
- Addresses are looked up three times, 3 seconds apart, then fixed for the step. A CDN that rotates during a long harness run can make a host unreachable partway through.
- DNS is open to the resolvers, so data can leave through DNS queries. This is not closed.
- GitHub's `/meta` `git`, `api` and `web` ranges are used for `github.com` and `api.github.com`. They are wide (a few dozen ranges), so the harness can reach any GitHub address in them, not only the two hosts. The `actions` list is not used: GitHub documents it as the addresses hosted runners connect from, not the addresses of the Actions services.
- `/meta` is read without a token, because these steps carry no secrets. Unauthenticated calls count against GitHub's limit of 60 per hour per address, and runners share addresses, so a busy hour could make the read fail. The run then stops with `github ranges unavailable` and the filter stays off; re-run it later.
- The self-check proves the four hosts connect at the start. It does not cover a later call to a host that is not on the list.
- The Claude Code CLI may call hosts that are not on the list (for example for telemetry or updates). Those calls are rejected. I did not verify which hosts it uses; the first test run shows it.
- Tests cover the script offline: ranges parsed and added, fail closed when `/meta` is unreadable, joined lookups, and the self-check and its failure path, with the network faked. They cannot show that the real rules let git through. Only a run on GitHub shows that (the test plan below). Not verified on a real runner: that the runner's log keeps streaming and that the harness works inside the list.

**Test it before a publish run.**
1. Start the workflow with `publish` off and `egress_allowlist` on, with the scratch card and spec.
2. Open the run Summary. The "Egress allowlist" block shows the hosts, the counts and four `self-check ... ok` lines, including `github.com:443`. A `FAILED` line names the refused host, and the run stops before the model step. Read the "Limit outbound hosts" and "Run the job" logs for any `Connection refused` or `did not resolve`.
3. Check that the log streamed to the end, the artifact uploaded, and `job.json` says `passed`.
4. If a needed host is missing, add it to `scripts/runner-egress-hosts.txt` (The owner approves the change). If the runner went quiet or the job hung, stop and tell the builder; do not enable publish.

## Before phase B

1. The outbound allowlist step is built (above). Run the test steps above and read the result first.
2. In Settings, Actions, General, turn on "Allow GitHub Actions to create and approve pull requests". Turn it on only when ready.
3. Create the repository variable `RUNNER_PUBLISH_ENABLED` with the value `true`. Until then the guard job refuses `publish: true`.
4. Make the first publish run with a scratch card, not a real one.

The Free plan has no branch protection. The merge rule lives in the runner's `publish.py`: draft only, `claude/` branches only, no merge call.

## Phase C

Built 11/5/2026, not run on GitHub. the orchestrator starts the runner and the verifier through GitHub's `workflow_dispatch` API, and both report back to the orchestrator with signed callbacks. Nothing here runs until the owner creates the secrets below and the n8n side (`dispatch_job`, `the status gateway`) is built and published.

### Parallel jobs

Runner jobs run in parallel, each on its own GitHub runner. The orchestrator's pool cap (`board.concurrency` in `gov_config`, starting value 2) decides how many run at once. The workflow's concurrency group is per `job_id`, so a job dispatched twice runs once. Limits to watch when raising the cap:

- GitHub Free allows 20 concurrent jobs per account across all repos. Each runner run uses a few short jobs plus one long one, so plan on about 5 runs at once at most.
- Parallel jobs spend the $12 of free Actions compute and the $25 Anthropic Console limit faster. They do not raise the total.
- Two jobs on the same files can conflict. The verifier's overlap check flags open PRs touching the same files.

### Dispatch

the orchestrator calls `POST /repos/<owner>/<repo>/actions/workflows/<file>/dispatches` with `ref: main` and the inputs:

- `runner-job.yml`: `card_id`, `spec_json`, `runner_sha`, `publish`, `egress_allowlist`, plus `job_id` (the orchestrator's job id; letters, digits, `-` and `_`, 64 at most) and `step_id` (the board step, like `STP-930123`). The guard job checks both ids before anything runs.
- `runner-verify.yml`: `ticket`, `criteria` (a JSON array of strings), `diff_ref` (the `claude/tsk-...` branch), plus the ids `job_id`, `step_id` and `runner_sha`.

Writes stay where they were: the runner pushes only `claude/<slug>` branches and opens draft pull requests only (the runner's publish module, unchanged), and only when `publish` is on and `RUNNER_PUBLISH_ENABLED` is `true`.

### Callbacks

`scripts/runner-callback.py` posts to the URL in the `VERA_CALLBACK_URL` secret (https only). The contract is defined in the runner repo (accepted 11/5/2026). The body has exactly these seven fields, as canonical JSON (sorted keys, no spaces, no timestamp), so the same inputs always give the same bytes:

| Field | Value |
|---|---|
| `job_id`, `step_id` | From the dispatch inputs |
| `status` | `started`, `served` or `failed` from the runner; `served` from the verifier. `needs_input` is in the contract; nothing here sends it yet |
| `output_ref` | The run page URL |
| `tokens_in`, `tokens_out` | Tokens the job used (in = input plus cache creation, out = output), 0 when the run did not report them |
| `verdict` | `PASS`, `FAIL` or `INCONCLUSIVE` from the verifier; empty for the runner |

Headers: `X-the orchestrator-Timestamp` (Unix seconds; the gateway refuses one more than 5 minutes old), `X-the orchestrator-Signature: sha256=<hex>` (the HMAC-SHA256 of `<timestamp>.<raw body>`), and `X-the orchestrator-Idempotency-Key: callback:<job_id>:<status>` (the dedupe key; the gateway derives the same key from the body, so this header is for logs). The runner signs with `VERA_CALLBACK_SECRET`, the verifier with its own `VERA_VERIFIER_CALLBACK_SECRET`, so a builder job cannot post a verifier verdict. The script tries 3 times on a network error or a 5xx and stops at a 4xx. With either secret missing it prints "callback skipped" and exits 0, so a run by hand still works.

When each one fires:

- `started`: the `callback-start` job, once the guard passes.
- `served` or `failed`: the `callback-end` job, with `if: always()`, after both run jobs. `served` only when the run job finished and `job.json` says `passed` (a no-push run) or `published` (a publish run that pushed and opened its draft PR); a guard failure, a crash, a cancel or any other job state is `failed`. Token counts come from `job.json` through the `runner-core.yml` outputs.
- `served` with a verdict: the verifier's `callback` job, with `if: always()`. `PASS` and `FAIL` come only from the verify job's own verdict. A run that never reached a verdict (a failed guard, a crash, a cancel, no key, the reviewer unreachable) sends `INCONCLUSIVE`, which the orchestrator escalates at once .

The callback secrets sit only in those small callback jobs. The job that runs the model never sees them.

### The verifier

`runner-verify.yml` grades a branch from the ticket, the criteria and the diff ref alone (doctrine rules 1 and 3). It never downloads the runner's artifact, never reads `spec_json` or the worker's transcript, and runs no code from the branch.

1. **Guard** (no permissions): checks every input against a strict pattern, and that the run started from `main`.
2. **Overlap** (`pull-requests: read` only, no checkout): `gh pr list --json number,title,headRefName,files` for open pull requests. A private repo needs this permission for that list, so it lives in its own job and hands the list over as a job output.
3. **Verify** (`contents: read` only): checks out `agent-board` with all branches and the runner repo at `runner_sha`, then runs the runner's verifier module: the `verify.py` checks on the branch diff (against its merge base with `main`), then the merge check. The merge check rebases a detached copy of the branch onto `main` in a scratch worktree and fails on a conflict, naming the files. Other open pull requests that touch the same files are listed in the summary; that list never fails the check. `tests_green` is left out, not faked: the runner job ran the tests. If the checks pass, the runner's review module runs `review.py` on `claude-opus-5-5`, a different model from the worker's `claude-sonnet-5-5`, with the criteria and the diff only.
4. **Callback**: posts the verdict.

A failed check is `FAIL` with `stop_reason` `merge_conflict` (the rebase) or `checks_failed`; a review that says no is `FAIL` with `review_failed`. The verdict, each check and any overlapping pull requests show in the run Summary. The verify job uploads `checks.json`, `verdict.json` and `diff.patch` as `verify-<ticket>-<run id>`, kept 90 days.

### Deviations from spec (approved by the coordinator session, pending the owner's review)

1. Besides `ticket`, `criteria` and `diff_ref`, the verifier takes three ids: `job_id` and `step_id` (to address the verdict callback) and `runner_sha` (which the runner repo commit to run). Each is checked against a strict pattern, so none can carry worker output.
2. The open-PR list needs `pull-requests: read`. It runs in its own job with that permission only. The grading job has `contents: read` only.

### Secrets and tokens the owner must create

Nothing below exists yet. Create them only when the n8n side is ready.

| Name | Where | What |
|---|---|---|
| `VERA_CALLBACK_URL` | agent-board repo secret | The `the status gateway` webhook URL (https) |
| `VERA_CALLBACK_SECRET` | agent-board repo secret, and the same value as an n8n credential for `the status gateway` | The runner's HMAC key: a long random string. Generate it once; paste it only into the two forms |
| `VERA_VERIFIER_CALLBACK_SECRET` | agent-board repo secret, and the same value as a second n8n credential for `the status gateway` | The verifier's own HMAC key. A different long random string |
| n8n dispatch token | n8n credential (for example `GitHub agent-board dispatch`) | A fine-grained GitHub token for `agent-board` only, with "Actions: Read and write" and nothing else, so n8n can start the two workflows. Short expiry |

The verifier reuses `ANTHROPIC_RUNNER_KEY` and `LOCAL_LAB_READ_TOKEN`. Its review spend counts against the same Console workspace limit.

### Tests

`pnpm test` runs `test/runner-workflow.test.ts` (callback jobs, ids, token flow), `test/runner-verify.test.ts` (verifier inputs, permissions, no worker output, pinned actions) and `test/runner-callback.test.ts` (HMAC over timestamp and body checked against Node `crypto`, identical bytes for identical inputs, dedupe key, refusals, retries). the runner repo `runner/test_verifier.py` covers the merge check and the verifier with real git in temp folders. Not verified: a real run on GitHub, the callback against the real `the status gateway`, and `actionlint` (not installed on the Mac that built it).

## What stays open

- Phase C on the n8n side: `dispatch_job` (calls the dispatch API with the token above) and `the status gateway` (checks the signature, dedupes on the key, writes `board_events`). Specified in a separate ADR session; not built here.
- The plan's overlap list from `board_events` dispatch rows is not built; only open pull requests are listed.
- ACP profiles for the worker and verifier: a work order for your CODEOWNERS owners (see the pull request).
