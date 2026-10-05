"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Network } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { useVaultTree } from "@/lib/vault/hooks/use-vault-tree";
import { colorForTag } from "@/lib/vault/tag-colors";
import type { WikiPage } from "@agenticos/vault-core";

const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((mod) => mod.default),
  { ssr: false }
);

interface GraphNode {
  id: string;
  label: string;
  primaryTag: string;
  color: string;
  size: number;
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

export function GraphCanvas({ onSelectNode }: GraphCanvasProps) {
  const {
    data: treeData,
    isLoading: treeLoading,
    isError: treeError,
  } = useVaultTree();
  const paths = treeData?.flatPaths ?? [];
  const { ref: paneRef, width, height } = useElementSize<HTMLDivElement>();

  const pageQueries = useQueries({
    queries: paths.map((path) => ({
      queryKey: ["vault", "page", path],
      queryFn: () => fetchVaultPage(path),
      staleTime: 30_000,
    })),
  });

  const pagesLoading = pageQueries.some((q) => q.isLoading);
  const pagesError = pageQueries.some((q) => q.isError);

  const graphData = useMemo<GraphData>(() => {
    const pages = pageQueries
      .map((q) => q.data)
      .filter((p): p is WikiPage => p != null);

    if (pages.length === 0) return { nodes: [], links: [] };

    // Build backlink counts
    const backlinkCounts = new Map<string, number>();
    for (const page of pages) {
      for (const target of page.outgoing) {
        backlinkCounts.set(target, (backlinkCounts.get(target) ?? 0) + 1);
      }
    }

    const nodes: GraphNode[] = pages.map((page) => {
      const backlinkCount = backlinkCounts.get(page.path) ?? 0;
      const primaryTag = page.tags[0];
      return {
        id: page.path,
        label: page.title,
        primaryTag: primaryTag ?? "",
        color: colorForTag(primaryTag),
        size: 4 + Math.log(1 + backlinkCount) * 3,
      };
    });

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
  }, [pageQueries]);

  const hasNodes = graphData.nodes.length > 0;
  const measuring = width === 0 || height === 0;
  // While the pane is still being measured but data is already in hand, hold
  // the loading state rather than flashing the empty state.
  const isLoading = treeLoading || pagesLoading || (hasNodes && measuring);
  const isError = (treeError || pagesError) && !hasNodes;

  // The pane is always rendered so that it can be measured before the data
  // lands — the graph only mounts once there is a non-zero box to fill.
  return (
    <div ref={paneRef} className="relative flex flex-1 overflow-hidden">
      {hasNodes && !measuring ? (
        <ForceGraph2D
          width={width}
          height={height}
          graphData={graphData}
          nodeRelSize={1}
          nodeVal={(n) => (n as GraphNode).size}
          nodeColor={(n) => (n as GraphNode).color}
          nodeLabel={(n) => (n as GraphNode).label}
          linkColor={() => "rgba(176, 168, 158, 0.35)"}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          onNodeClick={(n) => onSelectNode((n as GraphNode).id)}
          backgroundColor="transparent"
        />
      ) : (
        <GraphPlaceholder isLoading={isLoading} isError={isError} />
      )}
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
