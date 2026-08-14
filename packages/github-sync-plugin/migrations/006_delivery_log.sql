-- github_sync_delivery — one row per inbound webhook delivery + its processing
-- outcome (W2 / GOL-1411). Before this the receiver 200'd on EVERY delivery,
-- including unsigned garbage and deliveries whose downstream write failed, so
-- GitHub's delivery log showed green while inbound mirroring was dead — the
-- 2026-08-12 outage stayed invisible for ~20h. This table makes per-delivery
-- processing status queryable over DATABASE_URL, and the `outcome <> 'processed'`
-- count is the failed-processing counter the ops alert is derived from.
--
-- Same host-derived namespace as 001–005 (plugin id "agenticos.github-sync-plugin"
-- + slug "github_sync"); regenerate if either changes. Runtime DDL is forbidden by
-- the plugin-DB contract, so this table MUST come from a migration.
CREATE TABLE plugin_github_sync_40eceaaa3a.github_sync_delivery (
  id BIGSERIAL PRIMARY KEY,
  -- host-provided unique delivery id (input.requestId); the idempotency key.
  request_id TEXT NOT NULL,
  -- manifest endpoint key the delivery hit (github-issue / github-app / github-pr).
  endpoint_key TEXT NOT NULL,
  -- X-GitHub-Event header (issues / pull_request / check_suite …), when present.
  event TEXT,
  -- X-GitHub-Delivery GUID, when present — cross-references GitHub's own log.
  delivery_guid TEXT,
  -- terminal outcome: processed | rejected_signature | rejected_config
  --   | invalid_payload | failed_processing. Only 'processed' is a success.
  outcome TEXT NOT NULL,
  -- short human detail (rejection reason / error message), truncated on write.
  detail TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX github_sync_delivery_occurred_at_idx
  ON plugin_github_sync_40eceaaa3a.github_sync_delivery (occurred_at DESC);
-- The failed-processing counter reads WHERE outcome <> 'processed'; index it.
CREATE INDEX github_sync_delivery_outcome_idx
  ON plugin_github_sync_40eceaaa3a.github_sync_delivery (outcome);
