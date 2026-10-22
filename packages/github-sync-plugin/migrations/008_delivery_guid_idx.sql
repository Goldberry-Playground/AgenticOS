-- Index github_sync_delivery.delivery_guid for the replay guard (GOL-3588).
-- Every signature-verified delivery now asks "has this X-GitHub-Delivery GUID
-- already been processed?" before running its handler; without this index that
-- is a sequential scan of an append-only table on every webhook.
--
-- Deliberately NOT a UNIQUE index: existing rows legitimately repeat GUIDs (the
-- dead-man probe sent a static GUID every run, and GitHub's manual Redeliver
-- reuses the original GUID after a failure), so a unique constraint would fail
-- to build. Uniqueness of PROCESSED deliveries is enforced in the worker.
--
-- Same host-derived namespace as 001–007 (plugin id "agenticos.github-sync-plugin"
-- + slug "github_sync"); regenerate if either changes.
CREATE INDEX github_sync_delivery_guid_idx
  ON plugin_github_sync_40eceaaa3a.github_sync_delivery (delivery_guid);
