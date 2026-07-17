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
import { localSubgraph } from "./graph-utils";

/**
 * Apply visibility filters (workspace/local scope, search, orphans, ghosts,
 * tags, namespace) to cytoscape elements, then sync the visible subgraph
 * into the force simulation with positions preserved by node id. §30.2/§30.3
 *
 * Scope filter: show nodes under the current rootPath + their direct
 * neighbors (1-hop), so a journal workspace shows journal files and the
 * notes they link to. Local scope replaces the path scope with the active
 * file's N-hop BFS neighborhood.
 */
export function useGraphFilter(params: {
  activeFilePath: null | string;
  cyReady: boolean;
  cyRef: RefObject<Core | null>;
  edgeCount: number;
  graphScope: GraphScope;
  nodeCount: number;
  simRef: RefObject<GraphSimulation | null>;
}): void {
  const {
    activeFilePath,
    cyReady,
    cyRef,
    edgeCount,
    graphScope,
    nodeCount,
    simRef,
  } = params;
  const rootPath = useFileStore((s) => s.rootPath);
  const searchQuery = useGraphSettingsStore((s) => s.searchQuery);
  const showOrphans = useGraphSettingsStore((s) => s.showOrphans);
  const existingFilesOnly = useGraphSettingsStore((s) => s.existingFilesOnly);
  const showTags = useGraphSettingsStore((s) => s.showTags);
  const namespaceFilter = useGraphSettingsStore((s) => s.namespaceFilter);
  const localDepth = useGraphSettingsStore((s) => s.localDepth);
  const simSyncedOnceRef = useRef(false);
  const lastSyncKeyRef = useRef<null | string>(null);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0) return;

    // §30.3 Local scope: BFS neighborhood of the active file replaces the
    // workspace path scope entirely.
    let localIds: null | Set<string> = null;
    if (graphScope === "local" && activeFilePath) {
      const allEdges: Array<{ source: string; target: string }> = [];
      cy.edges().forEach((edge) => {
        allEdges.push({
          source: edge.source().id(),
          target: edge.target().id(),
        });
      });
      localIds = localSubgraph(allEdges, activeFilePath, localDepth);
    }

    // Pass 1: find nodes under current workspace rootPath
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

    const scopeNodes = new Set<string>();
    if (scopePaths.length > 0) {
      cy.nodes().forEach((node) => {
        if (scopePaths.some((p) => node.id().startsWith(p))) {
          scopeNodes.add(node.id());
        }
      });
    }

    // Pass 2: include 1-hop neighbors (link targets/sources outside scope)
    const neighborNodes = new Set<string>();
    if (scopePaths.length > 0 && scopeNodes.size > 0) {
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

    // If any scope paths exist, apply scope filter
    const hasScope = scopePaths.length > 0;

    cy.nodes().forEach((node) => {
      const id = node.id();
      const isGhost = node.data("isGhost") as boolean | undefined;
      const isOrphan = node.degree() === 0;

      let visible = true;

      // §30.3 Local scope filter (active file's N-hop neighborhood)
      if (localIds && !localIds.has(id)) {
        visible = false;
      }

      // Workspace scope filter
      if (
        visible &&
        hasScope &&
        !scopeNodes.has(id) &&
        !neighborNodes.has(id)
      ) {
        visible = false;
      }

      // Orphan filter
      if (visible && !showOrphans && isOrphan) {
        visible = false;
      }

      // Existing files only filter
      if (visible && existingFilesOnly && isGhost) {
        visible = false;
      }

      // Tag nodes filter
      const isTag = node.data("isTag") as boolean | undefined;
      if (visible && !showTags && isTag) {
        visible = false;
      }

      // §61 Namespace filter
      if (visible && namespaceFilter) {
        const nodeNs = (node.data("namespace") as string) ?? "";
        if (!nodeNs.toLowerCase().includes(namespaceFilter.toLowerCase())) {
          visible = false;
        }
      }

      node.style("display", visible ? "element" : "none");
    });

    // Hide edges whose source or target is hidden
    cy.edges().forEach((edge) => {
      const src = edge.source();
      const tgt = edge.target();
      if (src.style("display") === "none" || tgt.style("display") === "none") {
        edge.style("display", "none");
      } else {
        edge.style("display", "element");
      }
    });

    // §30.2 Sync visible elements into the simulation (positions preserved
    // by id). First sync warms up synchronously and fits the viewport.
    const sim = simRef.current;
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
      const syncKey = `${visibleNodes
        .map((n) => n.id)
        .sort()
        .join("|")}#${visibleEdges.length}`;
      if (syncKey !== lastSyncKeyRef.current) {
        lastSyncKeyRef.current = syncKey;
        if (!simSyncedOnceRef.current) {
          simSyncedOnceRef.current = true;
          sim.setGraph(visibleNodes, visibleEdges, {
            warmupTicks: 100,
            alpha: 0.3,
          });
          cy.fit(undefined, 30);
        } else {
          sim.setGraph(visibleNodes, visibleEdges, { alpha: 0.3 });
        }
      }
    }

    // §30.3a Search highlights matches instead of filtering — visibility
    // (and therefore the simulation) is unaffected by typing.
    applySearchHighlight(cy, searchQuery);
  }, [
    cyRef,
    simRef,
    rootPath,
    searchQuery,
    showOrphans,
    existingFilesOnly,
    showTags,
    namespaceFilter,
    nodeCount,
    edgeCount,
    graphScope,
    activeFilePath,
    localDepth,
    cyReady,
  ]);
}
