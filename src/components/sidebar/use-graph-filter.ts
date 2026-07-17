// §30 Graph View — visibility filters + simulation sync
import type { RefObject } from "react";
import { useEffect, useRef } from "react";

import type { GraphScope } from "../../stores/ui/graph-settings";
import type {
  GraphSimulation,
  SimLinkInput,
  SimNodeInput,
} from "./graph-simulation";
import type { Core } from "cytoscape";

import { useContextStore } from "../../stores/context/context";
import { useFileStore } from "../../stores/file/file";
import { useGraphSettingsStore } from "../../stores/ui/graph-settings";
import { applySearchHighlight } from "./graph-highlight";
import { localSubgraphDepths } from "./graph-utils";

export interface GraphFilterOptions {
  activeFilePath: null | string;
  excludedPaths: readonly string[];
  existingFilesOnly: boolean;
  graphScope: GraphScope;
  localDepth: number;
  localIncoming: boolean;
  localNeighborLinks: boolean;
  localOutgoing: boolean;
  namespaceFilter: string;
  /** workspace scope roots — empty disables the path scope filter */
  scopePaths: readonly string[];
  searchQuery: string;
  showOrphans: boolean;
  showTags: boolean;
}

/** mutable sync bookkeeping owned by the caller (a ref in the hook) */
export interface GraphFilterSyncState {
  lastSyncKey: null | string;
  syncedOnce: boolean;
}

/**
 * Apply visibility filters (workspace/local scope, orphans, ghosts, tags,
 * namespace, exclusions) to cytoscape elements, then sync the visible
 * subgraph into the force simulation with positions preserved by node id,
 * and finally apply search highlighting. Pure of React — unit-testable
 * against a headless cytoscape instance. §30.2/§30.3
 *
 * Scope filter: show nodes under the given scopePaths + their direct
 * neighbors (1-hop), so a journal workspace shows journal files and the
 * notes they link to. Local scope replaces the path scope with the active
 * file's N-hop BFS neighborhood (§30.3d direction toggles steer the BFS).
 */
export function applyGraphFilter(
  cy: Core,
  sim: GraphSimulation | null,
  opts: GraphFilterOptions,
  syncState: GraphFilterSyncState,
): void {
  if (cy.nodes().length === 0) return;

  let localDepths: Map<string, number> | null = null;
  if (opts.graphScope === "local" && opts.activeFilePath) {
    const allEdges: Array<{ source: string; target: string }> = [];
    cy.edges().forEach((edge) => {
      allEdges.push({
        source: edge.source().id(),
        target: edge.target().id(),
      });
    });
    localDepths = localSubgraphDepths(
      allEdges,
      opts.activeFilePath,
      opts.localDepth,
      { incoming: opts.localIncoming, outgoing: opts.localOutgoing },
    );
  }

  // Pass 1: find nodes under the workspace scope paths
  const scopeNodes = new Set<string>();
  if (opts.scopePaths.length > 0) {
    cy.nodes().forEach((node) => {
      if (opts.scopePaths.some((p) => node.id().startsWith(p))) {
        scopeNodes.add(node.id());
      }
    });
  }

  // Pass 2: include 1-hop neighbors (link targets/sources outside scope)
  const neighborNodes = new Set<string>();
  if (opts.scopePaths.length > 0 && scopeNodes.size > 0) {
    cy.edges().forEach((edge) => {
      const srcId = edge.source().id();
      const tgtId = edge.target().id();
      if (scopeNodes.has(srcId) && !scopeNodes.has(tgtId)) {
        neighborNodes.add(tgtId);
      }
      if (scopeNodes.has(tgtId) && !scopeNodes.has(srcId)) {
        neighborNodes.add(srcId);
      }
    });
  }

  const hasScope = opts.scopePaths.length > 0;
  // §30.4a Context-menu exclusions
  const excluded = new Set(opts.excludedPaths);

  cy.nodes().forEach((node) => {
    const id = node.id();
    const isGhost = node.data("isGhost") as boolean | undefined;
    const isOrphan = node.degree() === 0;

    let visible = true;

    // §30.4a Excluded via context menu
    if (excluded.has(id)) {
      visible = false;
    }

    // §30.3 Local scope filter (active file's N-hop neighborhood)
    if (visible && localDepths && !localDepths.has(id)) {
      visible = false;
    }

    // Workspace scope filter
    if (visible && hasScope && !scopeNodes.has(id) && !neighborNodes.has(id)) {
      visible = false;
    }

    // Orphan filter
    if (visible && !opts.showOrphans && isOrphan) {
      visible = false;
    }

    // Existing files only filter
    if (visible && opts.existingFilesOnly && isGhost) {
      visible = false;
    }

    // Tag nodes filter
    const isTag = node.data("isTag") as boolean | undefined;
    if (visible && !opts.showTags && isTag) {
      visible = false;
    }

    // §61 Namespace filter
    if (visible && opts.namespaceFilter) {
      const nodeNs = (node.data("namespace") as string) ?? "";
      if (!nodeNs.toLowerCase().includes(opts.namespaceFilter.toLowerCase())) {
        visible = false;
      }
    }

    node.style("display", visible ? "element" : "none");
  });

  // Hide edges whose source or target is hidden.
  // §30.3e With neighbor-links off, also hide edges between two nodes at
  // the same BFS depth (links among neighbors); consecutive-depth edges
  // stay so the local tree skeleton never breaks apart.
  cy.edges().forEach((edge) => {
    const src = edge.source();
    const tgt = edge.target();
    let edgeVisible =
      src.style("display") !== "none" && tgt.style("display") !== "none";

    if (edgeVisible && localDepths && !opts.localNeighborLinks) {
      const srcDepth = localDepths.get(src.id());
      const tgtDepth = localDepths.get(tgt.id());
      if (srcDepth !== undefined && srcDepth === tgtDepth) {
        edgeVisible = false;
      }
    }

    edge.style("display", edgeVisible ? "element" : "none");
  });

  // §30.2 Sync visible elements into the simulation (positions preserved
  // by id). First sync warms up synchronously and fits the viewport.
  if (sim) {
    const visibleNodes: SimNodeInput[] = [];
    cy.nodes().forEach((node) => {
      if (node.style("display") === "none") return;
      visibleNodes.push({
        id: node.id(),
        radius: ((node.data("size") as number) ?? 20) / 2,
      });
    });
    const visibleEdges: SimLinkInput[] = [];
    cy.edges().forEach((edge) => {
      if (edge.style("display") === "none") return;
      visibleEdges.push({
        source: edge.source().id(),
        target: edge.target().id(),
      });
    });
    // Identity-based key: edge COUNT alone can stay equal while the edge
    // set changed (link edits, renames) — that must still resync the sim,
    // otherwise stale springs act on removed links and new elements are
    // never simulated (they pile up unmoved and overlap).
    const syncKey = `${visibleNodes
      .map((n) => n.id)
      .sort()
      .join("|")}#${visibleEdges
      .map((e) => `${e.source}>${e.target}`)
      .sort()
      .join(",")}`;
    if (syncKey !== syncState.lastSyncKey) {
      syncState.lastSyncKey = syncKey;
      if (!syncState.syncedOnce) {
        syncState.syncedOnce = true;
        sim.setGraph(visibleNodes, visibleEdges, {
          warmupTicks: 100,
          alpha: 0.3,
        });
        cy.fit(undefined, 30);
      } else {
        // 0.6: re-adding springs must CONTRACT an expanded layout against
        // charge+collide resistance — a gentle 0.3 reheat visibly failed
        // to restore the shape after re-enabling neighbor links.
        sim.setGraph(visibleNodes, visibleEdges, { alpha: 0.6 });
      }
    }
  }

  // §30.3a Search highlights matches instead of filtering — visibility
  // (and therefore the simulation) is unaffected by typing.
  applySearchHighlight(cy, opts.searchQuery);
}

/**
 * React wrapper: reads filter settings from the stores and re-applies
 * `applyGraphFilter` whenever any of them — or the graph contents
 * (`graphEpoch`) — change.
 */
export function useGraphFilter(params: {
  activeFilePath: null | string;
  cyReady: boolean;
  cyRef: RefObject<Core | null>;
  /** bumped by useGraphData on every populate — re-applies filters even
   * when node/edge counts are unchanged (element bypasses were reset) */
  graphEpoch: number;
  graphScope: GraphScope;
  simRef: RefObject<GraphSimulation | null>;
}): void {
  const { activeFilePath, cyReady, cyRef, graphEpoch, graphScope, simRef } =
    params;
  const rootPath = useFileStore((s) => s.rootPath);
  const searchQuery = useGraphSettingsStore((s) => s.searchQuery);
  const showOrphans = useGraphSettingsStore((s) => s.showOrphans);
  const existingFilesOnly = useGraphSettingsStore((s) => s.existingFilesOnly);
  const showTags = useGraphSettingsStore((s) => s.showTags);
  const namespaceFilter = useGraphSettingsStore((s) => s.namespaceFilter);
  const localDepth = useGraphSettingsStore((s) => s.localDepth);
  const localIncoming = useGraphSettingsStore((s) => s.localIncoming);
  const localOutgoing = useGraphSettingsStore((s) => s.localOutgoing);
  const localNeighborLinks = useGraphSettingsStore((s) => s.localNeighborLinks);
  const excludedPaths = useGraphSettingsStore((s) => s.excludedPaths);
  const syncStateRef = useRef<GraphFilterSyncState>({
    lastSyncKey: null,
    syncedOnce: false,
  });

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // §87 In All mode, include all vault paths (not just active rootPath)
    const scopePaths =
      graphScope === "local"
        ? []
        : graphScope === "all"
          ? useContextStore
              .getState()
              .contexts.filter((c) => c.contextType !== "file")
              .map((c) => c.path)
          : rootPath
            ? [rootPath]
            : [];

    applyGraphFilter(
      cy,
      simRef.current,
      {
        activeFilePath,
        excludedPaths,
        existingFilesOnly,
        graphScope,
        localDepth,
        localIncoming,
        localNeighborLinks,
        localOutgoing,
        namespaceFilter,
        scopePaths,
        searchQuery,
        showOrphans,
        showTags,
      },
      syncStateRef.current,
    );
  }, [
    cyRef,
    simRef,
    rootPath,
    searchQuery,
    showOrphans,
    existingFilesOnly,
    showTags,
    namespaceFilter,
    graphEpoch,
    graphScope,
    activeFilePath,
    localDepth,
    localIncoming,
    localOutgoing,
    localNeighborLinks,
    excludedPaths,
    cyReady,
  ]);
}
