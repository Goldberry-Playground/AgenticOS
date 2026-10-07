import { shapePolygonPoints, type TagStyle } from "@/lib/vault/tag-styles";

interface TagGlyphProps {
  style: TagStyle;
  /** Rendered box, in px. 12 for legend chips, 14 for the detail card. */
  size?: number;
}

/**
 * The shape half of a tag's category channel, as an inline swatch.
 *
 * Shares its geometry with the canvas nodes via `shapePolygonPoints`, so a
 * legend row and the dots it explains can never drift apart. Decorative:
 * every call site puts the tag name in text next to it.
 */
export function TagGlyph({ style, size = 12 }: TagGlyphProps) {
  const r = size / 2 - 1.1; // leave room for the stroke
  const points = shapePolygonPoints(style.shape, r);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {points ? (
        <polygon
          points={points}
          fill={style.color}
          stroke="var(--text-secondary)"
          strokeWidth="1"
        />
      ) : (
        <circle
          r={r}
          fill={style.color}
          stroke="var(--text-secondary)"
          strokeWidth="1"
        />
      )}
    </svg>
  );
}
