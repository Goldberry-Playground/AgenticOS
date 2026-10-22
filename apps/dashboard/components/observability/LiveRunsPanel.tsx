"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { IconBtn } from "@/components/ui/IconBtn";
import { Pill } from "@/components/ui/Pill";
import { Row, RowList } from "@/components/ui/Row";

interface ActiveRun {
  id: string;
  kind: string;
  started_at: string;
  elapsed_seconds: number;
  stuck: boolean;
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm.toString().padStart(2, "0")}m`;
  }
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

function formatStartTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}

const PlayIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <polygon points="10 8 16 12 10 16" fill="currentColor" />
  </svg>
);

const CancelIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

async function cancelRun(id: string): Promise<void> {
  await fetch(`/api/tasks/${id}`, { method: "DELETE" }).catch(() => {});
}

interface LiveRunsPanelProps {
  /**
   * Whether to render the cancel button on each run row.
   *
   * Set to false on the Paperclip data source: the cancel button POSTs to a
   * Hermes-only endpoint (`DELETE /api/tasks/:id`) that does not exist on the
   * Paperclip path. A native Paperclip cancel endpoint exists
   * (`POST /api/heartbeat-runs/:runId/cancel`) but is not yet wired — see the
   * run-control follow-up FR.
   *
   * Defaults to true (Hermes behaviour is preserved).
   */
  showCancelButton?: boolean;
}

export function LiveRunsPanel({ showCancelButton = true }: LiveRunsPanelProps) {
  const { data, isLoading } = useQuery<{ runs: ActiveRun[] }>({
    queryKey: ["tasks", "active"],
    queryFn: async () => {
      const res = await fetch("/api/tasks/active");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 5_000,
  });

  const runs = data?.runs ?? [];
  const stuckCount = runs.filter((r) => r.stuck).length;
  const summary =
    runs.length === 0
      ? "no active runs"
      : `${runs.length} active${stuckCount > 0 ? ` · ${stuckCount} stuck` : ""}`;

  // Row column template: omit the cancel-button column on the Paperclip path.
  const rowColumns = showCancelButton ? "auto 1fr auto auto" : "auto 1fr auto";

  return (
    <Card lane="gold">
      <CardHead>
        <CardTitle icon={PlayIcon}>Live runs</CardTitle>
        <CardAction>{summary}</CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : runs.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No tasks currently running.
        </div>
      ) : (
        <RowList>
          {runs.map((r) => (
            <Row
              key={r.id}
              stuck={r.stuck}
              style={{ gridTemplateColumns: rowColumns, gap: 10 }}
            >
              <Pill variant={r.stuck ? "err" : "run"}>
                {r.stuck ? "stuck" : "running"}
              </Pill>
              <div>
                <div className="label-strong" style={{ fontSize: 12.5 }}>
                  {r.kind}
                </div>
                <div
                  className="meta"
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                  }}
                >
                  {shortId(r.id)} · started {formatStartTime(r.started_at)}
                </div>
              </div>
              <span
                className="num"
                style={{
                  fontSize: 12,
                  color: r.stuck ? "var(--russet)" : undefined,
                }}
              >
                {formatElapsed(r.elapsed_seconds)}
              </span>
              {showCancelButton && (
                <IconBtn
                  variant={r.stuck ? "alert" : "default"}
                  ariaLabel={r.stuck ? "Force cancel stuck run" : "Cancel run"}
                  onClick={() => cancelRun(r.id)}
                >
                  {CancelIcon}
                </IconBtn>
              )}
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
