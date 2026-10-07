"use client";
import { useMemo } from "react";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import { MemoryAccumulationBackdrop } from "./backdrops/MemoryAccumulationBackdrop";
import { useVikingScopes } from "@/lib/hooks/use-viking-scopes";
import { useVaultStats } from "@/lib/hooks/use-vault-stats";
import { oldestUpdatedAt } from "./as-of";

/**
 * Memory tab hero vista — wired to live endpoints (truth pass 2026-07-12;
 * previously hardcoded stub values):
 *
 *   - /api/viking/scopes → total memories + top scope (OpenViking stats)
 *   - /api/vault/stats   → vault page count + last index build ("last sync")
 *
 * Tile changes vs the stub version: "indexed today +2.8%" had NO data
 * source anywhere in the stack, so that tile now shows the vault page
 * count (real) instead of an invented growth number. Sources that error
 * render "—" — never a fabricated value (RunsVista pattern).
 */
const PLACEHOLDER = "—";

function relativeTime(epochMs: number | undefined): string | null {
  if (!epochMs || !Number.isFinite(epochMs)) return null;
  const deltaS = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (deltaS < 60) return "now";
  const min = Math.floor(deltaS / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function MemoryVista() {
  const scopesQuery = useVikingScopes();
  const vaultQuery = useVaultStats();

  // Viking unreachable ⇒ degrade to placeholders (reachable:false still 200s).
  const scopes =
    scopesQuery.data && scopesQuery.data.reachable ? scopesQuery.data : null;
  const vault = vaultQuery.data ?? null;

  const topScope = useMemo(() => {
    if (!scopes || scopes.total <= 0) return null;
    const entries = Object.entries(scopes.scopes).sort(([, a], [, b]) => b - a);
    if (entries.length === 0) return null;
    const [name, count] = entries[0];
    return { name, count, pct: Math.round((count / scopes.total) * 100) };
  }, [scopes]);

  const lastSync = relativeTime(vault?.builtAt);

  return (
    <VistaShell
      scope="Memory"
      accent="sage"
      // Oldest of the two (GOL-3111). OpenViking going unreachable while
      // vault-server stays up is the exact case this vista hits in practice,
      // and `max` used to let the vault's stamp speak for both.
      asOfMs={oldestUpdatedAt(
        scopesQuery.dataUpdatedAt,
        vaultQuery.dataUpdatedAt,
      )}
      backdrop={<MemoryAccumulationBackdrop />}
    >
      <KpiTile
        value={scopes ? scopes.total.toLocaleString("en-US") : PLACEHOLDER}
        label="total memories"
        sublabel={
          scopes
            ? `${Object.keys(scopes.scopes).length} scopes`
            : scopesQuery.isLoading
              ? "loading…"
              : "openviking unreachable"
        }
      />
      <KpiTile
        value={vault ? vault.pageCount.toLocaleString("en-US") : PLACEHOLDER}
        label="vault pages"
        sublabel={vault ? "indexed by vault-server" : "loading…"}
      />
      <KpiTile
        value={topScope ? topScope.name : PLACEHOLDER}
        label="top scope"
        sublabel={
          topScope
            ? `${topScope.count.toLocaleString("en-US")} items (${topScope.pct}%)`
            : scopes
              ? "no memories yet"
              : "loading…"
        }
      />
      <KpiTile
        value={
          lastSync ? (
            lastSync === "now" ? (
              "now"
            ) : (
              <>
                {lastSync}
                <span className="unit"> ago</span>
              </>
            )
          ) : (
            PLACEHOLDER
          )
        }
        label="last index"
        sublabel={lastSync ? "vault-server build" : "loading…"}
      />
    </VistaShell>
  );
}

export default MemoryVista;
