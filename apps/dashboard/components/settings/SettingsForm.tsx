"use client";

import React, { useState, useCallback } from "react";
import { toast } from "sonner";
import { PlusIcon, XIcon, FolderIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AgenticOSConfig, ProjectRoot, ConnectorConfig } from "@/lib/config/schema";

const MODEL_OPTIONS = [
  { value: "claude-haiku-4-5", label: "claude-haiku-4-5" },
  { value: "claude-sonnet-4-7", label: "claude-sonnet-4-7" },
  { value: "claude-opus-4-7", label: "claude-opus-4-7" },
  { value: "divider", label: "──── Other providers ────", disabled: true },
  { value: "gpt-5-mini", label: "gpt-5-mini (OpenAI)" },
  { value: "kimi-k2", label: "kimi-k2 (Moonshot)" },
  { value: "glm-4.7", label: "glm-4.7 (Zhipu AI)" },
];

const CONNECTOR_LABELS: Record<string, string> = {
  farmos: "farmOS",
  odoo: "Odoo",
  ghost: "Ghost",
  asana: "Asana",
  slack: "Slack",
  gh: "GitHub",
};

interface Props {
  initialConfig: AgenticOSConfig;
}

export function SettingsForm({ initialConfig }: Props) {
  const [config, setConfig] = useState<AgenticOSConfig>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Project Roots ──────────────────────────────────────────────────────────

  const addProjectRoot = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      projectRoots: [...prev.projectRoots, { path: "", tags: [] }],
    }));
  }, []);

  const removeProjectRoot = useCallback((index: number) => {
    setConfig((prev) => ({
      ...prev,
      projectRoots: prev.projectRoots.filter((_, i) => i !== index),
    }));
  }, []);

  const updateProjectRoot = useCallback(
    (index: number, field: keyof ProjectRoot, value: string | string[]) => {
      setConfig((prev) => ({
        ...prev,
        projectRoots: prev.projectRoots.map((root, i) =>
          i === index ? { ...root, [field]: value } : root
        ),
      }));
    },
    []
  );

  // ── Connectors ─────────────────────────────────────────────────────────────

  const toggleConnector = useCallback((id: string) => {
    setConfig((prev) => ({
      ...prev,
      connectors: prev.connectors.map((c) =>
        c.id === id ? { ...c, enabled: !c.enabled } : c
      ),
    }));
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        const body = await res.json();
        if (body.issues) {
          const fieldErrors: Record<string, string> = {};
          for (const issue of body.issues) {
            const key = issue.path.join(".") || "general";
            fieldErrors[key] = issue.message;
          }
          setErrors(fieldErrors);
          toast.error("Settings not saved — validation errors.");
        } else {
          toast.error(body.error ?? "Failed to save settings.");
        }
        return;
      }

      const saved = await res.json();
      setConfig(saved);
      toast.success("Settings saved.");
    } catch {
      toast.error("Network error — settings not saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8 max-w-2xl">
      {/* ── Project Roots ─────────────────────────────────────── */}
      <section>
        <SectionHeader title="Project Roots" />
        <div className="flex flex-col gap-3">
          {config.projectRoots.length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No project roots registered. Add one to associate agent runs with local codebases.
            </p>
          )}
          {config.projectRoots.map((root, i) => (
            <ProjectRootRow
              key={i}
              root={root}
              index={i}
              onUpdate={updateProjectRoot}
              onRemove={removeProjectRoot}
              error={errors[`projectRoots.${i}.path`]}
            />
          ))}
          <button
            type="button"
            onClick={addProjectRoot}
            className="inline-flex items-center gap-1.5 text-sm transition-colors"
            style={{ color: "var(--accent-plum-400)" }}
          >
            <PlusIcon size={14} />
            Add project root
          </button>
        </div>
      </section>

      {/* ── Vault Path ────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Vault Path" />
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Path to your Obsidian vault. Tilde (~) is expanded to your home directory.
        </p>
        <div className="flex gap-2 items-center">
          <Input
            value={config.vaultPath}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, vaultPath: e.target.value }))
            }
            placeholder="~/Documents/vault"
            className="flex-1 font-mono text-sm"
          />
          <FolderPickerButton />
        </div>
        {errors["vaultPath"] && (
          <FieldError message={errors["vaultPath"]} />
        )}
      </section>

      {/* ── Model Defaults ────────────────────────────────────── */}
      <section>
        <SectionHeader title="Model Defaults" />
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Default model per task tier. Skill-level pins and per-run overrides take priority.
        </p>
        <div className="flex flex-col gap-3">
          {(["haiku", "sonnet", "opus"] as const).map((tier) => (
            <ModelRow
              key={tier}
              tier={tier}
              value={config.modelDefaults[tier]}
              onChange={(val) =>
                setConfig((prev) => ({
                  ...prev,
                  modelDefaults: { ...prev.modelDefaults, [tier]: val },
                }))
              }
            />
          ))}
        </div>
      </section>

      {/* ── Connectors ───────────────────────────────────────── */}
      <section>
        <SectionHeader title="Connectors" />
        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Enable connectors when integration is configured. Auth setup in Phase 5.
        </p>
        <div className="flex flex-col divide-y" style={{ borderColor: "var(--border-subtle)" }}>
          {config.connectors.map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              onToggle={toggleConnector}
            />
          ))}
        </div>
      </section>

      {/* ── Save ─────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <h2
      className="text-sm font-semibold uppercase tracking-wider mb-3"
      style={{ color: "var(--text-muted)", letterSpacing: "0.08em" }}
    >
      {title}
    </h2>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p className="text-xs mt-1" style={{ color: "var(--error)" }}>
      {message}
    </p>
  );
}

/**
 * Placeholder for the native folder picker — inert until Phase 6 (GOL-2707).
 *
 * `disabled` is load-bearing, not cosmetic. It fixes two things at once:
 *
 *  1. The button has no `onClick`. While enabled it still took a tab stop, so
 *     keyboard users landed on a control that could never do anything.
 *  2. While enabled, WCAG 1.4.11 applied to its boundary and glyph — and the
 *     old `--border-brand` outline measured 1.76:1 dark / 1.44:1 light against
 *     the surfaces this button sits on, well under the 3:1 floor. No border
 *     token in the dark palette clears 3:1 (`--border-strong`, the strongest,
 *     tops out at 2.81:1), so there was nothing to re-point it to. Inactive
 *     controls are exempt from 1.4.11, and disabling makes that exemption
 *     legitimate instead of assumed.
 *
 * Do NOT re-enable this on a hairline border when Phase 6 lands: the dark
 * border-token gap is tracked in GOL-2673 and has to close first.
 *
 * The outline is dropped rather than recoloured, so this now matches the
 * sibling "Remove project root" icon button in the same row (Gestalt
 * similarity) — before, the inert control carried the *stronger* affordance of
 * the two. What separates them is weight: `--text-muted` is the palette's
 * documented "placeholders, disabled" step and stays here, while the live ✕
 * was moved up to `--text-secondary`. Measured, that is 3.27:1 vs 7.32:1 dark
 * and 3.09:1 vs 7.70:1 light — both legible, unmistakably ranked.
 *
 * Deliberately NOT dimmed with `opacity`. `--text-muted` is already the low
 * step, and 60% on top of it painted the glyph at 1.78:1 in light mode, which
 * reads as a rendering artefact rather than a disabled control. State is
 * carried by weight + `cursor-not-allowed` + the `disabled` attribute, never by
 * hue, so it survives grayscale and all three dichromacies.
 */
function FolderPickerButton() {
  return (
    <button
      type="button"
      disabled
      title="Native folder picker — available in Phase 6"
      className="inline-flex shrink-0 items-center justify-center size-8 rounded-md cursor-not-allowed"
      style={{ color: "var(--text-muted)" }}
      aria-label="Pick folder — available in Phase 6"
    >
      <FolderIcon size={14} aria-hidden="true" />
    </button>
  );
}

interface ProjectRootRowProps {
  root: ProjectRoot;
  index: number;
  onUpdate: (index: number, field: keyof ProjectRoot, value: string | string[]) => void;
  onRemove: (index: number) => void;
  error?: string;
}

function ProjectRootRow({ root, index, onUpdate, onRemove, error }: ProjectRootRowProps) {
  const tagsValue = root.tags.join(", ");

  return (
    <div
      className="flex flex-col gap-2 p-3 rounded-lg border"
      style={{ borderColor: "var(--border-brand)", backgroundColor: "var(--surface)" }}
    >
      <div className="flex gap-2 items-center">
        <Input
          value={root.path}
          onChange={(e) => onUpdate(index, "path", e.target.value)}
          placeholder="~/Dev Projects/my-project"
          className="flex-1 font-mono text-sm"
          aria-label={`Project root ${index + 1} path`}
        />
        <FolderPickerButton />
        {/* --text-secondary, not --text-muted: --text-muted is the palette's
            "placeholders, disabled" step and the inert FolderPickerButton beside
            this one uses it. A live destructive control cannot share that step,
            or the two icon buttons in this row rank equal (GOL-2707).
            Measured 7.32:1 dark / 7.70:1 light. */}
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="inline-flex shrink-0 items-center justify-center size-8 rounded-md transition-colors"
          style={{ color: "var(--text-secondary)" }}
          aria-label="Remove project root"
        >
          <XIcon size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label
          className="text-xs shrink-0"
          style={{ color: "var(--text-muted)" }}
        >
          Tags (comma-separated)
        </label>
        <Input
          value={tagsValue}
          onChange={(e) => {
            const tags = e.target.value
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
            onUpdate(index, "tags", tags);
          }}
          placeholder="code, farm, marketing"
          className="text-sm"
          aria-label={`Project root ${index + 1} tags`}
        />
      </div>
      {error && <FieldError message={error} />}
    </div>
  );
}

function ModelRow({
  tier,
  value,
  onChange,
}: {
  tier: "haiku" | "sonnet" | "opus";
  value: string;
  onChange: (val: string) => void;
}) {
  const label = tier === "haiku" ? "Haiku tier (fast)" : tier === "sonnet" ? "Sonnet tier (balanced)" : "Opus tier (reasoning)";
  const selectId = `model-default-${tier}`;
  return (
    // Single column below `sm` (GOL-2651): a 176px label plus a select whose
    // widest option is ~246px of mono does not fit a 390px phone, and the row
    // reads better stacked there anyway. The label now carries `htmlFor` — it
    // previously sat next to the select with nothing associating the two.
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <label
        htmlFor={selectId}
        className="text-sm w-full sm:w-44 sm:shrink-0"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </label>
      <Select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
        containerClassName="sm:flex-1"
      >
        {MODEL_OPTIONS.map((opt) =>
          opt.value === "divider" ? (
            <option key="divider" disabled value="">
              {opt.label}
            </option>
          ) : (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          )
        )}
      </Select>
    </div>
  );
}

function ConnectorRow({
  connector,
  onToggle,
}: {
  connector: ConnectorConfig;
  onToggle: (id: string) => void;
}) {
  const label = CONNECTOR_LABELS[connector.id] ?? connector.id;
  const switchId = `connector-${connector.id}`;

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        <label
          htmlFor={switchId}
          className="text-sm cursor-pointer"
          style={{ color: "var(--text)" }}
        >
          {label}
        </label>
        <span
          className="text-xs px-1.5 py-0.5 rounded-sm font-medium"
          style={{
            backgroundColor: "var(--surface-muted)",
            color: "var(--text-muted)",
          }}
        >
          Phase 5
        </span>
      </div>
      {/* Custom toggle switch */}
      <button
        type="button"
        id={switchId}
        role="switch"
        aria-checked={connector.enabled}
        onClick={() => onToggle(connector.id)}
        className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          backgroundColor: connector.enabled
            ? "var(--accent-plum-500)"
            : "var(--surface-elevated)",
          border: `1px solid ${connector.enabled ? "var(--accent-plum-400)" : "var(--border-strong)"}`,
        }}
      >
        <span
          className="pointer-events-none inline-block h-4 w-4 rounded-full shadow-lg transition-transform"
          style={{
            backgroundColor: connector.enabled ? "var(--text)" : "var(--text-muted)",
            transform: connector.enabled ? "translateX(16px)" : "translateX(0px)",
          }}
        />
      </button>
    </div>
  );
}
