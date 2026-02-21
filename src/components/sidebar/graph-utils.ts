// §30 Graph View — utility functions for transforming LinkGraph to cytoscape elements

import type { LinkGraph } from "../../ipc/types";

/** Cytoscape node element */
export interface GraphNode {
  data: {
    id: string;
    label: string;
    /** Number of connections (in + out) */
    degree: number;
  };
}

/** Cytoscape edge element */
export interface GraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
  };
}

export type GraphElements = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/**
 * Extract display-friendly filename from a full path.
 * "/path/to/My Note.md" → "My Note"
 */
export function displayName(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  return name.replace(/\.md$/i, "");
}

/**
 * Transform a LinkGraph (from Rust IPC) into cytoscape-compatible elements.
 * Deduplicates edges and computes node degrees.
 */
export function toGraphElements(graph: LinkGraph): GraphElements {
  // Build degree map
  const degreeMap = new Map<string, number>();
  for (const node of graph.nodes) {
    degreeMap.set(node, 0);
  }

  // Deduplicate edges (same source→target pair)
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const edge of graph.edges) {
    const key = `${edge.from}\0${edge.to}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);

    edges.push({
      data: {
        id: `e-${edges.length}`,
        source: edge.from,
        target: edge.to,
      },
    });

    degreeMap.set(edge.from, (degreeMap.get(edge.from) ?? 0) + 1);
    degreeMap.set(edge.to, (degreeMap.get(edge.to) ?? 0) + 1);
  }

  const nodes: GraphNode[] = graph.nodes.map((filePath) => ({
    data: {
      id: filePath,
      label: displayName(filePath),
      degree: degreeMap.get(filePath) ?? 0,
    },
  }));

  return { nodes, edges };
}

/**
 * Compute node size based on degree (more connections = larger node).
 * Returns a value between minSize and maxSize.
 */
export function nodeSize(degree: number, minSize = 20, maxSize = 60): number {
  if (degree <= 0) return minSize;
  // Logarithmic scaling capped at maxSize
  return Math.min(minSize + Math.log2(degree + 1) * 10, maxSize);
}
