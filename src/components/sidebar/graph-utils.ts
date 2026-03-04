// §30 Graph View — utility functions for transforming LinkGraph to cytoscape elements

import type { LinkGraph } from "../../ipc/types";

/** Cytoscape node element */
export interface GraphNode {
  data: {
    id: string;
    label: string;
    /** Number of connections (in + out) */
    degree: number;
    /** True if the file does not exist (wikilink target only) */
    isGhost?: boolean;
    /** True if this is a tag virtual node */
    isTag?: boolean;
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
 * Case-insensitive substring match for graph node filtering.
 * Empty query matches everything.
 */
export function matchesFilter(label: string, query: string): boolean {
  if (!query) return true;
  return label.toLowerCase().includes(query.toLowerCase());
}

/**
 * Transform a LinkGraph (from Rust IPC) into cytoscape-compatible elements.
 * Deduplicates edges and computes node degrees.
 * Creates ghost nodes for edge targets that are not in graph.nodes.
 */
export function toGraphElements(graph: LinkGraph): GraphElements {
  const nodeSet = new Set(graph.nodes);

  // Build degree map
  const degreeMap = new Map<string, number>();
  for (const node of graph.nodes) {
    degreeMap.set(node, 0);
  }

  // Collect ghost node IDs (edge targets not in graph.nodes)
  const ghostIds = new Set<string>();

  // Deduplicate edges (same source→target pair)
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const edge of graph.edges) {
    const key = `${edge.from}\0${edge.to}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);

    // Create ghost node for missing targets
    if (!nodeSet.has(edge.to)) {
      ghostIds.add(edge.to);
      if (!degreeMap.has(edge.to)) degreeMap.set(edge.to, 0);
    }
    if (!nodeSet.has(edge.from)) {
      ghostIds.add(edge.from);
      if (!degreeMap.has(edge.from)) degreeMap.set(edge.from, 0);
    }

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

  const TAG_PREFIX = "tag:";
  const nodes: GraphNode[] = graph.nodes.map((nodeId) => {
    if (nodeId.startsWith(TAG_PREFIX)) {
      const tagName = nodeId.slice(TAG_PREFIX.length);
      return {
        data: {
          id: nodeId,
          label: `#${tagName}`,
          degree: degreeMap.get(nodeId) ?? 0,
          isTag: true,
        },
      };
    }
    return {
      data: {
        id: nodeId,
        label: displayName(nodeId),
        degree: degreeMap.get(nodeId) ?? 0,
      },
    };
  });

  // Add ghost nodes
  for (const ghostId of ghostIds) {
    nodes.push({
      data: {
        id: ghostId,
        label: displayName(ghostId),
        degree: degreeMap.get(ghostId) ?? 0,
        isGhost: true,
      },
    });
  }

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
