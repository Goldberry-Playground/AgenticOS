"use client";
import { useMaxQuota } from "@/lib/hooks/use-max-quota";

function tier(remainingPct: number): string {
  if (remainingPct < 10) return "bg-red-500/20 text-red-100 border-red-500/40";
  if (remainingPct < 25) return "bg-amber-500/20 text-amber-100 border-amber-500/40";
  return "bg-emerald-500/20 text-emerald-100 border-emerald-500/40";
}

export function MaxQuotaChip() {
  const { data, isError } = useMaxQuota();
  if (isError) return <Chip>Max: —</Chip>;
  if (!data) return <Chip>Max: …</Chip>;
  if (data.remaining_pct === null) return <Chip>Max: —</Chip>;
  return (
    <Chip
      className={tier(data.remaining_pct)}
      title={`Tokens remaining: ${data.remaining_tokens?.toLocaleString() ?? "—"} / ${data.limit_tokens?.toLocaleString() ?? "—"}`}
    >
      Max: {data.remaining_pct}%
    </Chip>
  );
}

function Chip({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap px-3 py-1 rounded-full text-xs border ${className}`}
      title={title}
    >
      {children}
    </span>
  );
}
