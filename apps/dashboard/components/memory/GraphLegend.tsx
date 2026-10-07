import { TagGlyph } from "./TagGlyph";
import type { TagLegend } from "@/lib/vault/tag-styles";

interface GraphLegendProps {
  legend: TagLegend;
}

/**
 * The text channel for node category (GOL-2960).
 *
 * A swatch-only legend would still be colour-alone, so every row carries the
 * literal `#tag` *and* the shape the node is drawn with. Sits in flow below
 * the canvas rather than floating over it — a legend that hides the nodes it
 * explains is not a legend.
 */
export function GraphLegend({ legend }: GraphLegendProps) {
  if (legend.entries.length === 0 && !legend.other) return null;

  const otherTitle = legend.other
    ? [
        legend.other.distinctTags > 0
          ? `${legend.other.distinctTags} less common tag${legend.other.distinctTags === 1 ? "" : "s"}`
          : null,
        legend.other.hasUntagged ? "untagged pages" : null,
      ]
        .filter(Boolean)
        .join(" + ")
    : "";

  return (
    <div className="graph-legend">
      <span className="graph-legend__title">Tags</span>
      <ul className="graph-legend__list">
        {legend.entries.map((entry) => (
          <li key={entry.tag} className="graph-legend__chip">
            <TagGlyph style={entry.style} />
            <span className="graph-legend__tag">#{entry.tag}</span>
            <span className="graph-legend__count">{entry.count}</span>
          </li>
        ))}
        {legend.other && (
          <li className="graph-legend__chip" title={otherTitle}>
            <TagGlyph style={legend.other.style} />
            <span className="graph-legend__tag">other</span>
            <span className="graph-legend__count">{legend.other.count}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
