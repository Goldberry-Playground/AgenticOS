-- github_sync_heartbeat — a single-row worker liveness signal (GOL-2371, D3 of
-- GOL-2344; follow-up to GOL-2279). A live worker refreshes `updated_at` every
-- few minutes from the `worker-heartbeat` scheduled job (and once at boot); a
-- dead worker stops, so the row goes stale. That staleness is the signal an
-- external watchdog reads over DATABASE_URL (or the host supervisor reads) to
-- auto-respawn or page within MINUTES — closing the 5-day silent-outage gap where
-- a boot-time crash left inbound webhooks 502ing with no alert.
--
-- Unlike github_sync_delivery (which only advances when a webhook arrives, so a
-- quiet window and a dead worker look identical), this heartbeat is UNCONDITIONAL.
--
-- Same host-derived namespace as 001–006 (plugin id "agenticos.github-sync-plugin"
-- + slug "github_sync"); regenerate if either changes. Runtime DDL is forbidden by
-- the plugin-DB contract, so this table MUST come from a migration.
CREATE TABLE plugin_github_sync_40eceaaa3a.github_sync_heartbeat (
  -- Pinned to 1 by the writer + this CHECK: the table holds at most one row, so
  -- an ON CONFLICT (id) upsert can never let it grow.
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- ISO-8601 timestamp of the most recent heartbeat write — the liveness clock
  -- the read side compares against `now` to decide stale-vs-alive.
  updated_at TEXT NOT NULL,
  -- ISO-8601 timestamp the current worker PROCESS booted; changes only on a
  -- respawn, so a monitor can also see that a respawn actually happened.
  worker_booted_at TEXT NOT NULL,
  -- Plugin version this worker is running, for at-a-glance drift checks.
  worker_version TEXT
);
