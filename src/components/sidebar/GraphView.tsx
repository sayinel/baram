// §30 Graph View — interactive link graph visualization
import { useEffect, useRef, useCallback, useState } from "react";
import cytoscape from "cytoscape";
import type { Core, EventObject, StylesheetStyle } from "cytoscape";
import { useFileStore } from "../../stores/file-store";
import { useEditorStore, isGraphTab } from "../../stores/editor-store";
import { useLinkStore } from "../../stores/link-store";
import { getLinkIndex, readFile } from "../../ipc/invoke";
import { toGraphElements, nodeSize } from "./graph-utils";

/** Cytoscape stylesheet */
const GRAPH_STYLE: StylesheetStyle[] = [
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
    },
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
    selector: "edge",
    style: {
      width: 1,
      "line-color": "var(--graph-edge-color, #374151)",
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "var(--graph-edge-color, #374151)",
      "arrow-scale": 0.6,
      opacity: 0.5,
    },
  },
  {
    selector: "edge.highlighted",
    style: {
      "line-color": "var(--graph-active-color, #3b82f6)",
      "target-arrow-color": "var(--graph-active-color, #3b82f6)",
      opacity: 1,
      width: 2,
    },
  },
];

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const rootPath = useFileStore((s) => s.rootPath);
  const activeFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (tab?.filePath) return tab.filePath;
    // When graph tab is active, find the most recently used file tab for highlighting
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

  // Initialize cytoscape instance
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: GRAPH_STYLE,
      layout: { name: "grid" }, // placeholder, will relayout on data
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Handle node click → open file (mirrors FileTree pattern)
  const handleNodeTap = useCallback(
    async (evt: EventObject) => {
      const filePath = evt.target.id();
      if (!filePath) return;

      const { tabs, setActiveTab, openTab } = useEditorStore.getState();

      // If file is already open, just activate the tab
      const existing = tabs.find((t) => t.filePath === filePath);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }

      // Read file content → store → open tab
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

  // Fetch graph data and render
  useEffect(() => {
    if (!rootPath) return;
    const cy = cyRef.current;
    if (!cy) return;

    let cancelled = false;

    (async () => {
      try {
        const graph = await getLinkIndex();
        if (cancelled) return;

        const { nodes, edges } = toGraphElements(graph);

        // Add computed size to nodes
        const nodesWithSize = nodes.map((n) => ({
          ...n,
          data: {
            ...n.data,
            size: nodeSize(n.data.degree),
          },
        }));

        // Batch update
        cy.elements().remove();
        cy.add([...nodesWithSize, ...edges] as cytoscape.ElementDefinition[]);

        // Mark orphan nodes
        cy.nodes().forEach((node) => {
          if (node.degree() === 0) {
            node.addClass("orphan");
          }
        });

        // Run layout
        cy.layout({
          name: "cose",
          animate: false,
          randomize: true,
          nodeRepulsion: () => 8000,
          idealEdgeLength: () => 80,
          edgeElasticity: () => 100,
          gravity: 0.25,
          numIter: 500,
          padding: 30,
        } as cytoscape.CoseLayoutOptions).run();

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
  }, [rootPath, indexVersion, handleNodeTap]);

  // Highlight active file node
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Clear previous highlights
    cy.nodes().removeClass("active neighbor");
    cy.edges().removeClass("highlighted");

    if (!activeFilePath) return;

    const activeNode = cy.getElementById(activeFilePath);
    if (activeNode.empty()) return;

    activeNode.addClass("active");

    // Highlight neighbors
    const neighborhood = activeNode.neighborhood();
    neighborhood.nodes().addClass("neighbor");
    neighborhood.edges().addClass("highlighted");

    // Connected edges from/to active node
    activeNode.connectedEdges().addClass("highlighted");

    // Center on active node (smooth animation)
    cy.animate({
      center: { eles: activeNode },
      duration: 300,
    });
  }, [activeFilePath, nodeCount]); // nodeCount dependency triggers re-highlight after data load

  if (!rootPath) {
    return (
      <div className="graph-view-empty">
        <p>Open a folder to view the link graph.</p>
      </div>
    );
  }

  const handleOpenInTab = useCallback(() => {
    useEditorStore.getState().openGraphTab();
  }, []);

  return (
    <div className="graph-view-container">
      <div className="graph-view-header">
        <span className="graph-view-title">Graph View</span>
        <span className="graph-view-stats">
          {nodeCount} nodes, {edgeCount} edges
        </span>
        <button
          className="graph-view-expand-btn"
          onClick={handleOpenInTab}
          title="Open in editor tab"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M2 1h5v1H3v4H2V1zm12 0h-5v1h4v4h1V1zM2 15h5v-1H3v-4H2v5zm12 0h-5v-1h4v-4h1v5z" />
          </svg>
        </button>
      </div>
      <div ref={containerRef} className="graph-view-canvas" />
    </div>
  );
}
