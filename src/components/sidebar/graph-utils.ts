// §30 Graph View — utility functions for transforming LinkGraph to cytoscape elements

import type { LinkGraph } from "../../ipc/types";

/** Cytoscape edge element */
export interface GraphEdge {
  data: {
    /** §87 True when source and target belong to different vaults */
    crossVault?: boolean;
    id: string;
    source: string;
    target: string;
  };
}

export type GraphElements = {
  edges: GraphEdge[];
  nodes: GraphNode[];
};

/** Cytoscape node element */
export interface GraphNode {
  data: {
    /** Number of connections (in + out) */
    degree: number;
    id: string;
    /** True if the file does not exist (wikilink target only) */
    isGhost?: boolean;
    /** True if this is a tag virtual node */
    isTag?: boolean;
    label: string;
    /** §61 Namespace — directory path relative to rootPath (empty string = root) */
    namespace?: string;
  };
}

/** §61 Extract namespace (directory relative to rootPath) from a full file path */
export function extractNamespace(filePath: string, rootPath: string): string {
  let rel = filePath.startsWith(rootPath)
    ? filePath.slice(rootPath.length)
    : filePath;
  if (rel.startsWith("/")) rel = rel.slice(1);
  const lastSlash = rel.lastIndexOf("/");
  if (lastSlash <= 0) return "";
  return rel.substring(0, lastSlash);
}

const NS_PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
  "#6366f1",
];

/**
 * Transform a LinkGraph (from Rust IPC) into cytoscape-compatible elements.
 * Deduplicates edges and computes node degrees.
 * Creates ghost nodes for edge targets that are not in graph.nodes.
 */
/**
 * §87 Map from node ID (file path) to vault context ID.
 * Used to detect cross-vault edges in multi-vault graph mode.
 */
export type NodeVaultMap = Map<string, string>;

/** §61 Assign colors to namespaces. Returns a Map from namespace string to hex color. */
export function assignNamespaceColors(
  namespaces: string[],
): Map<string, string> {
  const unique = [...new Set(namespaces)].sort();
  const map = new Map<string, string>();
  unique.forEach((ns, i) => {
    map.set(ns, NS_PALETTE[i % NS_PALETTE.length]);
  });
  return map;
}

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
 * §87 Merge multiple LinkGraphs into one.
 * Deduplicates nodes and edges across vaults.
 */
export function mergeGraphs(graphs: LinkGraph[]): LinkGraph {
  const nodeSet = new Set<string>();
  const edgeSet = new Set<string>();
  const edges: LinkGraph["edges"] = [];

  for (const g of graphs) {
    for (const node of g.nodes) {
      nodeSet.add(node);
    }
    for (const edge of g.edges) {
      const key = `${edge.from}\0${edge.to}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push(edge);
      }
    }
  }

  return { nodes: [...nodeSet], edges };
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

export function toGraphElements(
  graph: LinkGraph,
  rootPath?: string,
  nodeVaultMap?: NodeVaultMap,
): GraphElements {
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

    // §87 Use cross_vault flag from Rust LinkEdge (set when target_vault_alias exists)
    const isCrossVault =
      edge.crossVault === true ||
      (nodeVaultMap !== undefined &&
        nodeVaultMap.has(edge.from) &&
        nodeVaultMap.has(edge.to) &&
        nodeVaultMap.get(edge.from) !== nodeVaultMap.get(edge.to));

    edges.push({
      data: {
        id: `e-${edges.length}`,
        source: edge.from,
        target: edge.to,
        ...(isCrossVault && { crossVault: true }),
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
        namespace: rootPath ? extractNamespace(nodeId, rootPath) : undefined,
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
        namespace: rootPath ? extractNamespace(ghostId, rootPath) : undefined,
      },
    });
  }

  return { nodes, edges };
}
