-- SportsEdge Alpaca PAPER-only execution outbox: PROPOSAL, NOT A MIGRATION.
-- DO NOT execute on Production or an existing Supabase project.
-- Must be reviewed and concurrency tested on a disposable PostgreSQL instance,
-- then promoted through a separately approved, generated migration.
-- No code in this PR reads or writes this table.
BEGIN;
CREATE SCHEMA IF NOT EXISTS sportsedge_private;
REVOKE ALL ON SCHEMA sportsedge_private FROM PUBLIC;
REVOKE ALL ON SCHEMA sportsedge_private FROM anon, authenticated;
CREATE TABLE IF NOT EXISTS sportsedge_private.alpaca_paper_order_outbox (
  intent_id text PRIMARY KEY CHECK (intent_id ~ '^preview-[a-f0-9]{32}$'),
  account_alias text NOT NULL CHECK (length(account_alias) BETWEEN 1 AND 128),
  signal_id text NOT NULL CHECK (length(signal_id) BETWEEN 1 AND 128),
  signal_digest char(64) NOT NULL CHECK (signal_digest ~ '^[a-f0-9]{64}$'),
  model_version text NOT NULL CHECK (length(model_version) BETWEEN 1 AND 128),
  client_order_id text NOT NULL UNIQUE CHECK (length(client_order_id) BETWEEN 1 AND 48),
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z][A-Z0-9.-]{0,9}$'),
  shares integer NOT NULL CHECK (shares BETWEEN 1 AND 1000),
  limit_cents bigint NOT NULL CHECK (limit_cents BETWEEN 1 AND 1000000),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','owner_approved','submitting','broker_acknowledged',
      'broker_filled','broker_rejected','broker_canceled','submission_uncertain','stopped')),
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  owner_approval_ref text,
  broker_order_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT prevent_approval_without_ref CHECK (
    status NOT IN ('owner_approved','submitting','broker_acknowledged','broker_filled',
      'broker_rejected','broker_canceled','submission_uncertain')
    OR owner_approval_ref IS NOT NULL
  )
);
-- Never have two outstanding or ambiguous submissions for one paper account.
CREATE UNIQUE INDEX IF NOT EXISTS alpaca_paper_one_active_intent_per_account
ON sportsedge_private.alpaca_paper_order_outbox(account_alias)
WHERE status IN ('owner_approved','submitting','broker_acknowledged','submission_uncertain');
-- Never accept the same reviewed signal twice for one account/model.
CREATE UNIQUE INDEX IF NOT EXISTS alpaca_paper_unique_account_signal
ON sportsedge_private.alpaca_paper_order_outbox(account_alias,model_version,signal_id);
ALTER TABLE sportsedge_private.alpaca_paper_order_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE sportsedge_private.alpaca_paper_order_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON sportsedge_private.alpaca_paper_order_outbox FROM PUBLIC, anon, authenticated;
-- Intentionally no SELECT/INSERT/UPDATE/DELETE grants or RLS policies.
-- A future owner-authenticated server-only transactional RPC must implement
-- compare-and-swap lock_version updates, durable audit history, and broker
-- reconciliation. No claim this table alone provides exactly-once execution.
COMMIT;
