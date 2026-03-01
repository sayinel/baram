// §56m Tag Sidebar Panel — tree view of vault-wide tags with counts
import { useState, useEffect, useCallback, useMemo } from "react";
import { useFileStore } from "../../stores/file-store";
import { useUIStore } from "../../stores/ui-store";
import { getVaultTags } from "../../ipc/invoke";
import type { TagEntry } from "../../ipc/invoke";

interface TagTreeNode {
  name: string;
  fullPath: string;
  count: number;
  children: Map<string, TagTreeNode>;
  expanded: boolean;
}

function buildTagTree(entries: TagEntry[]): Map<string, TagTreeNode> {
  const root = new Map<string, TagTreeNode>();

  for (const { tag, count } of entries) {
    const segments = tag.split("/");
    let current = root;
    let pathSoFar = "";

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg;
      const isLeaf = i === segments.length - 1;

      if (!current.has(seg)) {
        current.set(seg, {
          name: seg,
          fullPath: pathSoFar,
          count: isLeaf ? count : 0,
          children: new Map(),
          expanded: true,
        });
      } else if (isLeaf) {
        // Update count for the leaf node
        const node = current.get(seg)!;
        node.count = count;
      }

      current = current.get(seg)!.children;
    }
  }

  return root;
}

function getTotalCount(node: TagTreeNode): number {
  let total = node.count;
  for (const child of node.children.values()) {
    total += getTotalCount(child);
  }
  return total;
}

function sortNodes(nodes: Map<string, TagTreeNode>): TagTreeNode[] {
  return [...nodes.values()].sort((a, b) => {
    const countA = getTotalCount(a);
    const countB = getTotalCount(b);
    if (countB !== countA) return countB - countA;
    return a.name.localeCompare(b.name);
  });
}

function TagTreeItem({
  node,
  depth,
  filter,
  onClickTag,
  onToggle,
}: {
  node: TagTreeNode;
  depth: number;
  filter: string;
  onClickTag: (tag: string) => void;
  onToggle: (fullPath: string) => void;
}) {
  const hasChildren = node.children.size > 0;
  const totalCount = getTotalCount(node);
  const sortedChildren = useMemo(() => sortNodes(node.children), [node.children]);

  // Filter: if filter is set, only show matching nodes
  const matchesFilter = !filter || node.fullPath.toLowerCase().includes(filter);
  const childrenMatchFilter = !filter || sortedChildren.some(
    (child) => child.fullPath.toLowerCase().includes(filter) || getTotalCount(child) > 0,
  );

  if (filter && !matchesFilter && !childrenMatchFilter) {
    return null;
  }

  return (
    <>
      <div
        className={`tag-tree-item ${depth === 0 ? "tag-tree-item-root" : ""}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onClickTag(node.fullPath)}
        title={`#${node.fullPath} (${totalCount})`}
      >
        {hasChildren ? (
          <button
            className="tag-tree-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.fullPath);
            }}
          >
            {node.expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="tag-tree-toggle tag-tree-toggle-leaf" />
        )}
        <span className="tag-tree-hash">#</span>
        <span className="tag-tree-name">{node.name}</span>
        <span className="tag-tree-count">{totalCount}</span>
      </div>
      {hasChildren && node.expanded &&
        sortedChildren.map((child) => (
          <TagTreeItem
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            filter={filter}
            onClickTag={onClickTag}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

export function TagPanel() {
  const rootPath = useFileStore((s) => s.rootPath);
  const [entries, setEntries] = useState<TagEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandState, setExpandState] = useState<Map<string, boolean>>(new Map());

  const fetchTags = useCallback(async () => {
    if (!rootPath) return;
    setLoading(true);
    try {
      const result = await getVaultTags(rootPath);
      setEntries(result);
    } catch (err) {
      console.error("[TagPanel] Failed to fetch tags:", err);
    } finally {
      setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Build tree and apply expand state
  const tree = useMemo(() => {
    const t = buildTagTree(entries);
    // Apply saved expand state
    function applyExpandState(nodes: Map<string, TagTreeNode>) {
      for (const node of nodes.values()) {
        const saved = expandState.get(node.fullPath);
        if (saved !== undefined) {
          node.expanded = saved;
        }
        applyExpandState(node.children);
      }
    }
    applyExpandState(t);
    return t;
  }, [entries, expandState]);

  const sortedRoots = useMemo(() => sortNodes(tree), [tree]);

  const totalTags = entries.length;
  const totalCount = entries.reduce((sum, e) => sum + e.count, 0);
  const normalizedFilter = filter.toLowerCase().replace(/^#/, "");

  const handleToggle = useCallback((fullPath: string) => {
    setExpandState((prev) => {
      const next = new Map(prev);
      const current = next.get(fullPath);
      next.set(fullPath, current === undefined ? false : !current);
      return next;
    });
  }, []);

  const handleClickTag = useCallback((tag: string) => {
    const store = useUIStore.getState();
    // Open search sidebar panel
    if (!store.sidebarOpen) {
      store.toggleSidebar();
    }
    if (store.sidebarPanel !== "search") {
      store.setSidebarPanel("search");
    }
    // Dispatch search event
    window.dispatchEvent(
      new CustomEvent("baram:search-query", { detail: { query: `#${tag}` } }),
    );
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandState((prev) => {
      const next = new Map(prev);
      function collapseAll(nodes: Map<string, TagTreeNode>) {
        for (const node of nodes.values()) {
          if (node.children.size > 0) {
            next.set(node.fullPath, false);
          }
          collapseAll(node.children);
        }
      }
      collapseAll(tree);
      return next;
    });
  }, [tree]);

  const handleExpandAll = useCallback(() => {
    setExpandState(new Map());
  }, []);

  return (
    <div className="tag-panel">
      <div className="tag-panel-header">
        <span>Tags ({totalTags})</span>
        <div className="tag-panel-actions">
          <button
            className="tag-panel-action-btn"
            onClick={handleCollapseAll}
            title="Collapse all"
          >
            ⊟
          </button>
          <button
            className="tag-panel-action-btn"
            onClick={handleExpandAll}
            title="Expand all"
          >
            ⊞
          </button>
          <button
            className="tag-panel-action-btn"
            onClick={fetchTags}
            title="Refresh tags"
            disabled={loading}
          >
            ↻
          </button>
        </div>
      </div>

      <div className="tag-panel-filter">
        <input
          type="text"
          className="tag-panel-filter-input"
          placeholder="Filter tags..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {loading && entries.length === 0 ? (
        <div className="tag-panel-empty">Loading tags...</div>
      ) : totalTags === 0 ? (
        <div className="tag-panel-empty">
          No tags found. Use #tag in your notes to create tags.
        </div>
      ) : (
        <div className="tag-panel-tree">
          {sortedRoots.map((node) => (
            <TagTreeItem
              key={node.fullPath}
              node={node}
              depth={0}
              filter={normalizedFilter}
              onClickTag={handleClickTag}
              onToggle={handleToggle}
            />
          ))}
          <div className="tag-panel-stats">
            {totalTags} tags, {totalCount} references
          </div>
        </div>
      )}
    </div>
  );
}
