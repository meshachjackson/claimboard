-- Path B step store.
-- Postgres is the one home for steps, notes and events. Column names are exactly those of
-- docs/schema.md (gov_task_steps, gov_task_notes, board_events). gov_tasks, gov_registry and
-- gov_access stay in n8n. Dates are timestamptz; the store maps them to ISO strings so rows keep the gateway's shape.
-- Idempotent: safe to run twice. Run only against a database the owner has named.

-- Ids come from sequences, so two writers can never draw the same id . Cutover sets each with setval()
-- to the highest live id.
CREATE SEQUENCE IF NOT EXISTS step_id_seq;
CREATE SEQUENCE IF NOT EXISTS note_id_seq;
CREATE SEQUENCE IF NOT EXISTS event_id_seq;

CREATE TABLE IF NOT EXISTS gov_task_steps (
  step_id            text PRIMARY KEY DEFAULT 'STP-' || lpad(nextval('step_id_seq')::text, 6, '0'),
  task_id            text NOT NULL,
  step_no            integer NOT NULL,
  assignee           text NOT NULL DEFAULT '',
  goal               text NOT NULL DEFAULT '',
  input_ref          text NOT NULL DEFAULT '',
  target_action      text NOT NULL DEFAULT 'read',
  target_ticket_ref  text NOT NULL DEFAULT '',
  step_state         text NOT NULL DEFAULT 'awaiting_pull'
    CHECK (step_state IN ('awaiting_start','awaiting_pull','dispatched','served','needs_input','failed','verified')),
  stop_reason        text NOT NULL DEFAULT '',
  verdict            text NOT NULL DEFAULT '',
  budget_used        text NOT NULL DEFAULT '',
  output_ref         text NOT NULL DEFAULT '',
  output_summary     text NOT NULL DEFAULT '',
  vera_ticket_ref    text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  dispatched_at      timestamptz,
  ended_at           timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  claim_key          text NOT NULL DEFAULT '',
  lease_owner        text NOT NULL DEFAULT '',
  lease_expires_at   timestamptz,
  acked_at           timestamptz,
  cancelled          boolean NOT NULL DEFAULT false,
  claim_count        integer NOT NULL DEFAULT 0,
  last_claimed_at    timestamptz,
  role               text NOT NULL DEFAULT '',
  activity           text NOT NULL DEFAULT '',
  heartbeat_at       timestamptz,
  job_id             text NOT NULL DEFAULT '',
  timeout_sec        integer,
  tokens_in          integer,
  tokens_out         integer,
  UNIQUE (task_id, step_no)
);
-- list_claimable and the sweep read open steps by assignee; acked or cancelled steps are never claimable.
CREATE INDEX IF NOT EXISTS gov_task_steps_open ON gov_task_steps (assignee) WHERE acked_at IS NULL AND NOT cancelled;
CREATE INDEX IF NOT EXISTS gov_task_steps_task ON gov_task_steps (task_id);

-- Append-only, like the n8n table. A trigger refuses UPDATE and DELETE so nothing rewrites a note.
CREATE TABLE IF NOT EXISTS gov_task_notes (
  note_id     text PRIMARY KEY DEFAULT 'NTE-' || lpad(nextval('note_id_seq')::text, 6, '0'),
  task_id     text NOT NULL,
  step_id     text NOT NULL DEFAULT '',
  author_id   text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('comment','question','proposal','summary','status','system')),
  body        text NOT NULL CHECK (char_length(body) <= 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gov_task_notes_task ON gov_task_notes (task_id);

-- board_events (schema 1.9) plus the sequence id the event feed reads from: a client asks "after seq N".
CREATE TABLE IF NOT EXISTS board_events (
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  event_id    text PRIMARY KEY DEFAULT 'EVT-' || lpad(nextval('event_id_seq')::text, 6, '0'),
  task_id     text NOT NULL,
  step_id     text NOT NULL DEFAULT '',
  job_id      text NOT NULL DEFAULT '',
  actor       text NOT NULL,
  kind        text NOT NULL -- The first eight kinds are schema 1.9. heartbeat, complete and note were added for the live event feed.
  CHECK (kind IN ('status_change','dispatch','callback','verify','retry','escalate','timeout','token_spend','heartbeat','complete','note')),
  old_value   text NOT NULL DEFAULT '',
  new_value   text NOT NULL DEFAULT '',
  tokens_in   integer,
  tokens_out  integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seq)
);

-- Card rollups the step store computed but cannot write itself: gov_tasks stays in n8n. A drain (cutover step 4) applies
-- these through gw.gov-board-write, one run per terminal transition instead of one per claim and heartbeat.
CREATE TABLE IF NOT EXISTS task_rollups (
  rollup_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id     text NOT NULL,
  fields_json text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  applied_at  timestamptz
);
-- The drain (cutover step 4, server/utils/stepStore.ts drainRollups) claims rows with a guarded UPDATE so two instances never
-- spend two n8n runs on one rollup, counts attempts, and keeps the last refusal. ADD COLUMN IF NOT EXISTS keeps the file idempotent.
ALTER TABLE task_rollups ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE task_rollups ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE task_rollups ADD COLUMN IF NOT EXISTS last_error text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS task_rollups_pending ON task_rollups (rollup_id) WHERE applied_at IS NULL;

CREATE OR REPLACE FUNCTION refuse_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
DROP TRIGGER IF EXISTS gov_task_notes_append_only ON gov_task_notes;
CREATE TRIGGER gov_task_notes_append_only BEFORE UPDATE OR DELETE ON gov_task_notes FOR EACH ROW EXECUTE FUNCTION refuse_append_only();

-- Events are append-only while they are live, and the feed only ever reads the last 10 minutes, so rows older than the
-- retention window (30 days, the store's EVENT_RETENTION_DAYS) may be deleted by the prune. Anything younger is refused,
-- and no row is ever updated. The same trigger function serves both tables; the DELETE branch is the one difference.
CREATE OR REPLACE FUNCTION board_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'board_events is append-only'; END IF;
  IF OLD.created_at >= now() - interval '30 days' THEN RAISE EXCEPTION 'board_events keeps 30 days; only older rows may be pruned'; END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS board_events_append_only ON board_events;
CREATE TRIGGER board_events_append_only BEFORE UPDATE OR DELETE ON board_events FOR EACH ROW EXECUTE FUNCTION board_events_guard();

-- The board's own error log every server fault, so the orchestrator's board_errors tool can group
-- and report them. Board-local like task_rollups, not in tables.json. The app also creates it on first use, so running this
-- file is optional; the text below is the same as ERRORS_DDL in server/utils/errorLogStore.ts (test/error-log.test.ts checks).
CREATE TABLE IF NOT EXISTS board_errors (
  seq         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      text NOT NULL,
  message     text NOT NULL,
  path        text NOT NULL DEFAULT '',
  status      integer,
  task_id     text NOT NULL DEFAULT '',
  step_id     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_errors_recent ON board_errors (created_at DESC);
