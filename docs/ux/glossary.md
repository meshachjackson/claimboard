# UI glossary

The words the board shows today. Labels live only in `app/types/board.ts`; this file lists them so wording stays consistent. It records the words the board shows now. Words that changed on 11/7/2026 are listed under "Renamed words", and the Previously column shows what each one replaced.

- `test/ux-glossary.test.ts` fails when a label in a table below is missing, renamed in code but not here, or listed under the wrong code name.
- The "Defined" line numbers are a guide and can drift. The test checks the code name and the word, not the line.
- To change a word: edit `app/types/board.ts`, update the row here, update `/help` if it names the word, and add a changelog entry.
- Not listed: text built from data (counts, names) such as `stepSummaryLabel`, `statusFoldLabel`, `chatStepsLabel` and `classMismatchLabel`; help sentences (`WORK_STATE_HELP`, `STAGE_HELP`, `BOARD_QUIRKS`, `NO_RESPONSE_REASONS`); hints (`BOARD_VIEW_HINTS`, `REGISTER_API_AGENT_HINT`, `UNAPPROVED_PLAN_HINT`); and `SHORTCUTS`.

## Work states

The status of a card (`work_state`). The pill table repeats the same words for the card pill.

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Backlog | `WORK_STATE_LABELS.backlog` | `app/types/board.ts:365` | Nothing is working on the card. Move it to Architecture or Build to bring an agent in. |  |
| Awaiting start | `WORK_STATE_LABELS.awaiting_start` | `app/types/board.ts:366` | An agent is lined up but has not started. |  |
| Working | `WORK_STATE_LABELS.in_progress` | `app/types/board.ts:367` | An agent has claimed a step and is working on it now. |  |
| Needs you | `WORK_STATE_LABELS.needs_input` | `app/types/board.ts:368` | An agent asked a question, or a plan waits for your approval. Nothing moves until you answer. |  |
| Blocked | `WORK_STATE_LABELS.blocked` | `app/types/board.ts:369` | A step failed or was cancelled and nothing else runs. You pick the next move. |  |
| Ready for review | `WORK_STATE_LABELS.verifying` | `app/types/board.ts:370` | Agent work is finished and passed its check. It is ready for your review and sign-off. | Complete |
| Done | `WORK_STATE_LABELS.done` | `app/types/board.ts:371` | Signed off and done. Archived after 14 days. | Logged |
| Awaiting start | `WORK_STATE_PILLS.awaiting_start` | `app/types/board.ts:506` | Card pill for the Awaiting start state. |  |
| Working | `WORK_STATE_PILLS.in_progress` | `app/types/board.ts:507` | Card pill for the Working state. |  |
| Needs you | `WORK_STATE_PILLS.needs_input` | `app/types/board.ts:508` | Card pill for the Needs you state. |  |
| Blocked | `WORK_STATE_PILLS.blocked` | `app/types/board.ts:509` | Card pill for the Blocked state. |  |
| Ready for review | `WORK_STATE_PILLS.verifying` | `app/types/board.ts:510` | Card pill for the finished-work state. Same word as the table above. | Complete |
| Done | `WORK_STATE_PILLS.done` | `app/types/board.ts:511` | Card pill for the signed-off state. | Logged |
| Needs you | `BOARD_PILLS.needs_input` | `app/types/board.ts:560` | Board bar filter pill: show only cards that need you. |  |
| Blocked | `BOARD_PILLS.blocked` | `app/types/board.ts:561` | Board bar filter pill: show only blocked cards. |  |
| Open to any agent | `OPEN_PILL` | `app/types/board.ts:515` | Pill on a step any agent in a pool may pick up. | Open · claimable |
| Needs your attention | `ATTENTION_DOT` | `app/types/board.ts:520` | Red dot on a Compact card that needs the owner. |  |

## Stages

The columns a card moves through (`stage`).

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Backlog | `STAGE_LABELS.backlog` | `app/types/board.ts:351` | Ideas and requests. No agent touches a card here. |  |
| Architecture | `STAGE_LABELS.architecture` | `app/types/board.ts:352` | An advisor posts a plan. You approve it, then move the card to Build. |  |
| Build | `STAGE_LABELS.build` | `app/types/board.ts:353` | A builder does the work. At the end the card moves itself to Review. |  |
| Review | `STAGE_LABELS.review` | `app/types/board.ts:354` | Your sign-off. Move to Done to approve, or back to Build with a note. |  |
| Done | `STAGE_LABELS.done` | `app/types/board.ts:355` | Finished. Nothing more runs here. |  |

## Step states

The status of one step of a card (`step_state`).

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Awaiting start | `STEP_STATE_LABELS.awaiting_start` | `app/types/board.ts:375` | A step is created but waits to be started. |  |
| Waiting for an agent | `STEP_STATE_LABELS.awaiting_pull` | `app/types/board.ts:376` | A step waits for an agent to pick it up. | Awaiting pull |
| Working | `STEP_STATE_LABELS.dispatched` | `app/types/board.ts:377` | An agent holds the step and is working on it. |  |
| Done, checking | `STEP_STATE_LABELS.served` | `app/types/board.ts:378` | The agent handed in its work; the check has not finished. | Served |
| Needs you | `STEP_STATE_LABELS.needs_input` | `app/types/board.ts:379` | The step stopped to ask you something. |  |
| Failed | `STEP_STATE_LABELS.failed` | `app/types/board.ts:380` | The step failed or was cancelled. |  |
| Verified | `STEP_STATE_LABELS.verified` | `app/types/board.ts:381` | The step passed its check. |  |

## Approval states

Whether the owner approved the plan (`approval_state`).

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Not required | `APPROVAL_LABELS.not_required` | `app/types/board.ts:388` | The card needs no plan approval. |  |
| Approval pending | `APPROVAL_LABELS.pending` | `app/types/board.ts:389` | A plan waits for your approval. |  |
| Approved | `APPROVAL_LABELS.approved` | `app/types/board.ts:390` | You approved the plan. |  |
| Rejected | `APPROVAL_LABELS.rejected` | `app/types/board.ts:391` | You rejected the plan. |  |

## Priorities

Card priority (`priority`).

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Low | `PRIORITY_LABELS.low` | `app/types/board.ts:38` | Lowest priority. |  |
| Normal | `PRIORITY_LABELS.normal` | `app/types/board.ts:38` | Default priority. |  |
| High | `PRIORITY_LABELS.high` | `app/types/board.ts:45` | Do sooner than normal. |  |
| Urgent | `PRIORITY_LABELS.urgent` | `app/types/board.ts:46` | Do first. |  |

## Card types

Card type (`task_type`).

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Operational | `TASK_TYPE_LABELS.operational` | `app/types/board.ts:359` | Run or maintain something that already exists. |  |
| Build | `TASK_TYPE_LABELS.build` | `app/types/board.ts:360` | Make something new. |  |
| Upgrade | `TASK_TYPE_LABELS.upgrade` | `app/types/board.ts:361` | Change something that already exists. |  |

## Note kinds

Badges in the card thread (`note_kind`). `comment` and `system` have no badge.

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Question | `NOTE_KIND_STYLES.question` | `app/types/board.ts:587` | Thread badge: an agent asks you something. |  |
| Proposal | `NOTE_KIND_STYLES.proposal` | `app/types/board.ts:588` | Thread badge: a plan or proposal to approve. |  |
| Summary | `NOTE_KIND_STYLES.summary` | `app/types/board.ts:589` | Thread badge: a finished-work summary. |  |
| Status | `NOTE_KIND_STYLES.status` | `app/types/board.ts:590` | Thread badge: a progress update. |  |

## Next-move signals

Tags and buttons that say whose move it is (`MOVE_SIGNALS`).

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Stopped | `MOVE_SIGNALS.blocked` | `app/types/board.ts:473` | Tag on a card where the next move is yours because work stopped. |  |
| Question | `MOVE_SIGNALS.needs_input` | `app/types/board.ts:474` | Tag on a card where an agent waits for your answer. |  |
| Review | `MOVE_SIGNALS.verifying` | `app/types/board.ts:475` | Tag on a card waiting for your sign-off. |  |
| Approve | `MOVE_SIGNALS.approve` | `app/types/board.ts:476` | Tag on a card where a plan waits for your approval. |  |
| Nobody has it | `MOVE_SIGNALS.unheld` | `app/types/board.ts:477` | Tag on a card with an open step no agent holds. |  |
| No agent can take it | `MOVE_SIGNALS.stranded` | `app/types/board.ts:479` | Tag on a card whose open step no agent can take. |  |
| Open | `MOVE_SIGNALS.blocked.open` | `app/types/board.ts:473` | Button that opens a blocked card. |  |
| Answer | `MOVE_SIGNALS.needs_input.open` | `app/types/board.ts:474` | Button that opens a card to answer the question. |  |
| Review | `MOVE_SIGNALS.verifying.open` | `app/types/board.ts:475` | Button that opens a card to review it. |  |
| Review | `MOVE_SIGNALS.approve.open` | `app/types/board.ts:476` | Button that opens a card to approve its plan. |  |
| Open | `MOVE_SIGNALS.unheld.open` | `app/types/board.ts:477` | Button that opens a card nobody holds. |  |
| Open | `MOVE_SIGNALS.stranded.open` | `app/types/board.ts:479` | Button that opens a card no agent can take. |  |

## Actions

Button and menu words for board actions (`OP_LABELS`).

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Create | `OP_LABELS.create_task` | `app/types/board.ts:723` | Create a card. |  |
| Assign | `OP_LABELS.assign` | `app/types/board.ts:724` | Give a card to an agent or person. |  |
| Move | `OP_LABELS.move_task` | `app/types/board.ts:725` | Move a card to another column. |  |
| Reopen | `OP_LABELS.reopen_task` | `app/types/board.ts:726` | Bring a Done card back. |  |
| Split into child cards | `OP_LABELS.split_task` | `app/types/board.ts:727` | Break a card into smaller cards. |  |
| Approve plan | `OP_LABELS.approve_plan` | `app/types/board.ts:728` | Approve the architect plan. |  |
| Approve | `OP_LABELS.approve_task` | `app/types/board.ts:729` | Approve a card. |  |
| Done (on my word) | `OP_LABELS.done_no_steps` | `app/types/board.ts:730` | Mark a card Done with no agent check, on the owner's word. |  |
| Reply | `OP_LABELS.reply` | `app/types/board.ts:731` | Answer an agent question. |  |
| Note | `OP_LABELS.add_note` | `app/types/board.ts:732` | Add a note to a card. |  |
| Claim | `OP_LABELS.claim_step` | `app/types/board.ts:733` | Agent takes a step. |  |
| Heartbeat | `OP_LABELS.heartbeat` | `app/types/board.ts:734` | Agent reports it is still working. |  |
| Update step | `OP_LABELS.update_step` | `app/types/board.ts:735` | Agent edits a step. |  |
| Complete step | `OP_LABELS.complete_step` | `app/types/board.ts:736` | Agent finishes a step. |  |
| Save | `OP_LABELS.update_task` | `app/types/board.ts:737` | Save changes to a card. |  |
| Message | `OP_LABELS.message_agent` | `app/types/board.ts:738` | Send a message to an agent. |  |
| Respond now | `OP_LABELS.nudge` | `app/types/board.ts:739` | Ask an agent to answer now. |  |
| Archive | `OP_LABELS.archive_task` | `app/types/board.ts:740` | Archive a card. |  |
| Cancel step | `OP_LABELS.cancel_step` | `app/types/board.ts:741` | Cancel a step. |  |
| Pin | `OP_LABELS.pin_task` | `app/types/board.ts:742` | Pin a card to the top. |  |
| Unpin | `OP_LABELS.unpin_task` | `app/types/board.ts:743` | Remove a pin. |  |
| Start | `OP_LABELS.start_task` | `app/types/board.ts:744` | Start work on a card. |  |
| Send back | `OP_LABELS.send_back` | `app/types/board.ts:745` | Return a card to Build with a note. |  |
| Publish | `OP_LABELS.publish_task` | `app/types/board.ts:746` | Push the branch and open a draft pull request. |  |
| Agent switch | `OP_LABELS.set_switch` | `app/types/board.ts:747` | Turn an agent On, Auto or Off. |  |

## Bulk edits

Words in the bulk edit bar.

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Move to stage | `BULK_LABELS.stage` | `app/types/board.ts:885` | Bulk edit: move selected cards to a stage. |  |
| Assign to | `BULK_LABELS.assignee` | `app/types/board.ts:886` | Bulk edit: assign selected cards. |  |
| Set priority | `BULK_LABELS.priority` | `app/types/board.ts:887` | Bulk edit: set priority. |  |
| Set type | `BULK_LABELS.task_type` | `app/types/board.ts:888` | Bulk edit: set type. |  |
| Set project | `BULK_LABELS.project_id` | `app/types/board.ts:889` | Bulk edit: set project. |  |
| Set due date | `BULK_LABELS.due_at` | `app/types/board.ts:890` | Bulk edit: set due date. |  |
| Clear due date | `BULK_LABELS.clear_due` | `app/types/board.ts:891` | Bulk edit: remove due date. |  |
| Add tag | `BULK_LABELS.add_tag` | `app/types/board.ts:892` | Bulk edit: add a tag. |  |
| Remove tag | `BULK_LABELS.remove_tag` | `app/types/board.ts:893` | Bulk edit: remove a tag. |  |
| Approve | `BULK_LABELS.approve` | `app/types/board.ts:894` | Bulk edit: approve selected cards. |  |
| Pin | `BULK_LABELS.pin` | `app/types/board.ts:895` | Bulk edit: pin selected cards. |  |
| Unpin | `BULK_LABELS.unpin` | `app/types/board.ts:896` | Bulk edit: unpin selected cards. |  |
| Archive | `BULK_LABELS.archive` | `app/types/board.ts:897` | Bulk edit: archive selected cards. |  |
| Delete | `BULK_LABELS.delete` | `app/types/board.ts:898` | Bulk edit: remove selected cards (archives them). |  |

## Views, density and sorting

Board layout, card density and sort choices.

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Stages | `BOARD_VIEW_LABELS.stages` | `app/types/board.ts:922` | Column view of the board, Backlog to Done. |  |
| Table | `BOARD_VIEW_LABELS.table` | `app/types/board.ts:923` | One row per card. |  |
| Comfortable | `DENSITY_LABELS.comfortable` | `app/types/board.ts:928` | Roomy cards with step summary. |  |
| Compact | `DENSITY_LABELS.compact` | `app/types/board.ts:928` | Tight cards with a dot for attention. |  |
| Created | `SORT_LABELS.created` | `app/types/board.ts:145` | Sort cards by creation time. |  |
| Updated | `SORT_LABELS.updated` | `app/types/board.ts:146` | Sort cards by last change. |  |
| Priority | `SORT_LABELS.priority` | `app/types/board.ts:147` | Sort cards by priority. |  |
| Due date | `SORT_LABELS.due` | `app/types/board.ts:148` | Sort cards by due date. |  |
| Title | `SORT_LABELS.title` | `app/types/board.ts:149` | Sort cards by title. |  |
| ID | `TABLE_SORT_LABELS.id` | `app/types/board.ts:867` | Table column: card ID. |  |
| Title | `TABLE_SORT_LABELS.title` | `app/types/board.ts:868` | Table column: card title. |  |
| Stage | `TABLE_SORT_LABELS.stage` | `app/types/board.ts:869` | Table column: the column the card is in. |  |
| Status | `TABLE_SORT_LABELS.state` | `app/types/board.ts:870` | Table column: the work state. Labeled Status here. |  |
| Assignee | `TABLE_SORT_LABELS.assignee` | `app/types/board.ts:871` | Table column: who holds the card. |  |
| Project | `TABLE_SORT_LABELS.project` | `app/types/board.ts:872` | Table column: project. |  |
| Epic | `TABLE_SORT_LABELS.epic` | `app/types/board.ts:873` | Table column: epic. |  |
| Milestone | `TABLE_SORT_LABELS.milestone` | `app/types/board.ts:874` | Table column: milestone. |  |
| Type | `TABLE_SORT_LABELS.type` | `app/types/board.ts:875` | Table column: card type. |  |
| Priority | `TABLE_SORT_LABELS.priority` | `app/types/board.ts:876` | Table column: priority. |  |
| Due | `TABLE_SORT_LABELS.due` | `app/types/board.ts:877` | Table column: due date. |  |
| Updated | `TABLE_SORT_LABELS.updated` | `app/types/board.ts:878` | Table column: last change. |  |

## Triage

Advice and reasons in a triage plan.

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Close | `TRIAGE_ACTION_LABELS.close` | `app/types/board.ts:108` | Triage advice: close the card. Can be applied from the board. |  |
| Archive | `TRIAGE_ACTION_LABELS.archive` | `app/types/board.ts:107` | Triage advice: archive the card. Can be applied from the board. |  |
| Fold | `TRIAGE_ACTION_LABELS.fold` | `app/types/board.ts:107` | Triage advice: fold the card into another. Done by hand. |  |
| Rewrite | `TRIAGE_ACTION_LABELS.rewrite` | `app/types/board.ts:107` | Triage advice: rewrite the card. Done by hand. |  |
| Keep | `TRIAGE_ACTION_LABELS.keep` | `app/types/board.ts:107` | Triage advice: leave the card alone. |  |
| No activity | `TRIAGE_RULE_LABELS.stale` | `app/types/board.ts:120` | Triage reason: nothing has happened on the card for a while. |  |
| Test card | `TRIAGE_RULE_LABELS.test_card` | `app/types/board.ts:121` | Triage reason: the card looks like a test. |  |
| Likely duplicate | `TRIAGE_RULE_LABELS.duplicate` | `app/types/board.ts:122` | Triage reason: another card looks the same. |  |
| Done a while ago | `TRIAGE_RULE_LABELS.done_old` | `app/types/board.ts:123` | Triage reason: the card has been Done for some time. |  |
| Done with open steps | `TRIAGE_RULE_LABELS.done_open_steps` | `app/types/board.ts:124` | Triage reason: the card is Done but steps are still open. |  |
| Step nobody can pick up | `TRIAGE_RULE_LABELS.unreachable_step` | `app/types/board.ts:125` | Triage reason: an open step has no agent that can take it. |  |
| Comment with no reply | `TRIAGE_RULE_LABELS.no_reply` | `app/types/board.ts:126` | Triage reason: a comment got no reply. |  |
| No acceptance criteria | `TRIAGE_RULE_LABELS.no_criteria` | `app/types/board.ts:127` | Triage reason: the card lists no acceptance criteria. |  |

## Report tiles

Tiles on the report page.

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Orphan cards | `REPORT_TOOL_LOOKS.orphans` | `app/types/board.ts:77` | Report tile: cards with no project. |  |
| Cards to batch | `REPORT_TOOL_LOOKS.batchable` | `app/types/board.ts:78` | Report tile: cards that could be handled together. |  |
| Close to done | `REPORT_TOOL_LOOKS.almost_done` | `app/types/board.ts:79` | Report tile: cards nearly finished. |  |
| Projects behind | `REPORT_TOOL_LOOKS.behind` | `app/types/board.ts:80` | Report tile: projects behind schedule. |  |
| Due dates | `REPORT_TOOL_LOOKS.overdue` | `app/types/board.ts:81` | Report tile: cards past their due date. |  |
| Project progress | `REPORT_TOOL_LOOKS.progress` | `app/types/board.ts:82` | Report tile: how far each project has come. |  |
| Open cards by field | `REPORT_TOOL_LOOKS.breakdown` | `app/types/board.ts:83` | Report tile: open cards counted by a chosen field. |  |

## Agents

Roles, lanes and what an agent can do.

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Plans the work | `ROLE_LABELS.architect` | `app/types/board.ts:971` | Step role: writes the plan. |  |
| Builds it | `ROLE_LABELS.builder` | `app/types/board.ts:972` | Step role: does the work. |  |
| Gives a second opinion | `ROLE_LABELS.consult` | `app/types/board.ts:973` | Step role: gives a second opinion. |  |
| Checks the result | `ROLE_LABELS.auditor` | `app/types/board.ts:974` | Step role: checks the result. |  |
| Logs and archives | `ROLE_LABELS.cleanup` | `app/types/board.ts:975` | Step role: logs and archives. |  |
| Answers a message | `ROLE_LABELS.chat` | `app/types/board.ts:976` | Step role: answers a message. |  |
| API | `LANE_LABELS.api` | `app/types/board.ts:777` | Agent lane that answers from the card text alone. |  |
| Harness | `LANE_LABELS.harness` | `app/types/board.ts:777` | Agent lane that runs a full local harness. |  |
| Plan a new agent | `REQUEST_TYPE_LABELS.plan_container` | `app/types/board.ts:981` | What an agent can do: plan a new agent. |  |
| Explain how the system works | `REQUEST_TYPE_LABELS.explain_spec` | `app/types/board.ts:982` | What an agent can do: explain the system. |  |
| Audit an agent (read only) | `REQUEST_TYPE_LABELS.audit_container` | `app/types/board.ts:983` | What an agent can do: audit an agent, read only. |  |
| Draft an n8n workflow | `REQUEST_TYPE_LABELS.draft_workflow` | `app/types/board.ts:984` | What an agent can do: draft an n8n workflow. |  |
| Answer a request from the card text alone | `REQUEST_TYPE_LABELS.api_task` | `app/types/board.ts:985` | What an agent can do: answer from the card text alone. | Answer a task from the card text alone |
| Answer messages on a card | `REQUEST_TYPE_LABELS.board_reply` | `app/types/board.ts:986` | What an agent can do: answer messages on a card. |  |

## Import columns

Column names offered when importing cards from a file (`IMPORT_FIELDS`).

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Card ID (updates the card) | `IMPORT_FIELDS.task_id` | `app/types/board.ts:832` | Import column: the card to update; blank creates a new card. | Task ID (updates the card) |
| Title | `IMPORT_FIELDS.title` | `app/types/board.ts:833` | Import column: card title (required). |  |
| Original request | `IMPORT_FIELDS.original_request` | `app/types/board.ts:834` | Import column: the request text. |  |
| Acceptance requirements | `IMPORT_FIELDS.acceptance_requirements` | `app/types/board.ts:835` | Import column: what counts as done. |  |
| Card type | `IMPORT_FIELDS.task_type` | `app/types/board.ts:836` | Import column: card type. | Task type |
| Priority | `IMPORT_FIELDS.priority` | `app/types/board.ts:837` | Import column: priority. |  |
| Project | `IMPORT_FIELDS.project_id` | `app/types/board.ts:838` | Import column: project. |  |
| Tags | `IMPORT_FIELDS.tags` | `app/types/board.ts:839` | Import column: tags. |  |
| Due date | `IMPORT_FIELDS.due_at` | `app/types/board.ts:840` | Import column: due date. |  |
| Assignee | `IMPORT_FIELDS.assignee` | `app/types/board.ts:841` | Import column: who holds the card. |  |
| Approval | `IMPORT_FIELDS.approval_state` | `app/types/board.ts:842` | Import column: approval state. |  |

## Refusals

Plain text shown when a write is refused.

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Someone changed this card first. The board re-read it; try again. | `REFUSAL_LABELS.stale` | `app/types/board.ts:763` | Shown when a write lost a race with another change. |  |
| The agent token isn't recognized. | `REFUSAL_LABELS.unknown token` | `app/types/board.ts:764` | Shown when an agent token is not recognized. |  |
| Another agent claimed this step first. | `REFUSAL_LABELS.another claim changed the step first` | `app/types/board.ts:765` | Shown when two agents claim the same step. |  |
| Board writes are off until the write gateway is connected. | `REFUSAL_LABELS.read only` | `app/types/board.ts:766` | Shown when board writes are off. |  |
| Sign in again to make changes. | `REFUSAL_LABELS.signed out` | `app/types/board.ts:767` | Shown when the sign-in has expired. |  |
| The board server didn't answer. Nothing was changed. | `REFUSAL_LABELS.no response` | `app/types/board.ts:768` | Shown when the board server did not answer. |  |
| The write gateway doesn't support this yet. Nothing was changed. | `REFUSAL_LABELS.op not live` | `app/types/board.ts:769` | Shown when the write gateway lacks the action. |  |

## Single labels

Labels defined as one constant.

| UI word | Code name | Defined | Plain meaning | Previously |
|---|---|---|---|---|
| Local file | `LOCAL_FILE_LABEL` | `app/types/board.ts:8` | Live dot text when the board reads a local file. |  |
| Add note · no step | `QUESTION_NOTE_LABEL` | `app/types/board.ts:756` | Drawer button while a question is open: keeps a note, starts no step. |  |
| Reply · starts a step | `QUESTION_REPLY_LABEL` | `app/types/board.ts:757` | Drawer button while a question is open: replies and starts a step. |  |
| Register API agent | `REGISTER_API_AGENT_LABEL` | `app/types/board.ts:791` | Button that opens the registry form for an API agent. |  |
| Budget used | `BUDGET_USED_LABEL` | `app/types/board.ts:793` | Agent detail: how much of the budget is spent. |  |
| Agent note | `AGENT_NOTE_LABEL` | `app/types/board.ts:794` | Thread label for a note written by an agent. |  |
| Plan | `PLAN_LABEL` | `app/types/board.ts:804` | The one rail, palette and phone link to the Plan page at /plan. Sketch is a tab on that page. |  |
| cards waiting on you | `NAV_BADGE_WHAT.Floor` | `app/types/board.ts:810` | What the Floor badge counts. Its tooltip and aria-label. |  |
| open cards | `NAV_BADGE_WHAT.Board` | `app/types/board.ts:811` | What the Board badge counts. |  |
| agents working now | `NAV_BADGE_WHAT.Agents` | `app/types/board.ts:812` | What the Agents badge counts. |  |
| cards shipped today | `NAV_BADGE_WHAT.Shipped` | `app/types/board.ts:813` | What the Shipped badge counts. |  |

## Renamed words (decided 11/7/2026)

The owner's wording decisions, applied in wave 3. `test/wording.test.ts` fails when a Previously word comes back in user-facing source.

| Now | Where | Previously |
|---|---|---|
| Card, cards | Buttons, menus, palette group, headings, toasts, errors, tooltips, `/help`, `/settings`, shortcuts | ticket, tickets, task, tasks (New ticket, Ticket panel, Tickets, Show n tasks) |
| New card, Edit card | Card editor title and every New button | New ticket |
| Card panel | The panel that opens over a page (`?task=` link is unchanged) | Ticket panel, ticket drawer |
| Ready for review | Work state `verifying` (pill and label) | Complete |
| Done | Work state `done` (pill, label, "Done 10/25/2026") | Logged |
| Needs you | Floor zone title, Settings "Floor: Needs you", help | Your move |
| Agent problems | Registry heading and Fleet "Show" column | Needs attention |
| Problems | Registry tab label, desktop and phone, with the count | Attention |
| Create and start | Card editor submit button, its shortcut hint and tooltip | Run it |
| Waiting for an agent | Step state `awaiting_pull` | Awaiting pull |
| Done, checking | Step state `served` | Served |
| Open to any agent | Pill on a step any agent in a pool may take | Open · claimable |
| Confirm change | Registry lifecycle sheet title | Lifecycle change request (the "gate" sheet) |
| Ask Orchestrator | Rail button, Floor and card buttons, `/orchestrator`, palette row | Ask the board manager |
| Ask the board manager | Palette row for bulk-edit requests only | (new row) |
| Orchestrator: answers and routes | Panel header role line when Orchestrator answers | Orchestrator |
| Board manager: edits cards in bulk | Panel header role line for the bulk-edit voice | Offline helper, "Not Orchestrator. This helper edits the board in bulk" |
| Card ID, Card type | CSV import column names | Task ID, Task type |
| Find a card | Search box on Shipped (`/` focuses it) | (new) |
| Skip to content | First tab stop on every page, hidden until it has focus | (new) |

## Optional orchestrator features

The orchestrator tab on the Agents pages (Live, Roster, then the orchestrator's name), the "Open full history" link in the
orchestrator panel, the `/orchestrator` screen and the OAuth group on `/api` show only when `NUXT_PUBLIC_FEATURE_ORCHESTRATOR=true`.
With the flag off, the Agents tabs are Live and Roster, and `/orchestrator` opens `/agents`. No label changes.

The header name comes from `NUXT_PUBLIC_APP_NAME` (default claimboard).

## Color on cards (Phase 6)

Only three states use color on a card: **Working** (blue), **Needs you** (amber) and **Blocked** (red). Every other state, including Ready for review and Done, is gray and tells itself apart by its words. Step chips follow the same rule: dispatched is Working, needs input is Needs you, failed is Blocked; all other step states are gray. `test/quiet-color.test.ts` holds the line.

## Owner decisions pending

None. The three open choices (name for a unit of work, word for finished agent work, owner-action phrase) were answered 11/7/2026 and are in the table above.
