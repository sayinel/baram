// §30 Graph View — link-graph data fetching + cytoscape element population
import type { RefObject } from "react";
import { useEffect, useState } from "react";

import type { LinkGraph } from "../../ipc/types";
import type { GraphScope } from "../../stores/ui/graph-settings";
import type { GraphSimulation } from "./graph-simulation";
import type { Core, ElementDefinition, EventObject } from "cytoscape";

import { getLinkIndex, refreshIndex } from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useGraphSettingsStore } from "../../stores/ui/graph-settings";
import { logger } from "../../utils/logger";
import {
  assignNamespaceColors,
  mergeGraphs,
  nodeSize,
  toGraphElements,
} from "./graph-utils";

/**
 * Fetch the link graph (single- or multi-vault §87), transform it into
 * cytoscape elements, and populate the instance. Re-runs on index refresh.
 * Positions are seeded from the simulation so refreshes don't jump.
 */
export function useGraphData(params: {
  cyReady: boolean;
  cyRef: RefObject<Core | null>;
  graphScope: GraphScope;
  handleNodeTap: (evt: EventObject) => void;
  simRef: RefObject<GraphSimulation | null>;
}): { edgeCount: number; nodeCount: number } {
  const { cyReady, cyRef, graphScope, handleNodeTap, simRef } = params;
  const rootPath = useFileStore((s) => s.rootPath);
  const indexVersion = useLinkStore((s) => s.indexVersion);
  const contexts = useContextStore((s) => s.contexts);
  const settingsNodeSize = useGraphSettingsStore((s) => s.nodeSize);
  const colorByNamespace = useGraphSettingsStore((s) => s.colorByNamespace);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);

  useEffect(() => {
    if (!rootPath) return;
    const cy = cyRef.current;
    if (!cy) return;

    let cancelled = false;

    (async () => {
      try {
        let graph: LinkGraph;
        let effectiveRootPath = rootPath;
        let nodeVaultMapRef: Map<string, string> | undefined;

        // §87 Read contexts fresh from store (not closure) to avoid stale data
        const freshContexts = useContextStore.getState().contexts;
        if (graphScope === "all" && freshContexts.length > 1) {
          // §87 Multi-vault: fetch and merge graphs from all contexts
          const vaultFolderContexts = freshContexts.filter(
            (c) => c.contextType !== "file",
          );
          const graphs: Array<{
            ctx: (typeof vaultFolderContexts)[0];
            graph: LinkGraph;
          }> = [];

          // §87 Fetch existing indices for each vault. Don't call refreshIndex
          // here — it changes indexVersion which re-triggers this effect and
          // cancels before completion. Indices are built when vaults are opened.
          for (const ctx of vaultFolderContexts) {
            try {
              const g = await getLinkIndex(ctx.path);
              if (g.nodes.length > 0) {
                graphs.push({ ctx, graph: g });
              }
            } catch {
              // Skip contexts that fail
            }
          }

          // Merge all graphs into one, tracking node→vault membership
          const merged = mergeGraphs(graphs.map((g) => g.graph));
          graph = merged;
          // §87 Build nodeVaultMap for cross-vault edge detection
          nodeVaultMapRef = new Map<string, string>();
          for (const { ctx, graph: g } of graphs) {
            for (const node of g.nodes) {
              if (!nodeVaultMapRef.has(node)) {
                nodeVaultMapRef.set(node, ctx.id);
              }
            }
          }
          // Use empty string as rootPath so namespace extraction works per-node
          effectiveRootPath = "";
        } else {
          // Single-vault: existing behavior
          await refreshIndex(rootPath);
          if (cancelled) return;
          graph = await getLinkIndex();
          if (cancelled) return;
          nodeVaultMapRef = undefined;
        }

        const { nodes, edges } = toGraphElements(
          graph,
          effectiveRootPath || rootPath,
          nodeVaultMapRef,
        );
        const maxNodeSize = Math.min(settingsNodeSize * 3, 80);

        const nodesWithSize = nodes.map((n) => {
          // §87 In All mode, assign vault color to each node
          let vaultColor: string | undefined;
          if (nodeVaultMapRef) {
            const ctxId = nodeVaultMapRef.get(n.data.id);
            if (ctxId) {
              const ctx = useContextStore
                .getState()
                .contexts.find((c) => c.id === ctxId);
              if (ctx) vaultColor = ctx.color;
            }
          }
          return {
            ...n,
            data: {
              ...n.data,
              size: nodeSize(n.data.degree, settingsNodeSize, maxNodeSize),
              ...(vaultColor && { vaultColor }),
            },
          };
        });

        // §61 Namespace colors
        if (colorByNamespace) {
          const namespaces = nodesWithSize
            .filter((n) => !n.data.isTag)
            .map((n) => n.data.namespace ?? "");
          const nsColorMap = assignNamespaceColors(namespaces);
          for (const n of nodesWithSize) {
            if (!n.data.isTag && !n.data.isGhost) {
              (n.data as Record<string, unknown>).nsColor =
                nsColorMap.get(n.data.namespace ?? "") ?? "";
            }
          }
        }

        // §30.2 Seed added elements with their last known simulation positions
        // so index refreshes don't flash at the origin.
        const posMap = simRef.current?.getPositions();
        cy.elements().remove();
        cy.add([
          ...nodesWithSize.map((n) => {
            const prev = posMap?.get(n.data.id);
            return prev ? { ...n, position: { ...prev } } : n;
          }),
          ...edges,
        ] as ElementDefinition[]);

        // Mark orphan nodes
        cy.nodes().forEach((node) => {
          if (node.degree() === 0) {
            node.addClass("orphan");
          }
        });

        // Ensure container dimensions are available before first paint
        cy.resize();
        // §87 Force style recalculation for newly added nodes
        // (without this, nodes from non-active vaults may not render)
        cy.style().update();

        setNodeCount(nodes.length);
        setEdgeCount(edges.length);

        // Bind click handler
        cy.off("tap", "node");
        cy.on("tap", "node", handleNodeTap);
      } catch (err) {
        logger.error("§30 GraphView: failed to load link graph", err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // settingsNodeSize intentionally omitted: adding it would re-fetch all
    // graph data on every settings tweak; the node-size effect in GraphView
    // handles size updates incrementally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rootPath,
    indexVersion,
    handleNodeTap,
    colorByNamespace,
    cyReady,
    graphScope,
    contexts,
  ]);

  return { edgeCount, nodeCount };
}
