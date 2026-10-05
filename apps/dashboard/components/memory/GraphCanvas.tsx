"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Loader2, Network, X } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useVaultTree } from "@/lib/vault/hooks/use-vault-tree";
import {
  assignTagStyles,
  buildTagLegend,
  shapePolygon,
  styleForTag,
  type TagStyle,
} from "@/lib/vault/tag-styles";
import { GraphLegend } from "./GraphLegend";
import { TagGlyph } from "./TagGlyph";
import type { ForceGraphMethods, ForceGraphProps } from "react-force-graph-2d";
import type { WikiPage } from "@agenticos/vault-core";

/**
 * `next/dynamic` renders its own wrapper component and does not forward a
 * `ref` to the module it loads, so the force-graph imperative handle (which
 * owns `zoomToFit`) is unreachable through `ref=`. Take it through an
 * ordinary prop instead.
 */
type GraphHandleRef = React.MutableRefObject<ForceGraphMethods | undefined>;

const ForceGraph2D = dynamic(
  async () => {
    const { default: ForceGraph } = await import("react-force-graph-2d");
    return function ForceGraph2DWithHandle({
      graphHandleRef,
      ...props
    }: ForceGraphProps & { graphHandleRef?: GraphHandleRef }) {
      return <ForceGraph ref={graphHandleRef} {...props} />;
    };
  },
  { ssr: false }
);

/** The most-linked nodes paint first, so they win the label-collision race. */
const ALWAYS_LABELLED_HUBS = 12;
/** Padding around a label's box when testing it for collisions, in screen px. */
const LABEL_PADDING = 2;
/** Floor on a node's drawn radius in *screen* px, so shapes stay readable zoomed out. */
const MIN_SCREEN_RADIUS = 4;
/** Floor on the click/tap target in screen px (Fitts: a 3px dot is not a target). */
const MIN_SCREEN_HIT_RADIUS = 13;

interface GraphNode {
  id: string;
  label: string;
  primaryTag: string;
  style: TagStyle;
  radius: number;
  /** Among the most-linked nodes — drawn larger and labelled first. */
  hub: boolean;
  backlinkCount: number;
  x?: number;
  y?: number;
}

interface LabelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface GraphLink {
  source: string;
  target: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface GraphCanvasProps {
  onSelectNode: (path: string) => void;
}

async function fetchVaultPage(path: string): Promise<WikiPage | null> {
  const res = await fetch(`/api/vault/page?path=${encodeURIComponent(path)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch vault page: ${res.status}`);
  return res.json() as Promise<WikiPage>;
}

/**
 * Measure an element's content box and keep it current across resizes.
 *
 * `force-graph` falls back to *window* dimensions when it is handed no
 * explicit width/height, so the canvas has to be driven from a real
 * measurement of its own pane — see GOL-2950.
 */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        return prev.width === width && prev.height === height
          ? prev
          : { width, height };
      });
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, ...size };
}

interface CanvasTokens {
  label: string;
  halo: string;
  stroke: string;
  link: string;
  fontFamily: string;
}

const FALLBACK_TOKENS: CanvasTokens = {
  label: "#f0e6cf",
  halo: "#1a1714",
  stroke: "#bdb195",
  link: "#7c725b",
  fontFamily: "system-ui, sans-serif",
};

/**
 * Canvas has no cascade: every colour drawn into it has to be resolved from
 * the design tokens by hand. Without this the labels would be a hardcoded
 * parchment and invisible on the light theme's white surface.
 *
 * Read once per mount. The theme is a class on `<html>` that nothing toggles
 * at runtime today, and this component remounts whenever the Memory view
 * switches back into graph mode, so a live observer would be speculation.
 */
function readCanvasTokens(): CanvasTokens {
  if (typeof document === "undefined") return FALLBACK_TOKENS;
  const root = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    root.getPropertyValue(name).trim() || fallback;
  return {
    label: v("--text", FALLBACK_TOKENS.label),
    halo: v("--surface", FALLBACK_TOKENS.halo),
    stroke: v("--text-secondary", FALLBACK_TOKENS.stroke),
    link: v("--text-muted", FALLBACK_TOKENS.link),
    fontFamily:
      (document.body && getComputedStyle(document.body).fontFamily) ||
      FALLBACK_TOKENS.fontFamily,
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Trace a node's shape at (x, y) with the given radius. Caller fills/strokes. */
function traceShape(
  ctx: CanvasRenderingContext2D,
  node: GraphNode,
  x: number,
  y: number,
  radius: number
) {
  const poly = shapePolygon(node.style.shape);
  ctx.beginPath();
  if (!poly) {
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    return;
  }
  poly.forEach(([px, py], i) => {
    const cx = x + px * radius;
    const cy = y + py * radius;
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  });
  ctx.closePath();
}

function buildGraph(pages: WikiPage[]): GraphData {
  if (pages.length === 0) return { nodes: [], links: [] };

  // Build backlink counts
  const backlinkCounts = new Map<string, number>();
  for (const page of pages) {
    for (const target of page.outgoing) {
      backlinkCounts.set(target, (backlinkCounts.get(target) ?? 0) + 1);
    }
  }

  const assignment = assignTagStyles(pages.map((p) => p.tags[0]));

  // The N most-linked pages keep a label at every zoom level. Ranked by
  // backlinks then path, so the choice is stable for a given vault.
  const hubPaths = new Set(
    pages
      .map((p) => [p.path, backlinkCounts.get(p.path) ?? 0] as const)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, ALWAYS_LABELLED_HUBS)
      .map(([path]) => path)
  );

  // Paint order is label priority: the most-linked page in a crowded cluster
  // should be the one that keeps its name when labels compete for room.
  const nodes: GraphNode[] = pages
    .map((page): GraphNode => {
      const backlinkCount = backlinkCounts.get(page.path) ?? 0;
      const primaryTag = page.tags[0] ?? "";
      return {
        id: page.path,
        label: page.title,
        primaryTag,
        style: styleForTag(primaryTag, assignment),
        radius: 3.5 + Math.log(1 + backlinkCount) * 1.8,
        hub: hubPaths.has(page.path),
        backlinkCount,
      };
    })
    .sort(
      (a, b) => b.backlinkCount - a.backlinkCount || a.id.localeCompare(b.id)
    );

  const pagePathSet = new Set(pages.map((p) => p.path));
  const links: GraphLink[] = [];
  for (const page of pages) {
    for (const target of page.outgoing) {
      if (pagePathSet.has(target)) {
        links.push({ source: page.path, target });
      }
    }
  }

  return { nodes, links };
}

export function GraphCanvas({ onSelectNode }: GraphCanvasProps) {
  const {
    data: treeData,
    isLoading: treeLoading,
    isError: treeError,
  } = useVaultTree();
  const paths = treeData?.flatPaths ?? [];
  const { ref: paneRef, width, height } = useElementSize<HTMLDivElement>();
  const [tokens] = useState(readCanvasTokens);
  const [reducedMotion] = useState(prefersReducedMotion);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  // Node count at the last auto-fit. The graph grows as the 157 page queries
  // land and the simulation restarts each time, so "fit once" would fit the
  // first handful of nodes and never the finished graph.
  const fittedCountRef = useRef(-1);
  // Reset once per frame by `onRenderFramePre`; holds the boxes of the labels
  // already painted in this frame so later ones can avoid overlapping them.
  const labelBoxesRef = useRef<LabelBox[]>([]);

  // `combine` is what keeps the graph stable: `useQueries` hands back a fresh
  // results array on every render, so building the graph in a plain `useMemo`
  // over it would mint a new graphData object each time — and a new graphData
  // makes force-graph drop the simulation's node positions and the user's
  // zoom. React Query memoises the combined value against the query results.
  const { graphData, pagesLoading, pagesError } = useQueries({
    queries: paths.map((path) => ({
      queryKey: ["vault", "page", path],
      queryFn: () => fetchVaultPage(path),
      staleTime: 30_000,
    })),
    combine: (results) => ({
      graphData: buildGraph(
        results.map((r) => r.data).filter((p): p is WikiPage => p != null)
      ),
      pagesLoading: results.some((r) => r.isLoading),
      pagesError: results.some((r) => r.isError),
    }),
  });

  const legend = useMemo(
    () => buildTagLegend(graphData.nodes.map((n) => n.primaryTag)),
    [graphData]
  );

  // A selection that is no longer in the graph simply resolves to null; no
  // effect needed to clear it.
  const selectedNode = useMemo(
    () => graphData.nodes.find((n) => n.id === selectedId) ?? null,
    [graphData, selectedId]
  );

  const paintNode = useCallback(
    (raw: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = raw as GraphNode;
      const { x = 0, y = 0 } = node;
      const radius = Math.max(node.radius, MIN_SCREEN_RADIUS / globalScale);
      const isSelected = node.id === selectedId;

      traceShape(ctx, node, x, y, radius);
      ctx.fillStyle = node.style.color;
      ctx.fill();
      // A 1px rim in the theme's secondary text colour. Since GOL-2989 the
      // fills themselves clear 3:1 on both surfaces, so the rim is no longer
      // the only thing carrying WCAG 1.4.11 — but it still is for the one
      // held-back hue (brand gold, 2.42:1 on white, see GOL-2979) and it is
      // what separates two adjacent nodes of the same category. Keep it.
      ctx.lineWidth = 1.2 / globalScale;
      ctx.strokeStyle = tokens.stroke;
      ctx.stroke();

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 4 / globalScale, 0, Math.PI * 2);
        ctx.lineWidth = 2 / globalScale;
        // Ink, not the brand gold: --gold is 2.42:1 on the light theme's white
        // surface and a selection ring is a state indicator that owes 3:1.
        ctx.strokeStyle = tokens.label;
        ctx.stroke();
      }

      // Font size in graph units = a constant size on screen, so a label is
      // either legible or absent — never 2px tall.
      const fontSize = (isSelected || node.hub ? 11.5 : 10.5) / globalScale;
      ctx.font = `${isSelected ? 600 : 500} ${fontSize}px ${tokens.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const labelY = y + radius + 2.5 / globalScale;

      // Overlapping labels are worse than no label — in the dense clusters
      // they stack into an unreadable smear. Claim a box per label and let
      // the first node to ask have it; zooming in makes room for the rest.
      const pad = LABEL_PADDING / globalScale;
      const halfWidth = ctx.measureText(node.label).width / 2;
      const box: LabelBox = {
        x1: x - halfWidth - pad,
        y1: labelY - pad,
        x2: x + halfWidth + pad,
        y2: labelY + fontSize * 1.15 + pad,
      };
      const boxes = labelBoxesRef.current;
      const collides = boxes.some(
        (b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1
      );
      // The selected node always keeps its name — it is the one the user asked about.
      if (collides && !isSelected) return;
      boxes.push(box);

      // Halo in the surface colour so the label survives crossing a link line.
      ctx.lineWidth = 3 / globalScale;
      ctx.strokeStyle = tokens.halo;
      ctx.lineJoin = "round";
      ctx.strokeText(node.label, x, labelY);
      ctx.fillStyle = tokens.label;
      ctx.fillText(node.label, x, labelY);
    },
    [selectedId, tokens]
  );

  const paintPointerArea = useCallback(
    (
      raw: object,
      color: string,
      ctx: CanvasRenderingContext2D,
      globalScale: number
    ) => {
      const node = raw as GraphNode;
      const { x = 0, y = 0 } = node;
      // Hit area, not paint: give every node a thumb-sized target regardless
      // of how small its shape draws.
      const radius = Math.max(node.radius, MIN_SCREEN_HIT_RADIUS / globalScale);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    },
    []
  );

  const hasNodes = graphData.nodes.length > 0;
  const measuring = width === 0 || height === 0;
  // While the pane is still being measured but data is already in hand, hold
  // the loading state rather than flashing the empty state.
  const isLoading = treeLoading || pagesLoading || (hasNodes && measuring);
  const isError = (treeError || pagesError) && !hasNodes;

  // Settle the simulation before the first paint rather than animating nodes
  // into place. Spread conditionally: handing force-graph an explicit
  // `undefined` would override its own defaults.
  const motionProps = reducedMotion
    ? { warmupTicks: 300, cooldownTicks: 0 }
    : {};

  // The pane is always rendered so that it can be measured before the data
  // lands — the graph only mounts once there is a non-zero box to fill.
  return (
    <div className="memory-graph">
      <div ref={paneRef} className="memory-graph__canvas">
        {hasNodes && !measuring ? (
          <ForceGraph2D
            graphHandleRef={graphRef}
            width={width}
            height={height}
            graphData={graphData}
            nodeRelSize={1}
            nodeLabel={(n) => (n as GraphNode).label}
            nodeCanvasObject={paintNode}
            nodeCanvasObjectMode={() => "replace"}
            nodePointerAreaPaint={paintPointerArea}
            linkColor={() => tokens.link}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
            onRenderFramePre={() => {
              labelBoxesRef.current = [];
            }}
            onEngineStop={() => {
              // Frame the whole graph once the layout settles. Without this
              // the view keeps whatever arbitrary scale the simulation
              // started at, and on a 390px-wide pane most of the vault sits
              // off-canvas.
              const count = graphData.nodes.length;
              if (fittedCountRef.current === count) return;
              fittedCountRef.current = count;
              graphRef.current?.zoomToFit(reducedMotion ? 0 : 400, 28);
            }}
            onNodeClick={(n) => setSelectedId((n as GraphNode).id)}
            onBackgroundClick={() => setSelectedId(null)}
            // force-graph's default is to keep simulating for 15s after the
            // last data change, and the view is only framed once it stops —
            // a quarter-minute of an unframed graph. d3-force has effectively
            // converged well before then at this vault's size.
            cooldownTime={5000}
            backgroundColor="transparent"
            {...motionProps}
          />
        ) : (
          <GraphPlaceholder isLoading={isLoading} isError={isError} />
        )}

        {selectedNode && (
          <SelectedNodeCard
            node={selectedNode}
            onOpen={() => onSelectNode(selectedNode.id)}
            onDismiss={() => setSelectedId(null)}
          />
        )}
      </div>

      {hasNodes && (
        <div className="memory-graph__footer">
          <p className="graph-hint">
            Select a node to name the page before opening it. Zoom in for more
            labels.
          </p>
          <GraphLegend legend={legend} />
        </div>
      )}
    </div>
  );
}

/**
 * What a tap on a node does.
 *
 * `force-graph` only renders `nodeLabel` as a *hover* tooltip, and there is no
 * hover on touch — so the old behaviour was navigating straight to a page you
 * could not identify before tapping it (GOL-2960). Selecting first names the
 * page, its tag and its path, and leaves opening it to a deliberate second
 * action that can also be reached by keyboard.
 */
function SelectedNodeCard({
  node,
  onOpen,
  onDismiss,
}: {
  node: GraphNode;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="graph-selection"
      role="group"
      aria-label="Selected page"
      aria-live="polite"
    >
      <div className="graph-selection__body">
        <p className="graph-selection__title">{node.label}</p>
        <p className="graph-selection__meta">
          <TagGlyph style={node.style} size={11} />
          <span>{node.primaryTag ? `#${node.primaryTag}` : "untagged"}</span>
          <span aria-hidden="true">·</span>
          <span className="graph-selection__path">{node.id}</span>
        </p>
      </div>
      {/* `outline`, not the default variant: --color-primary-foreground
          re-points to a light parchment on the .light theme while
          --color-primary stays brand gold, so a filled primary button reads
          at ~2.2:1 there. Raised separately — see GOL-2980. */}
      <Button
        variant="outline"
        size="sm"
        className="graph-selection__open shrink-0"
        onClick={onOpen}
      >
        Open page
        <ArrowRight size={13} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label="Clear selection"
        onClick={onDismiss}
      >
        <X size={14} aria-hidden="true" />
      </Button>
    </div>
  );
}

function GraphPlaceholder({
  isLoading,
  isError,
}: {
  isLoading: boolean;
  isError: boolean;
}) {
  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <AlertCircle size={20} style={{ color: "var(--error)" }} aria-hidden="true" />
        <p className="text-[14px]" style={{ color: "var(--error)" }}>
          Failed to load the memory graph.
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          The vault pages could not be fetched. Switch back to the reader and
          retry.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2">
        <Loader2
          size={16}
          className="animate-spin"
          style={{ color: "var(--text-muted)" }}
          aria-hidden="true"
        />
        <span className="text-[14px]" style={{ color: "var(--text-muted)" }}>
          Loading graph…
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <Network size={20} strokeWidth={1.5} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
      <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
        Nothing to graph yet.
      </p>
      <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
        The vault has no linked pages to plot.
      </p>
    </div>
  );
}
