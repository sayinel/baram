// §31 Wikilink autocomplete menu — file suggestion popup
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type { WikilinkSuggestionItem } from "../../extensions/plugins/wikilink-suggest-utils";

export interface WikilinkMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface WikilinkMenuProps {
  command: (item: WikilinkSuggestionItem) => void;
  items: WikilinkSuggestionItem[];
}

export const WikilinkMenuList = forwardRef<WikilinkMenuRef, WikilinkMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
      new Set(),
    );
    const listRef = useRef<HTMLDivElement>(null);

    // §87 Subfolders start collapsed; root "/" stays expanded.
    // Re-compute when items change (async load).
    useEffect(() => {
      const folders = items
        .filter((i) => i.kind === "folder-header" && i.folder !== "/")
        .map((i) => i.folder!);
      if (folders.length > 0) {
        setCollapsedFolders(new Set(folders));
      }
    }, [items]);

    // §87 Separate selectable items from hint and folder-header items
    const selectableItems = useMemo(
      () =>
        items.filter(
          (i) =>
            i.kind !== "hint" &&
            i.kind !== "folder-header" &&
            !collapsedFolders.has(i.folder ?? ""),
        ),
      [items, collapsedFolders],
    );

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      const container = listRef.current;
      if (!container) return;
      const selected = container.querySelector(".wikilink-item-selected");
      if (selected) {
        selected.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex]);

    const selectItem = useCallback(
      (index: number) => {
        const item = selectableItems[index];
        if (item) command(item);
      },
      [selectableItems, command],
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (selectableItems.length === 0) return false;
        if (event.key === "ArrowUp") {
          setSelectedIndex(
            (i) => (i - 1 + selectableItems.length) % selectableItems.length,
          );
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % selectableItems.length);
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return <div className="wikilink-menu-empty">No matching pages</div>;
    }

    return (
      <div className="wikilink-menu" ref={listRef}>
        {items.map((item) => {
          if (item.kind === "hint") {
            return (
              <div className="wikilink-menu-hint" key={item.id}>
                <span className="wikilink-hint-label">{item.label}</span>
              </div>
            );
          }
          if (item.kind === "folder-header") {
            const folder = item.folder ?? "/";
            const isCollapsed = collapsedFolders.has(folder);
            const fileCount = items.filter(
              (i) => i.kind !== "folder-header" && i.folder === folder,
            ).length;
            return (
              <div
                className="wikilink-menu-folder-header"
                key={item.id}
                onClick={() =>
                  setCollapsedFolders((prev) => {
                    const next = new Set(prev);
                    if (next.has(folder)) next.delete(folder);
                    else next.add(folder);
                    return next;
                  })
                }
              >
                <span className="wikilink-folder-arrow">
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <span className="wikilink-folder-icon">📁</span>
                <span className="wikilink-folder-name">{item.label}</span>
                <span className="wikilink-folder-count">{fileCount}</span>
              </div>
            );
          }
          // Hide files in collapsed folders
          if (item.folder && collapsedFolders.has(item.folder)) {
            return null;
          }
          const selectableIdx = selectableItems.indexOf(item);
          return (
            <div
              className={`wikilink-menu-item ${selectableIdx === selectedIndex ? "wikilink-item-selected" : ""} ${item.kind === "create" ? "wikilink-item-create" : ""} ${item.folder && item.folder !== "/" ? "wikilink-item-indented" : ""}`}
              key={item.id}
              onClick={() => selectItem(selectableIdx)}
              onMouseEnter={() => setSelectedIndex(selectableIdx)}
            >
              {item.kind === "create" ? (
                <>
                  <span className="wikilink-item-icon">+</span>
                  <span className="wikilink-item-label">{item.label}</span>
                </>
              ) : item.kind === "heading" ? (
                <>
                  <span className="wikilink-heading-icon">
                    {"#".repeat(item.headingLevel ?? 1)}
                  </span>
                  <span className="wikilink-item-label">{item.heading}</span>
                </>
              ) : (
                <span className="wikilink-item-label">{item.target}</span>
              )}
            </div>
          );
        })}
      </div>
    );
  },
);

WikilinkMenuList.displayName = "WikilinkMenuList";
