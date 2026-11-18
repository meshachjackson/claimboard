# Linear issue templates

Template bodies for Linear issues. Written 11/13/2026.

| File | Kind | Starts as | Needs owner to approve |
|---|---|---|---|
| `build-task.md` | Issue template | Backlog, no delegate | Created in Linear |
| `bug-fix.md` | Issue template | Backlog, no delegate | Created in Linear |
| `docs-only-task.md` | Issue template | Backlog, no delegate | Created in Linear |
| `decision-needed.md` | Issue template | Backlog, assigned to the owner | Created in Linear |
| `follow-up.md` | Issue template | Backlog, no delegate | Created in Linear |
| `agent-or-backend-test.md` | Issue template | Backlog, no delegate | Created in Linear |
| `comment-handoff.md` | Comment format | n/a | Yes (wording) |
| `comment-blocked-report.md` | Comment format | n/a | Yes (wording) |

## How each file reads

Each file has a table of settings (name, who fills it, labels, status), a `## Body` block to paste into the Linear template editor, and a filled example in a second `md` block.

## Rules for the text

* The five-line **Rules** block is identical in the five templates an agent works (Build task, Bug fix, Docs-only task, Follow-up, Agent or backend test). Decision needed has its own five lines, because no agent works it. If you change the shared block, change it in all five. The follow-up list in the plan adds a test that fails when they differ.
* `{{like this}}` marks text to replace. A created issue with a `{{` left in it is not ready to delegate.
* The header (`Goal`, `Repo and tier`, `Owner agent`, `Checks`, `Needs owner`) comes first, one line each, and never starts with the words "Done when". The runner takes the first line that starts with those words as the start of the checks (`doneWhen` in `scripts/linear-run.mjs`).
* Only the Done when list uses checkboxes. A heading must follow it, so the next bullets are not read as checks.
* `+++ Agent notes ... +++` is Linear's collapsible section. In a saved template Linear keeps `+++` (read back with `get_template`); in saved issue descriptions it shows `>>>` (ENG-101, ENG-104). Treat both as the same marker.
* Linear stores `-` bullets as `*`. Both forms parse the same; the check in the plan ran both.

## Putting a template into Linear

Linear Settings > Teams > MES > Templates > New template > Issue template. Standard, not form. Set the name, title, description, labels and status from the table at the top of each file. Never set a delegate. Paste the body, select each `{{...}}` and apply the placeholder style (the `Aa` icon on the formatting bar). Read it back with `get_template`.
