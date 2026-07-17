// §30 Graph View — interactive link graph visualization
import { useCallback, useEffect, useRef, useState } from "react";

import type { LinkGraph } from "../../ipc/types";
import type {
  GraphSimulation,
  SimLinkInput,
  SimNodeInput,
} from "./graph-simulation";
import type { Core, EventObject } from "cytoscape";

import { getLinkIndex, readFile, refreshIndex } from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { isGraphTab, useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useGraphSettingsStore } from "../../stores/ui/graph-settings";
import { logger } from "../../utils/logger";
import { createGraphSimulation } from "./graph-simulation";
import { buildGraphStyle } from "./graph-style";
import {
  assignNamespaceColors,
  matchesFilter,
  mergeGraphs,
  nodeSize,
  toGraphElements,
} from "./graph-utils";
import { GraphSettingsPanel } from "./GraphSettingsPanel";

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const simRef = useRef<GraphSimulation | null>(null);
  const draggedIdRef = useRef<null | string>(null);
  const simSyncedOnceRef = useRef(false);
  const lastSyncKeyRef = useRef<null | string>(null);
  const [cyReady, setCyReady] = useState(false);
  const rootPath = useFileStore((s) => s.rootPath);
  const [graphScope, setGraphScope] = useState<"all" | "current">("current");
  const contexts = useContextStore((s) => s.contexts);
  // Detect if rendered inside editor tab (vs sidebar)
  const isInEditorTab = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return isGraphTab(tab);
  });
  const activeFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (tab?.filePath) return tab.filePath;
    if (isGraphTab(tab)) {
      for (const mruId of s.mruOrder) {
        const mruTab = s.tabs.find((t) => t.id === mruId);
        if (mruTab?.filePath) return mruTab.filePath;
      }
    }
    return null;
  });
  const indexVersion = useLinkStore((s) => s.indexVersion);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  // Graph settings
  const centerForce = useGraphSettingsStore((s) => s.centerForce);
  const repelForce = useGraphSettingsStore((s) => s.repelForce);
  const linkForce = useGraphSettingsStore((s) => s.linkForce);
  const linkDistance = useGraphSettingsStore((s) => s.linkDistance);
  const settingsNodeSize = useGraphSettingsStore((s) => s.nodeSize);
  const linkThickness = useGraphSettingsStore((s) => s.linkThickness);
  const textFadeThreshold = useGraphSettingsStore((s) => s.textFadeThreshold);
  const showArrows = useGraphSettingsStore((s) => s.showArrows);
  const searchQuery = useGraphSettingsStore((s) => s.searchQuery);
  const showOrphans = useGraphSettingsStore((s) => s.showOrphans);
  const existingFilesOnly = useGraphSettingsStore((s) => s.existingFilesOnly);
  const showTags = useGraphSettingsStore((s) => s.showTags);
  const colorByNamespace = useGraphSettingsStore((s) => s.colorByNamespace);
  const namespaceFilter = useGraphSettingsStore((s) => s.namespaceFilter);

  const handleOpenInTab = useCallback(() => {
    useEditorStore.getState().openGraphTab();
  }, []);

  // Effect 1: Create Cytoscape instance (lazy-loaded to keep it out of the initial bundle)
  useEffect(() => {
    if (!containerRef.current) return;

    let cy: Core | null = null;
    let destroyed = false;

    (async () => {
      const { default: cytoscape } = await import("cytoscape");

      if (destroyed || !containerRef.current) return;

      cy = cytoscape({
        container: containerRef.current,
        style: buildGraphStyle({ linkThickness, showArrows, colorByNamespace }),
        layout: { name: "preset" },
        minZoom: 0.1,
        maxZoom: 5,
        wheelSensitivity: 0.3,
      });

      cyRef.current = cy;

      // §30.2 Continuous d3-force simulation drives node positions each tick
      const { centerForce, repelForce, linkForce, linkDistance } =
        useGraphSettingsStore.getState();
      simRef.current = createGraphSimulation(
        { centerForce, repelForce, linkForce, linkDistance },
        (simNodes) => {
          const inst = cyRef.current;
          if (!inst) return;
          inst.batch(() => {
            for (const n of simNodes) {
              // The grabbed node is moved natively by cytoscape
              if (n.id === draggedIdRef.current) continue;
              const el = inst.getElementById(n.id);
              if (el.length > 0) el.position({ x: n.x ?? 0, y: n.y ?? 0 });
            }
          });
        },
      );
      setCyReady(true);
    })();

    return () => {
      destroyed = true;
      simRef.current?.stop();
      simRef.current = null;
      if (cy) {
        cy.destroy();
      }
      cyRef.current = null;
      setCyReady(false);
    };
    // Intentionally mount-only: creates the Cytoscape instance once. Style
    // settings (linkThickness, showArrows, colorByNamespace) passed here are only
    // for the initial render; subsequent changes are applied by dedicated effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle node click → open file
  const handleNodeTap = useCallback(async (evt: EventObject) => {
    const filePath = evt.target.id();
    if (!filePath) return;

    // Don't open ghost or tag nodes
    if (evt.target.data("isGhost") || evt.target.data("isTag")) return;

    const { tabs, setActiveTab, openTab } = useEditorStore.getState();

    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

    try {
      const content = await readFile(filePath);
      useFileStore.getState().setFileContent(filePath, content);
      const fileName = filePath.split("/").pop() ?? filePath;
      openTab({
        contextId: "",
        id: crypto.randomUUID(),
        filePath,
        title: fileName,
        isDirty: false,
        isPinned: false,
      });
    } catch (err) {
      logger.error("§30 GraphView: failed to open file", err);
    }
  }, []);

  // Effect 2: Fetch data + initial layout
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
        ] as cytoscape.ElementDefinition[]);

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
    // settingsNodeSize/centerForce/repelForce/linkForce/linkDistance intentionally
    // omitted: adding them would re-fetch all graph data on every settings tweak,
    // but dedicated effects (Effect 3, node-size effect) handle those updates.
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

  // Effect 3: Apply force settings to the simulation (gentle reheat)
  useEffect(() => {
    simRef.current?.updateForces({
      centerForce,
      repelForce,
      linkForce,
      linkDistance,
    });
  }, [centerForce, repelForce, linkForce, linkDistance]);

  // Effect 4: Drag → pin node in the simulation and reheat so linked
  // neighbors follow and the whole graph re-settles (Logseq-style). §30.2
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const handleGrab = (evt: EventObject) => {
      const id = evt.target.id() as string;
      draggedIdRef.current = id;
      simRef.current?.startDrag(id);
    };
    const handleDrag = (evt: EventObject) => {
      const pos = evt.target.position();
      simRef.current?.drag(evt.target.id() as string, pos.x, pos.y);
    };
    const handleFree = (evt: EventObject) => {
      draggedIdRef.current = null;
      simRef.current?.endDrag(evt.target.id() as string);
    };

    cy.on("grab", "node", handleGrab);
    cy.on("drag", "node", handleDrag);
    cy.on("free", "node", handleFree);
    return () => {
      cy.off("grab", "node", handleGrab);
      cy.off("drag", "node", handleDrag);
      cy.off("free", "node", handleFree);
    };
  }, [cyReady]);

  // Effect 5: Hover highlight events
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const handleMouseOver = (evt: EventObject) => {
      const node = evt.target;
      if (!node.isNode()) return;

      // Add .faded to all
      cy.elements().addClass("faded");

      // Remove .faded from hovered + neighbors
      const neighborhood = node.neighborhood();
      node.removeClass("faded").addClass("hover");
      neighborhood.nodes().removeClass("faded").addClass("hover-neighbor");
      neighborhood.edges().removeClass("faded").addClass("hover-edge");
      node.connectedEdges().removeClass("faded").addClass("hover-edge");
    };

    const handleMouseOut = () => {
      cy.elements().removeClass("faded hover hover-neighbor hover-edge");
    };

    cy.on("mouseover", "node", handleMouseOver);
    cy.on("mouseout", "node", handleMouseOut);

    return () => {
      cy.off("mouseover", "node", handleMouseOver);
      cy.off("mouseout", "node", handleMouseOut);
    };
  }, [cyReady]);

  // Effect 6: Highlight active file node
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.nodes().removeClass("active neighbor");
    cy.edges().removeClass("highlighted");

    if (!activeFilePath) return;

    const activeNode = cy.getElementById(activeFilePath);
    if (activeNode.empty()) return;

    activeNode.addClass("active");

    const neighborhood = activeNode.neighborhood();
    neighborhood.nodes().addClass("neighbor");
    neighborhood.edges().addClass("highlighted");
    activeNode.connectedEdges().addClass("highlighted");

    cy.animate({
      center: { eles: activeNode },
      duration: 300,
    });
  }, [activeFilePath, nodeCount]);

  // Effect 7: Filter logic (rootPath scope, search, orphans, existingFilesOnly)
  // Scope filter: show nodes under current rootPath + their direct neighbors (1-hop),
  // so journal workspace shows journal files and the notes they link to.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0) return;

    // Pass 1: find nodes under current workspace rootPath
    // §87 In All mode, include all vault paths (not just active rootPath)
    const scopePaths =
      graphScope === "all"
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
      const label = node.data("label") as string;
      const isGhost = node.data("isGhost") as boolean | undefined;
      const isOrphan = node.degree() === 0;

      let visible = true;

      // Workspace scope filter
      if (hasScope && !scopeNodes.has(id) && !neighborNodes.has(id)) {
        visible = false;
      }

      // Search filter
      if (visible && !matchesFilter(label, searchQuery)) {
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
  }, [
    rootPath,
    searchQuery,
    showOrphans,
    existingFilesOnly,
    showTags,
    namespaceFilter,
    nodeCount,
    edgeCount,
    graphScope,
    cyReady,
  ]);

  // Effect: Update styles when display settings change
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.style()
      .fromJson(
        buildGraphStyle({ linkThickness, showArrows, colorByNamespace }),
      )
      .update();
  }, [linkThickness, showArrows, colorByNamespace]);

  // Effect: Update node sizes when nodeSize setting changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0) return;

    const maxSize = Math.min(settingsNodeSize * 3, 80);
    cy.nodes().forEach((node) => {
      const degree = node.data("degree") as number;
      node.data("size", nodeSize(degree, settingsNodeSize, maxSize));
    });

    // §30.2 Keep collide radii in sync with rendered node sizes
    const radii = new Map<string, number>();
    cy.nodes().forEach((node) => {
      radii.set(node.id(), (node.data("size") as number) / 2);
    });
    simRef.current?.updateRadii(radii);
  }, [settingsNodeSize]);

  // Effect: Zoom label fade
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const handleZoom = () => {
      const zoom = cy.zoom();
      if (zoom < textFadeThreshold) {
        cy.nodes().addClass("labels-hidden");
      } else {
        cy.nodes().removeClass("labels-hidden");
      }
    };

    // Apply immediately
    handleZoom();

    cy.on("zoom", handleZoom);
    return () => {
      cy.off("zoom", handleZoom);
    };
  }, [textFadeThreshold, cyReady]);

  if (!rootPath) {
    return (
      <div className="graph-view-empty">
        <p>Open a folder to view the link graph.</p>
      </div>
    );
  }

  return (
    <div className="graph-view-container">
      <div className="graph-view-header">
        <span className="graph-view-title">Graph View</span>
        <span className="graph-view-stats">
          {nodeCount} nodes, {edgeCount} edges
        </span>
        {contexts.length > 1 && (
          <div className="graph-scope">
            <button
              className={`graph-scope__btn ${graphScope === "current" ? "graph-scope__btn--active" : ""}`}
              onClick={() => setGraphScope("current")}
            >
              Current
            </button>
            <button
              className={`graph-scope__btn ${graphScope === "all" ? "graph-scope__btn--active" : ""}`}
              onClick={() => setGraphScope("all")}
            >
              All
            </button>
          </div>
        )}
        <div className="graph-view-header-actions">
          <button
            className="graph-view-settings-btn btn-unstyled"
            onClick={() => setShowSettings((v) => !v)}
            title="Graph settings"
          >
            <svg fill="currentColor" height="14" viewBox="0 0 16 16" width="14">
              <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
            </svg>
          </button>
          {!isInEditorTab && (
            <button
              className="graph-view-expand-btn btn-unstyled"
              onClick={handleOpenInTab}
              title="Open in editor tab"
            >
              <svg
                fill="currentColor"
                height="14"
                viewBox="0 0 16 16"
                width="14"
              >
                <path d="M2 1h5v1H3v4H2V1zm12 0h-5v1h4v4h1V1zM2 15h5v-1H3v-4H2v5zm12 0h-5v-1h4v-4h1v5z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {showSettings && <GraphSettingsPanel />}
      <div className="graph-view-canvas" ref={containerRef} />
    </div>
  );
}
