# Comment format: Handoff

Not a Linear template. Linear templates apply when an issue is created, and a handoff is a comment. The runner and the Architect write it from code; until then, a person or agent pastes it.

| Field | Value |
|---|---|
| When | Work passes from one agent to another: builder to verifier, builder to Architect, Architect back to builder, or any agent to the owner. |
| Who writes it | The agent handing over. |
| Length | Under 700 characters. The next builder reads only the last 10 comments, each cut to 800 characters, and Linear's "This thread is for an agent session" stubs use some of those 10 slots. Lead with the ruling. |
| Runner use | None yet. The runner reads every comment as plain text. |

## Body

```md
**Handoff:** {{from agent}} to {{to agent}}
**Ruling or result:** {{one sentence the next agent must follow}}
**Evidence:** {{commit sha, pull request link, or the command and its one-line output}}
**Left to do:** {{the lines under Done when that are not yet true, or none}}
**Do not:** {{one thing the next agent must not redo or change}}
```

## Filled example (example: ENG-101 - Add server-side usage limits for /api/run, 11/12/2026)

The runner's real comment after the first run was a long verifier report ending "The verifier failed the work 3 time(s), so I stopped. The work is on local branch linear/eng-101-run." The one fact that mattered (line 3 could not be checked because of a permission) sat in the middle. The same facts in the format (commit sha taken from the later comment on the same issue, which names it as the builder's commit):

```md
**Handoff:** Builder (laptop) to the owner
**Ruling or result:** Limiter built on local branch linear/eng-101-run; the verifier could not grade Done when line 3, so the run stopped after 3 tries with no pull request.
**Evidence:** commit 514cdf4; the builder reports `npm test` and `npm run typecheck` exit 0.
**Left to do:** line 3 (`npm run typecheck` exits 0) is unverified: the command was denied to the verifier.
**Do not:** change the code; allow the command for the verifier and re-run only the verification.
```
