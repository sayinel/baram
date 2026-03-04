// §30 Graph View — interactive link graph visualization
import { useEffect, useRef, useCallback, useState } from "react";
import cytoscape from "cytoscape";
import type { Core, EventObject, StylesheetStyle } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useFileStore } from "../../stores/file-store";
import { useEditorStore, isGraphTab } from "../../stores/editor-store";
import { useLinkStore } from "../../stores/link-store";
import { useGraphSettingsStore } from "../../stores/graph-settings-store";
import { getLinkIndex, refreshIndex, readFile } from "../../ipc/invoke";
import { toGraphElements, nodeSize, matchesFilter } from "./graph-utils";
import { GraphSettingsPanel } from "./GraphSettingsPanel";

// Register fcose layout
cytoscape.use(fcose);

/** Build fcose layout options from settings */
function buildLayoutOptions(
  settings: { centerForce: number; repelForce: number; linkForce: number; linkDistance: number },
  opts?: { randomize?: boolean; animate?: boolean; fit?: boolean; fixedNodeConstraint?: unknown[] },
) {
  return {
    name: "fcose" as const,
    randomize: opts?.randomize ?? true,
    animate: opts?.animate ?? false,
    animationDuration: 250,
    fit: opts?.fit ?? true,
    padding: 30,
    nodeRepulsion: () => settings.repelForce * 1000,
    idealEdgeLength: () => settings.linkDistance,
    edgeElasticity: () => settings.linkForce * 200,
    gravity: settings.centerForce,
    numIter: 500,
    fixedNodeConstraint: opts?.fixedNodeConstraint,
  };
}

/** Build dynamic Cytoscape stylesheet from settings */
function buildGraphStyle(settings: {
  linkThickness: number;
  showArrows: boolean;
}): StylesheetStyle[] {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": 10,
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-max-width": "80px",
        "text-wrap": "ellipsis",
        "background-color": "var(--graph-node-color, #6b7280)",
        width: "data(size)",
        height: "data(size)",
        color: "var(--graph-label-color, #d1d5db)",
        "transition-property": "opacity, border-width, border-color, background-color",
        "transition-duration": 150,
      } as cytoscape.Css.Node,
    },
    {
      selector: "node:selected",
      style: {
        "background-color": "var(--graph-active-color, #3b82f6)",
        "border-width": 2,
        "border-color": "var(--graph-active-border, #60a5fa)",
        "background-blacken": 0,
      } as cytoscape.Css.Node,
    },
    {
      selector: "node.active",
      style: {
        "background-color": "var(--graph-active-color, #3b82f6)",
        "border-width": 2,
        "border-color": "var(--graph-active-border, #60a5fa)",
      },
    },
    {
      selector: "node.neighbor",
      style: {
        "background-color": "var(--graph-neighbor-color, #8b5cf6)",
      },
    },
    {
      selector: "node.orphan",
      style: {
        "background-color": "var(--graph-orphan-color, #4b5563)",
        opacity: 0.6,
      },
    },
    {
      selector: "node[?isGhost]",
      style: {
        "background-color": "transparent",
        "border-width": 1.5,
        "border-color": "var(--graph-node-color, #6b7280)",
        "border-style": "dashed" as never,
      },
    },
    {
      selector: "node[?isTag]",
      style: {
        shape: "diamond",
        "background-color": "var(--graph-tag-color, #f59e0b)",
        "font-size": 9,
        "text-valign": "bottom",
        "text-margin-y": 6,
      } as cytoscape.Css.Node,
    },
    {
      selector: "edge",
      style: {
        width: settings.linkThickness,
        "line-color": "var(--graph-edge-color, #374151)",
        "curve-style": "bezier",
        "target-arrow-shape": settings.showArrows ? "triangle" : "none",
        "target-arrow-color": "var(--graph-edge-color, #374151)",
        "arrow-scale": 0.6,
        opacity: 0.5,
        "transition-property": "opacity, line-color, width",
        "transition-duration": 150,
      } as cytoscape.Css.Edge,
    },
    {
      selector: "edge.highlighted",
      style: {
        "line-color": "var(--graph-active-color, #3b82f6)",
        "target-arrow-color": "var(--graph-active-color, #3b82f6)",
        opacity: 1,
        width: Math.max(settings.linkThickness * 2, 2),
      },
    },
    // Hover effects
    {
      selector: "node.faded",
      style: {
        opacity: 0.15,
      },
    },
    {
      selector: "edge.faded",
      style: {
        opacity: 0.08,
      },
    },
    {
      selector: "node.hover",
      style: {
        "border-width": 2,
        "border-color": "var(--graph-active-border, #60a5fa)",
        "z-index": 10,
      },
    },
    {
      selector: "node.hover-neighbor",
      style: {
        opacity: 1,
        "border-width": 1,
        "border-color": "var(--graph-neighbor-color, #8b5cf6)",
      },
    },
    {
      selector: "edge.hover-edge",
      style: {
        opacity: 0.8,
        "line-color": "var(--graph-active-color, #3b82f6)",
        "target-arrow-color": "var(--graph-active-color, #3b82f6)",
        width: Math.max(settings.linkThickness * 1.5, 1.5),
      },
    },
    // Zoom label fade
    {
      selector: "node.labels-hidden",
      style: {
        "text-opacity": 0,
      },
    },
  ];
}

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const rootPath = useFileStore((s) => s.rootPath);
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

  const handleOpenInTab = useCallback(() => {
    useEditorStore.getState().openGraphTab();
  }, []);

  // Effect 1: Create Cytoscape instance
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: buildGraphStyle({ linkThickness, showArrows }),
      layout: { name: "grid" },
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle node click → open file
  const handleNodeTap = useCallback(
    async (evt: EventObject) => {
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
          id: crypto.randomUUID(),
          filePath,
          title: fileName,
          isDirty: false,
          isPinned: false,
        });
      } catch (err) {
        console.error("§30 GraphView: failed to open file", err);
      }
    },
    [],
  );

  // Effect 2: Fetch data + initial layout
  useEffect(() => {
    if (!rootPath) return;
    const cy = cyRef.current;
    if (!cy) return;

    let cancelled = false;

    (async () => {
      try {
        // Ensure index matches current workspace before fetching graph
        await refreshIndex(rootPath);
        if (cancelled) return;
        const graph = await getLinkIndex();
        if (cancelled) return;

        const { nodes, edges } = toGraphElements(graph);
        const maxNodeSize = Math.min(settingsNodeSize * 3, 80);

        const nodesWithSize = nodes.map((n) => ({
          ...n,
          data: {
            ...n.data,
            size: nodeSize(n.data.degree, settingsNodeSize, maxNodeSize),
          },
        }));

        cy.elements().remove();
        cy.add([...nodesWithSize, ...edges] as cytoscape.ElementDefinition[]);

        // Mark orphan nodes
        cy.nodes().forEach((node) => {
          if (node.degree() === 0) {
            node.addClass("orphan");
          }
        });

        // Ensure container dimensions are available before layout
        cy.resize();

        // Run initial fcose layout
        cy.layout(
          buildLayoutOptions(
            { centerForce, repelForce, linkForce, linkDistance },
            { randomize: true, animate: false, fit: true },
          ),
        ).run();

        setNodeCount(nodes.length);
        setEdgeCount(edges.length);

        // Bind click handler
        cy.off("tap", "node");
        cy.on("tap", "node", handleNodeTap);
      } catch (err) {
        console.error("§30 GraphView: failed to load link graph", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, indexVersion, handleNodeTap]);

  // Effect 3: Re-layout on force settings change
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0) return;

    cy.layout(
      buildLayoutOptions(
        { centerForce, repelForce, linkForce, linkDistance },
        { randomize: false, animate: true, fit: false },
      ),
    ).run();
  }, [centerForce, repelForce, linkForce, linkDistance]);

  // Effect 4: Real-time spring physics during drag + settle on release
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const SPRING_K = 0.06; // spring constant — how strongly neighbors follow
    const DAMPING = 0.5;   // reduce overshoot

    const handleDrag = (evt: EventObject) => {
      const node = evt.target;
      const pos = node.position();
      const neighbors = node.neighborhood().nodes();

      neighbors.forEach((neighbor: cytoscape.NodeSingular) => {
        if (neighbor.grabbed()) return;
        const nPos = neighbor.position();
        const dx = pos.x - nPos.x;
        const dy = pos.y - nPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;

        const idealDist = linkDistance;
        const displacement = dist - idealDist;
        const force = displacement * SPRING_K * DAMPING;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        neighbor.position({
          x: nPos.x + fx,
          y: nPos.y + fy,
        });
      });
    };

    const handleFree = (evt: EventObject) => {
      const node = evt.target;
      const pos = node.position();
      cy.layout(
        buildLayoutOptions(
          { centerForce, repelForce, linkForce, linkDistance },
          {
            randomize: false,
            animate: true,
            fit: false,
            fixedNodeConstraint: [{ nodeId: node.id(), position: pos }],
          },
        ),
      ).run();
    };

    cy.on("drag", "node", handleDrag);
    cy.on("free", "node", handleFree);
    return () => {
      cy.off("drag", "node", handleDrag);
      cy.off("free", "node", handleFree);
    };
  }, [centerForce, repelForce, linkForce, linkDistance]);

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
  }, []);

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
    const scopeNodes = new Set<string>();
    if (rootPath) {
      cy.nodes().forEach((node) => {
        if (node.id().startsWith(rootPath)) {
          scopeNodes.add(node.id());
        }
      });
    }

    // Pass 2: include 1-hop neighbors (link targets/sources outside rootPath)
    const neighborNodes = new Set<string>();
    if (rootPath && scopeNodes.size > 0) {
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

    // If rootPath is set, always apply scope filter (even if no nodes match)
    const hasScope = !!rootPath;

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
  }, [rootPath, searchQuery, showOrphans, existingFilesOnly, showTags, nodeCount]);

  // Effect: Update styles when display settings change
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.style().fromJson(buildGraphStyle({ linkThickness, showArrows })).update();
  }, [linkThickness, showArrows]);

  // Effect: Update node sizes when nodeSize setting changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.nodes().length === 0) return;

    const maxSize = Math.min(settingsNodeSize * 3, 80);
    cy.nodes().forEach((node) => {
      const degree = node.data("degree") as number;
      node.data("size", nodeSize(degree, settingsNodeSize, maxSize));
    });
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
  }, [textFadeThreshold]);

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
        <div className="graph-view-header-actions">
          <button
            className="graph-view-settings-btn"
            onClick={() => setShowSettings((v) => !v)}
            title="Graph settings"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z" />
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 001.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 003.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.115l.094-.319z" />
            </svg>
          </button>
          {!isInEditorTab && (
            <button
              className="graph-view-expand-btn"
              onClick={handleOpenInTab}
              title="Open in editor tab"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path d="M2 1h5v1H3v4H2V1zm12 0h-5v1h4v4h1V1zM2 15h5v-1H3v-4H2v5zm12 0h-5v-1h4v-4h1v5z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {showSettings && <GraphSettingsPanel />}
      <div ref={containerRef} className="graph-view-canvas" />
    </div>
  );
}
