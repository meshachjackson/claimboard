# Template: Decision needed

Use when the next step is a call only the owner can make (or the Architect may make, if the topic is on `architect_may_decide`). It is never worked by a builder.

| Field | Value |
|---|---|
| Linear name | `Decision needed` (team MES, standard template) |
| Title | `Decide: {{the question}}` |
| Filled by | The Architect (on ESCALATE), a builder (when blocked `needs_input`), or the owner. |
| Labels preset | `Decision` (type). |
| Status preset | Backlog |
| Assignee preset | The owner. This puts it in the "Needs me" view. |
| Delegate preset | none. A delegated Decision is a mistake the runner should refuse. |
| Required | One question, 2 or 3 options, one recommendation, what happens if no answer, which `always_owner` item it falls under. |
| Runner use | A Decision issue has no delegate, so the runner never sees it. (A refusal if someone delegates one is proposed as F1, not built.) The owner answers by comment. The agent that filed it, or the Architect, reads the answer and files the Build task. |

## Body

```md
## Summary

* **Goal:** {{the question, one sentence, answerable by a letter}}
* **Repo and tier:** {{repo folder or none}} / {{tier or none}}
* **Owner agent:** none until answered; then {{who acts on the answer}}
* **Checks:** 1 line below
* **Needs owner:** yes

## The call

* **Why it is yours:** {{one of: new_spend_or_vendor, secrets_or_credentials, delete_data_or_repo, dns_or_domains, public_release, agent_permissions, client_data, or scope of done}}
* **Raised by:** {{agent and issue id with title}}

## Options

* **a)** {{option, one line}}. Cost: {{what it costs or risks}}.
* **b)** {{option, one line}}. Cost: {{what it costs or risks}}.
* **c)** {{optional third option}}

## Recommendation

* {{letter}}: {{one sentence why}}.
* If you do not answer: {{what stays blocked, and what does not}}.

## Done when

* [ ] The owner has commented one option letter on this issue.

## Rules

* No secrets, tokens or client data in this issue. Name a variable, never its value.
* Agents do not answer this issue and do not act as if it were decided.
* Do not delegate this issue to any agent.
* After the answer, file the work as a Build task that links this issue, then set this one to Done.
* Keep the options to what is realistic. Do not add a fourth.
```

## Filled example (example issue ENG-102)

Source: ENG-102 - Confirm tests and CI pass on main, 11/12/2026. The builder was blocked on a runner permission. The Architect posted "Needs owner (agent_permissions)" as a comment on the work issue. The comment worked, but the question was buried in a thread among agent session stubs. As a Decision issue it would sit in the "Needs me" view instead.

```md
## Summary

* **Goal:** Decide if the runner may run one pytest command with the key unset.
* **Repo and tier:** example-app-c / early-dev
* **Owner agent:** none until answered; then Builder (laptop)
* **Checks:** 1 line below
* **Needs owner:** yes

## The call

* **Why it is yours:** agent_permissions
* **Raised by:** Architect, on ENG-102 - Confirm tests and CI pass on main

## Options

* **a)** Allow the one exact command `env -u NIMBLE_API_KEY .venv/bin/pytest tests/ -q`. Cost: one more allowlist line.
* **b)** Allow the broader pattern `env -u NIMBLE_API_KEY pytest *`. Cost: any pytest target runs with the key unset.
* **c)** Run it yourself in a terminal and paste the output into ENG-102 for the verifier to accept. Cost: your time.

## Recommendation

* a: it names the one command that cannot write real records.
* If you do not answer: ENG-102 stays blocked on criterion 2. Nothing else is blocked.

## Done when

* [ ] The owner has commented one option letter on this issue.

## Rules

* No secrets, tokens or client data in this issue. Name a variable, never its value.
* Agents do not answer this issue and do not act as if it were decided.
* Do not delegate this issue to any agent.
* After the answer, file the work as a Build task that links this issue, then set this one to Done.
* Keep the options to what is realistic. Do not add a fourth.
```

What happened in fact: The owner answered "already done" in a comment, the allowlist gained both forms, and the builder finished with a pull request. The template would not have changed the outcome, only where the question lived.
