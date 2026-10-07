"use client";
import { useMemo } from "react";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import {
  SkillGalaxyBackdrop,
  type SkillGalaxyDomain,
} from "./backdrops/SkillGalaxyBackdrop";
import { useArchitectureVista } from "@/lib/hooks/use-architecture-vista";

/**
 * Architecture tab hero vista — wired to live endpoints via
 * {@link useArchitectureVista} (truth pass 2026-07-14; previously a
 * hardcoded DOMAINS grid and "11 registered / 25 dispatched" stubs):
 *
 *   - /api/vault/skills → registered-skill count, per-domain galaxy nodes,
 *     top domain (domain = path segment after `Skills/`, like the
 *     Architecture page derives it)
 *   - /api/agent/runs   → runs started since UTC midnight ("dispatched today")
 *
 * Tile changes vs the stub version: the per-skill dispatch-count tile
 * ("farm-task-triage (12)") had NO data source anywhere in the stack and was
 * dropped; untagged-skill count (real, derived from skill paths) replaces it.
 * Sources that error render "—" — never a fabricated value (CostVista pattern).
 */
const PLACEHOLDER = "—";

interface DomainStats {
  domains: SkillGalaxyDomain[];
  top: { name: string; count: number } | null;
  untagged: number;
}

/**
 * Derive per-domain skill counts from vault paths (wiki/Skills/<Domain>/…).
 * Skills directly under Skills/ (no domain folder) count as untagged.
 */
function toDomainStats(paths: string[]): DomainStats {
  const counts = new Map<string, number>();
  let untagged = 0;
  for (const path of paths) {
    const segments = path.split("/");
    const skillsIdx = segments.findIndex((s) => s.toLowerCase() === "skills");
    const domain =
      skillsIdx >= 0 && segments.length > skillsIdx + 2
        ? segments[skillsIdx + 1]
        : null;
    if (!domain) {
      untagged += 1;
      continue;
    }
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort(([, a], [, b]) => b - a);
  const domains: SkillGalaxyDomain[] = sorted.map(([name, count]) => ({
    name,
    count,
  }));
  const top = sorted.length > 0 ? { name: sorted[0][0], count: sorted[0][1] } : null;
  return { domains, top, untagged };
}

export function ArchitectureVista() {
  const { data, dataUpdatedAt } = useArchitectureVista();

  const skills = data?.skills ?? null;
  const runsToday = data?.runsToday ?? null;

  const { domains, top, untagged } = useMemo(
    () => toDomainStats((skills?.skills ?? []).map((s) => s.path)),
    [skills],
  );

  return (
    <VistaShell
      accent="copper"
      asOfMs={dataUpdatedAt}
      backdrop={<SkillGalaxyBackdrop domains={domains} />}
    >
      <KpiTile
        value={skills ? String(skills.totalRegistered) : PLACEHOLDER}
        label="registered skills"
        sublabel={
          skills
            ? `${domains.length} domain${domains.length === 1 ? "" : "s"}`
            : "loading…"
        }
      />
      <KpiTile
        value={runsToday ? String(runsToday.count) : PLACEHOLDER}
        label="dispatched today"
        sublabel={runsToday ? "agent runs since midnight UTC" : "loading…"}
      />
      <KpiTile
        value={
          top ? (
            <>
              {top.name}
              <span className="unit"> ({top.count})</span>
            </>
          ) : (
            PLACEHOLDER
          )
        }
        label="top domain"
        sublabel={
          top
            ? `${top.count} skill${top.count === 1 ? "" : "s"}`
            : skills
              ? "no domain folders"
              : "loading…"
        }
      />
      <KpiTile
        value={skills ? String(untagged) : PLACEHOLDER}
        label="untagged skills"
        sublabel={skills ? "no domain folder" : "loading…"}
      />
    </VistaShell>
  );
}

export default ArchitectureVista;
