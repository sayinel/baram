// §56m Tag Sidebar Panel — tree view of vault-wide tags with counts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TagEntry } from "../../ipc/invoke";

import { getVaultTags, renameTag } from "../../ipc/invoke";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";

const TAG_COLOR_PRESETS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#3b82f6", // blue
  "#8b5cf6", // purple
];

interface TagTreeNode {
  children: Map<string, TagTreeNode>;
  count: number;
  expanded: boolean;
  fullPath: string;
  name: string;
}

export function TagPanel() {
  const rootPath = useFileStore((s) => s.rootPath);
  const [entries, setEntries] = useState<TagEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandState, setExpandState] = useState<Map<string, boolean>>(
    new Map(),
  );
  const [contextMenu, setContextMenu] = useState<null | {
    tag: string;
    x: number;
    y: number;
  }>(null);
  const [renaming, setRenaming] = useState<null | string>(null);
  const [renameValue, setRenameValue] = useState("");
  const [notification, setNotification] = useState<null | string>(null);
  const notifTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const [viewMode, setViewMode] = useState<"cloud" | "tree">("tree");
  const tagColors = useSettingsStore((s) => s.tagColors);
  const setTagColor = useSettingsStore((s) => s.setTagColor);
  const removeTagColor = useSettingsStore((s) => s.removeTagColor);

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

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

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
    // Dispatch search event after React mounts the search panel and registers listeners
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("baram:search-query", { detail: { query: `#${tag}` } }),
      );
    }, 50);
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

  const handleContextMenu = useCallback((e: React.MouseEvent, tag: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, tag });
  }, []);

  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    notifTimerRef.current = setTimeout(() => setNotification(null), 3000);
  }, []);

  const handleRenameKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>, tag: string) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const newTag = renameValue.trim().replace(/^#/, "");
        if (!newTag || newTag === tag) {
          setRenaming(null);
          return;
        }
        if (!rootPath) return;
        try {
          const result = await renameTag(rootPath, tag, newTag);
          showNotification(
            `Renamed #${tag} → #${newTag} in ${result.filesModified} file${result.filesModified !== 1 ? "s" : ""} (${result.occurrencesReplaced} occurrence${result.occurrencesReplaced !== 1 ? "s" : ""})`,
          );
          await fetchTags();
          useUIStore.getState().triggerContentReload();
        } catch (err) {
          console.error("[TagPanel] rename_tag failed:", err);
          showNotification(`Failed to rename tag: ${err}`);
        } finally {
          setRenaming(null);
        }
      } else if (e.key === "Escape") {
        setRenaming(null);
      }
    },
    [renameValue, rootPath, fetchTags, showNotification],
  );

  const handleRenameBlur = useCallback(() => {
    setRenaming(null);
  }, []);

  // Cloud view data
  const cloudEntries = useMemo(() => {
    return [...entries].sort((a, b) => b.count - a.count).slice(0, 50);
  }, [entries]);
  const maxCount = cloudEntries.length > 0 ? cloudEntries[0].count : 1;
  const minCount =
    cloudEntries.length > 0 ? cloudEntries[cloudEntries.length - 1].count : 1;

  return (
    <div className="tag-panel">
      <div className="tag-panel-header">
        <span>Tags ({totalTags})</span>
        <div className="tag-panel-actions">
          {viewMode === "tree" && (
            <>
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
            </>
          )}
          <button
            className={`tag-panel-action-btn${viewMode === "tree" ? "tag-panel-action-active" : ""}`}
            onClick={() => setViewMode("tree")}
            title="Tree view"
          >
            ☰
          </button>
          <button
            className={`tag-panel-action-btn${viewMode === "cloud" ? "tag-panel-action-active" : ""}`}
            onClick={() => setViewMode("cloud")}
            title="Cloud view"
          >
            ☁
          </button>
          <button
            className="tag-panel-action-btn"
            disabled={loading}
            onClick={fetchTags}
            title="Refresh tags"
          >
            ↻
          </button>
        </div>
      </div>

      {notification && (
        <div className="tag-panel-notification">{notification}</div>
      )}

      <div className="tag-panel-filter">
        <input
          className="tag-panel-filter-input"
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tags..."
          type="text"
          value={filter}
        />
      </div>

      {loading && entries.length === 0 ? (
        <div className="tag-panel-empty">Loading tags...</div>
      ) : totalTags === 0 ? (
        <div className="tag-panel-empty">
          No tags found. Use #tag in your notes to create tags.
        </div>
      ) : viewMode === "cloud" ? (
        <div className="tag-cloud">
          {cloudEntries.map((entry) => {
            const size = getCloudFontSize(entry.count, maxCount, minCount);
            const tagColor = tagColors[entry.tag];
            return (
              <span
                className="tag-cloud-item"
                key={entry.tag}
                onClick={() => handleClickTag(entry.tag)}
                style={{ fontSize: `${size}rem`, color: tagColor || undefined }}
                title={`#${entry.tag} (${entry.count})`}
              >
                #{entry.tag}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="tag-panel-tree">
          {sortedRoots.map((node) => (
            <TagTreeItem
              depth={0}
              filter={normalizedFilter}
              key={node.fullPath}
              node={node}
              onClickTag={handleClickTag}
              onContextMenu={handleContextMenu}
              onRenameBlur={handleRenameBlur}
              onRenameChange={setRenameValue}
              onRenameKeyDown={handleRenameKeyDown}
              onToggle={handleToggle}
              renameValue={renameValue}
              renaming={renaming}
            />
          ))}
          <div className="tag-panel-stats">
            {totalTags} tags, {totalCount} references
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="tag-context-menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              setRenaming(contextMenu.tag);
              setRenameValue(contextMenu.tag);
              setContextMenu(null);
            }}
          >
            Rename tag...
          </button>
          <button
            onClick={() => {
              handleClickTag(contextMenu.tag);
              setContextMenu(null);
            }}
          >
            Search for tag
          </button>
          <button
            onClick={() => {
              useFileStore.getState().setTagFilter(contextMenu.tag);
              const uiStore = useUIStore.getState();
              if (!uiStore.sidebarOpen) uiStore.toggleSidebar();
              uiStore.setSidebarPanel("files");
              setContextMenu(null);
            }}
          >
            Filter files by tag
          </button>
          <div className="tag-color-palette">
            {TAG_COLOR_PRESETS.map((color) => (
              <button
                className={`tag-color-dot${tagColors[contextMenu.tag] === color ? "tag-color-dot-active" : ""}`}
                key={color}
                onClick={() => {
                  setTagColor(contextMenu.tag, color);
                  setContextMenu(null);
                }}
                style={{ background: color }}
                title={color}
              />
            ))}
            {tagColors[contextMenu.tag] && (
              <button
                className="tag-color-dot tag-color-dot-clear"
                onClick={() => {
                  removeTagColor(contextMenu.tag);
                  setContextMenu(null);
                }}
                title="Remove color"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
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

function getCloudFontSize(count: number, max: number, min: number): number {
  if (max === min) return 1;
  const normalized = (count - min) / (max - min);
  return 0.7 + normalized * 1.3; // Range: 0.7rem to 2.0rem
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
  onContextMenu,
  renaming,
  renameValue,
  onRenameChange,
  onRenameKeyDown,
  onRenameBlur,
}: {
  depth: number;
  filter: string;
  node: TagTreeNode;
  onClickTag: (tag: string) => void;
  onContextMenu: (e: React.MouseEvent, tag: string) => void;
  onRenameBlur: () => void;
  onRenameChange: (val: string) => void;
  onRenameKeyDown: (
    e: React.KeyboardEvent<HTMLInputElement>,
    tag: string,
  ) => void;
  onToggle: (fullPath: string) => void;
  renameValue: string;
  renaming: null | string;
}) {
  const hasChildren = node.children.size > 0;
  const totalCount = getTotalCount(node);
  const sortedChildren = useMemo(
    () => sortNodes(node.children),
    [node.children],
  );
  const tagColors = useSettingsStore((s) => s.tagColors);
  const tagColor = tagColors[node.fullPath];

  // Filter: if filter is set, only show matching nodes
  const matchesFilter = !filter || node.fullPath.toLowerCase().includes(filter);
  const childrenMatchFilter =
    !filter ||
    sortedChildren.some(
      (child) =>
        child.fullPath.toLowerCase().includes(filter) ||
        getTotalCount(child) > 0,
    );

  if (filter && !matchesFilter && !childrenMatchFilter) {
    return null;
  }

  return (
    <>
      <div
        className={`tag-tree-item ${depth === 0 ? "tag-tree-item-root" : ""}`}
        onClick={() => onClickTag(node.fullPath)}
        onContextMenu={(e) => onContextMenu(e, node.fullPath)}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
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
        <span
          className="tag-tree-hash"
          style={{ color: tagColor || undefined }}
        >
          #
        </span>
        {renaming === node.fullPath ? (
          <input
            autoFocus
            className="tag-rename-input"
            onBlur={onRenameBlur}
            onChange={(e) => onRenameChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => onRenameKeyDown(e, node.fullPath)}
            value={renameValue}
          />
        ) : (
          <span
            className="tag-tree-name"
            style={{ color: tagColor || undefined }}
          >
            {node.name}
          </span>
        )}
        {renaming !== node.fullPath && (
          <span className="tag-tree-count">{totalCount}</span>
        )}
      </div>
      {hasChildren &&
        node.expanded &&
        sortedChildren.map((child) => (
          <TagTreeItem
            depth={depth + 1}
            filter={filter}
            key={child.fullPath}
            node={child}
            onClickTag={onClickTag}
            onContextMenu={onContextMenu}
            onRenameBlur={onRenameBlur}
            onRenameChange={onRenameChange}
            onRenameKeyDown={onRenameKeyDown}
            onToggle={onToggle}
            renameValue={renameValue}
            renaming={renaming}
          />
        ))}
    </>
  );
}
