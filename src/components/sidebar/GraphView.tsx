// §30 Graph View — interactive link graph visualization
import { useCallback, useEffect, useRef, useState } from "react";

import type { GraphNodeMenuTarget } from "./graph-context-menu";
import type { GraphSimulation } from "./graph-simulation";
import type { Core, EventObject } from "cytoscape";

import { readFile } from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { isGraphTab, useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useGraphSettingsStore } from "../../stores/ui/graph-settings";
import { logger } from "../../utils/logger";
import { MenuList } from "../toolbar/MenuList";
import { buildGraphNodeMenu } from "./graph-context-menu";
import { createGraphSimulation } from "./graph-simulation";
import { buildGraphStyle } from "./graph-style";
import { nodeSize } from "./graph-utils";
import { GraphSettingsPanel } from "./GraphSettingsPanel";
import { useGraphData } from "./use-graph-data";
import { useGraphFilter } from "./use-graph-filter";

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const simRef = useRef<GraphSimulation | null>(null);
  const draggedIdRef = useRef<null | string>(null);
  const [cyReady, setCyReady] = useState(false);
  const rootPath = useFileStore((s) => s.rootPath);
  const graphScope = useGraphSettingsStore((s) => s.graphScope);
  const setGraphScope = useGraphSettingsStore((s) => s.setGraphScope);
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
  const [showSettings, setShowSettings] = useState(false);
  const [frozen, setFrozen] = useState(false);
  // §30.3b Right-click node context menu
  const [nodeMenu, setNodeMenu] = useState<null | {
    target: GraphNodeMenuTarget;
    x: number;
    y: number;
  }>(null);

  // §30.3 Freeze = stop the physics; Re-layout = unfreeze + vigorous reheat
  const handleToggleFreeze = useCallback(() => {
    setFrozen((prev) => {
      const next = !prev;
      simRef.current?.setFrozen(next);
      return next;
    });
  }, []);

  const handleReheat = useCallback(() => {
    setFrozen(false);
    simRef.current?.reheat();
  }, []);

  // Graph settings
  const centerForce = useGraphSettingsStore((s) => s.centerForce);
  const repelForce = useGraphSettingsStore((s) => s.repelForce);
  const linkForce = useGraphSettingsStore((s) => s.linkForce);
  const linkDistance = useGraphSettingsStore((s) => s.linkDistance);
  const settingsNodeSize = useGraphSettingsStore((s) => s.nodeSize);
  const linkThickness = useGraphSettingsStore((s) => s.linkThickness);
  const textFadeThreshold = useGraphSettingsStore((s) => s.textFadeThreshold);
  const showArrows = useGraphSettingsStore((s) => s.showArrows);
  const colorByNamespace = useGraphSettingsStore((s) => s.colorByNamespace);

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

  // Open a file node in an editor tab (activate existing tab if open)
  const openFileInTab = useCallback(async (filePath: string) => {
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

  // Handle node click → open file
  const handleNodeTap = useCallback(
    (evt: EventObject) => {
      const filePath = evt.target.id();
      if (!filePath) return;

      // Don't open ghost or tag nodes
      if (evt.target.data("isGhost") || evt.target.data("isTag")) return;

      void openFileInTab(filePath);
    },
    [openFileInTab],
  );

  // Effect 2: Fetch data + populate cytoscape (extracted hook)
  const { nodeCount, edgeCount, graphEpoch } = useGraphData({
    cyReady,
    cyRef,
    graphScope,
    handleNodeTap,
    simRef,
  });

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

  // Effect: right-click on a node → context menu (§30.3b)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const handleCxtTap = (evt: EventObject) => {
      const node = evt.target;
      const id = node.id() as string;
      const oe = evt.originalEvent as MouseEvent | undefined;
      if (!oe) return;
      setNodeMenu({
        x: oe.clientX,
        y: oe.clientY,
        target: {
          nodeId: id,
          isTag: Boolean(node.data("isTag")),
          isGhost: Boolean(node.data("isGhost")),
          pinned: simRef.current?.isPinned(id) ?? false,
        },
      });
    };

    cy.on("cxttap", "node", handleCxtTap);
    return () => {
      cy.off("cxttap", "node", handleCxtTap);
    };
  }, [cyReady]);

  // §30.3c Pin toggle from the context menu
  const handleTogglePin = useCallback((nodeId: string, pinned: boolean) => {
    const sim = simRef.current;
    const cy = cyRef.current;
    if (!sim || !cy) return;
    if (pinned) {
      sim.unpin(nodeId);
      cy.getElementById(nodeId).removeClass("pinned");
    } else {
      sim.pin(nodeId);
      cy.getElementById(nodeId).addClass("pinned");
    }
  }, []);

  // §30.4a Exclude from graph via context menu
  const handleExclude = useCallback((nodeId: string) => {
    useGraphSettingsStore.getState().excludeNode(nodeId);
  }, []);

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

  // Effect 7: Visibility filters + simulation sync (extracted hook)
  useGraphFilter({
    activeFilePath,
    cyReady,
    cyRef,
    graphEpoch,
    graphScope,
    simRef,
  });

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
        <div className="graph-scope">
          <button
            className={`graph-scope__btn ${graphScope === "current" ? "graph-scope__btn--active" : ""}`}
            onClick={() => setGraphScope("current")}
          >
            Current
          </button>
          {contexts.length > 1 && (
            <button
              className={`graph-scope__btn ${graphScope === "all" ? "graph-scope__btn--active" : ""}`}
              onClick={() => setGraphScope("all")}
            >
              All
            </button>
          )}
          <button
            className={`graph-scope__btn ${graphScope === "local" ? "graph-scope__btn--active" : ""}`}
            disabled={!activeFilePath}
            onClick={() => setGraphScope("local")}
            title="Show only the active file's neighborhood"
          >
            Local
          </button>
        </div>
        <div className="graph-view-header-actions">
          <button
            className="graph-view-settings-btn btn-unstyled"
            onClick={handleToggleFreeze}
            title={frozen ? "Resume physics" : "Freeze layout"}
          >
            <svg fill="currentColor" height="14" viewBox="0 0 16 16" width="14">
              {frozen ? (
                <path d="M5 3.5v9l7-4.5-7-4.5z" />
              ) : (
                <path d="M5 3h2.2v10H5zM8.8 3H11v10H8.8z" />
              )}
            </svg>
          </button>
          <button
            className="graph-view-settings-btn btn-unstyled"
            onClick={handleReheat}
            title="Re-layout"
          >
            <svg fill="currentColor" height="14" viewBox="0 0 16 16" width="14">
              <path d="M8 3a5 5 0 1 0 4.9 4h-1.5A3.6 3.6 0 1 1 8 4.4V7l4-3-4-3v2z" />
            </svg>
          </button>
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
      {nodeMenu && (
        <MenuList
          items={buildGraphNodeMenu(nodeMenu.target, {
            onOpen: (id) => void openFileInTab(id),
            onTogglePin: handleTogglePin,
            onExclude: handleExclude,
          })}
          onClose={() => setNodeMenu(null)}
          x={nodeMenu.x}
          y={nodeMenu.y}
        />
      )}
      <div
        className="graph-view-canvas"
        onContextMenu={(e) => e.preventDefault()}
        ref={containerRef}
      />
    </div>
  );
}
