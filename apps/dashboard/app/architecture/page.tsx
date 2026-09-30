"use client";

import { Plus, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useFilter } from "@/lib/filter/use-filter";
import { SkillCard, type Skill } from "@/components/skills/skill-card";
import { ArchitectureVista } from "@/components/shell/ArchitectureVista";
import { useVaultSkills } from "@/lib/vault/hooks/use-vault-skills";
import type { SkillEntry } from "@/app/api/vault/skills/route";

const DOMAIN_CHIPS: { id: string; label: string }[] = [
  { id: "farm", label: "Farm" },
  { id: "software", label: "Software" },
  { id: "marketing", label: "Marketing" },
  { id: "video", label: "Video" },
  { id: "personal", label: "Personal" },
];

/**
 * The real vault stores skills nested by domain (wiki/Skills/Software/…), so
 * the domain tag is the path segment immediately after `Skills/`. Triggers ride
 * along as additional tags so they show on the card.
 */
function entryToSkill(entry: SkillEntry): Skill {
  const segments = entry.path.split("/");
  const skillsIdx = segments.findIndex((s) => s.toLowerCase() === "skills");
  const domain =
    skillsIdx >= 0 && segments.length > skillsIdx + 2
      ? segments[skillsIdx + 1].toLowerCase()
      : null;

  const tags = [
    ...(domain ? [domain] : []),
    ...entry.triggers,
  ].filter((t, i, arr) => arr.indexOf(t) === i);

  return {
    id: entry.path,
    name: entry.name,
    description: entry.description,
    tags,
  };
}

export default function ArchitecturePage() {
  const { tags, toggleTag, clear } = useFilter();
  const { data, isLoading, isError } = useVaultSkills();

  const allSkills = (data?.skills ?? []).map(entryToSkill);

  const visibleSkills =
    tags.length === 0
      ? allSkills
      : allSkills.filter((skill) => skill.tags.some((t) => tags.includes(t)));

  function handleNewSkill() {
    toast.info("Skill creation available in Phase 2.");
  }

  return (
    <>
    <ArchitectureVista />
    <div className="flex flex-col gap-6 px-6 py-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-xl font-medium tracking-tight"
            style={{ color: "var(--text)" }}
          >
            Architecture
          </h1>
          <p
            className="mt-0.5 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            Buttonize your workflows.
          </p>
        </div>

        {/* + New Skill */}
        <button
          type="button"
          onClick={handleNewSkill}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            backgroundColor: "var(--surface-muted)",
            border: "1px solid var(--border-brand)",
            color: "var(--text-secondary)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--border-strong)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "var(--border-brand)";
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--text-secondary)";
          }}
          aria-label="Create new skill"
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
          New Skill
        </button>
      </div>

      {/* Domain rail */}
      <div
        className="flex items-center gap-2 overflow-x-auto pb-1"
        role="group"
        aria-label="Filter by domain"
      >
        {/* All chip */}
        <button
          type="button"
          onClick={clear}
          className="flex shrink-0 items-center rounded px-3 py-1 text-xs font-medium transition-colors"
          style={{
            height: 26,
            backgroundColor:
              tags.length === 0 ? "var(--accent-plum-800)" : "var(--surface-muted)",
            color:
              tags.length === 0
                ? "var(--accent-plum-300)"
                : "var(--text-secondary)",
            border: `1px solid ${tags.length === 0 ? "var(--accent-plum-600)" : "var(--border-subtle)"}`,
          }}
          aria-pressed={tags.length === 0}
        >
          All
        </button>

        {DOMAIN_CHIPS.map(({ id, label }) => {
          const isActive = tags.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => toggleTag(id)}
              className="flex shrink-0 items-center rounded px-3 py-1 text-xs font-medium transition-colors"
              style={{
                height: 26,
                backgroundColor: isActive
                  ? "var(--accent-plum-800)"
                  : "var(--surface-muted)",
                color: isActive
                  ? "var(--accent-plum-300)"
                  : "var(--text-secondary)",
                border: `1px solid ${isActive ? "var(--accent-plum-600)" : "var(--border-subtle)"}`,
              }}
              aria-pressed={isActive}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Skill grid, with loading / error / empty states */}
      {isLoading ? (
        <div
          className="flex flex-col items-center justify-center gap-3 py-20"
          role="status"
        >
          <Loader2
            size={32}
            strokeWidth={1.5}
            className="animate-spin"
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Loading skills…
          </p>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <AlertCircle
            size={32}
            strokeWidth={1.5}
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <p
            className="text-sm font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            Skills catalog unavailable
          </p>
        </div>
      ) : allSkills.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <Sparkles
            size={40}
            strokeWidth={1.5}
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <p
            className="text-sm font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            No skills registered
          </p>
        </div>
      ) : visibleSkills.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <Sparkles
            size={40}
            strokeWidth={1.5}
            style={{ color: "var(--text-muted)" }}
            aria-hidden="true"
          />
          <p
            className="text-sm font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            No skills match this filter
          </p>
          <button
            type="button"
            onClick={clear}
            className="text-sm underline underline-offset-4 transition-colors"
            style={{ color: "var(--accent-plum-400)" }}
          >
            Clear filter
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleSkills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      )}
    </div>
    </>
  );
}
