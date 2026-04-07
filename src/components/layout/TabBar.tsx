// §4.3 Multi-file tab bar with overflow scroll + VS Code-style drag reorder
// §38 Tab Pin — context menu, pinned rendering, drag boundary clamping
import { useCallback, useEffect, useRef, useState } from "react";

import { ask } from "@tauri-apps/plugin-dialog";

import { Pin } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useContextStore } from "../../stores/context/context";
import { isFileTab, useEditorStore } from "../../stores/editor/editor";
import { switchContext } from "../../stores/file/file";

const DRAG_THRESHOLD = 3; // px before drag activates

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

export function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    reorderTab,
    togglePinTab,
    closeOtherTabs,
    closeTabsToRight,
  } = useEditorStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      setActiveTab: s.setActiveTab,
      closeTab: s.closeTab,
      reorderTab: s.reorderTab,
      togglePinTab: s.togglePinTab,
      closeOtherTabs: s.closeOtherTabs,
      closeTabsToRight: s.closeTabsToRight,
    })),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState<null | number>(null);
  const [dropSlot, setDropSlot] = useState<null | number>(null);
  const dragState = useRef<null | {
    active: boolean;
    index: number;
    startX: number;
  }>(null);

  // §38 Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  // Observe resize and scroll to update arrow visibility
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateScrollState();

    el.addEventListener("scroll", updateScrollState, { passive: true });

    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [tabs.length, updateScrollState]);

  // Auto-scroll active tab into view
  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector(
      `[data-tab-id="${activeTabId}"]`,
    );
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeTabId]);

  // §38 Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenu]);

  // Mouse wheel → horizontal scroll
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    if (e.deltaY !== 0) {
      el.scrollLeft += e.deltaY;
    }
  }, []);

  const scroll = useCallback((direction: number) => {
    scrollRef.current?.scrollBy({ left: direction * 120, behavior: "smooth" });
  }, []);

  const handleClose = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      // §38 Pinned tabs can't be closed
      if (tab?.isPinned) return;
      if (tab?.isDirty) {
        const confirmed = await ask(
          "You have unsaved changes. Close without saving?",
          { title: "Unsaved Changes", kind: "warning" },
        );
        if (!confirmed) return;
      }
      closeTab(tabId);
    },
    [tabs, closeTab],
  );

  const pinnedCount = tabs.filter((t) => t.isPinned).length;

  // Compute drop slot from mouse X by comparing to each tab's center
  // §38 Clamp slot within pinned/unpinned boundary
  const computeDropSlot = useCallback(
    (clientX: number, fromIndex: number): number => {
      const container = scrollRef.current;
      if (!container) return fromIndex;

      const tabEls = container.querySelectorAll<HTMLElement>("[data-tab-id]");
      let slot = tabEls.length; // default: after all tabs
      for (let i = 0; i < tabEls.length; i++) {
        const rect = tabEls[i].getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        if (clientX < center) {
          slot = i;
          break;
        }
      }

      // §38 Clamp: pinned tabs → 0..pinnedCount, unpinned → pinnedCount..length
      const pc = tabs.filter((t) => t.isPinned).length;
      const dragging = tabs[fromIndex];
      if (dragging?.isPinned) {
        return Math.max(0, Math.min(slot, pc));
      } else {
        return Math.max(pc, Math.min(slot, tabEls.length));
      }
    },
    [tabs],
  );

  const handleTabMouseDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      // Ignore right-click and close button clicks
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".tab-close")) return;

      e.preventDefault();
      dragState.current = { index, startX: e.clientX, active: false };

      const handleMouseMove = (ev: MouseEvent) => {
        const ds = dragState.current;
        if (!ds) return;

        if (!ds.active) {
          if (Math.abs(ev.clientX - ds.startX) < DRAG_THRESHOLD) return;
          // Activate drag
          ds.active = true;
          setDragIndex(ds.index);
        }

        // §89 Tab tear-off visual feedback: change cursor when outside tab bar
        const bar = scrollRef.current;
        if (bar) {
          const rect = bar.getBoundingClientRect();
          const outside =
            ev.clientY < rect.top - 40 ||
            ev.clientY > rect.bottom + 40 ||
            ev.clientX < rect.left - 40 ||
            ev.clientX > rect.right + 40;
          document.body.style.cursor = outside ? "move" : "grabbing";
        }

        const slot = computeDropSlot(ev.clientX, ds.index);
        setDropSlot(slot);
      };

      const handleMouseUp = async (ev: MouseEvent) => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        const ds = dragState.current;
        dragState.current = null;

        if (!ds?.active) {
          // Was a click, not a drag
          setActiveTab(tabs[index].id);
          setDragIndex(null);
          setDropSlot(null);
          return;
        }

        // §89 Tab tear-off: if mouse is outside the tab bar, detach to a new window
        const tabBar = scrollRef.current;
        if (tabBar) {
          const rect = tabBar.getBoundingClientRect();
          const outside =
            ev.clientY < rect.top - 40 ||
            ev.clientY > rect.bottom + 40 ||
            ev.clientX < rect.left - 40 ||
            ev.clientX > rect.right + 40;

          if (outside) {
            const tab = tabs[ds.index];
            if (tab && isFileTab(tab)) {
              const { openFileWindow } =
                await import("../../utils/file-window");
              await openFileWindow(tab.filePath);
              closeTab(tab.id);
            }
            setDragIndex(null);
            setDropSlot(null);
            return;
          }
        }

        // Commit reorder
        const slot = computeDropSlot(ev.clientX, ds.index);
        // Convert slot to target index in array after removal
        const toIndex = slot > ds.index ? slot - 1 : slot;
        if (toIndex !== ds.index) {
          reorderTab(ds.index, toIndex);
        }

        setDragIndex(null);
        setDropSlot(null);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    },
    [tabs, setActiveTab, reorderTab, closeTab, computeDropSlot],
  );

  // §38 Context menu handler
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault();
      setContextMenu({ tabId, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const getContextForPath = useContextStore.getState().getContextForPath;

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {canScrollLeft && (
        <button
          aria-label="Scroll tabs left"
          className="tab-scroll-btn tab-scroll-left"
          onClick={() => scroll(-1)}
        >
          ‹
        </button>
      )}
      <div className="tab-scroll-area" onWheel={handleWheel} ref={scrollRef}>
        {tabs.map((tab, index) => {
          const showDivider =
            tab.isPinned &&
            index === pinnedCount - 1 &&
            pinnedCount < tabs.length;

          return (
            <div key={tab.id} style={{ display: "contents" }}>
              <div
                className={[
                  "tab-item",
                  tab.id === activeTabId && "tab-active",
                  tab.isPinned && "tab-pinned",
                  dragIndex === index && "opacity-40",
                  // Show drop indicator on left edge of this tab
                  dropSlot === index &&
                    dragIndex !== null &&
                    dropSlot !== dragIndex &&
                    dropSlot !== dragIndex + 1 &&
                    "tab-drop-before",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-tab-id={tab.id}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                onMouseDown={(e) => handleTabMouseDown(e, index)}
              >
                {tab.isPinned && <Pin className="tab-pin-icon" size={12} />}
                <span
                  className="tab-ctx-dot"
                  onClick={(e) => {
                    e.stopPropagation();
                    const ctx = isFileTab(tab)
                      ? getContextForPath(tab.filePath)
                      : null;
                    if (ctx) switchContext(ctx.id);
                  }}
                  style={{
                    backgroundColor: isFileTab(tab)
                      ? (getContextForPath(tab.filePath)?.color ?? "#9ca3af")
                      : "#9ca3af",
                  }}
                  title={
                    isFileTab(tab)
                      ? getContextForPath(tab.filePath)?.contextType === "file"
                        ? tab.filePath
                        : getContextForPath(tab.filePath)?.label
                      : undefined
                  }
                />
                <span className="tab-title">
                  {tab.isDirty && isFileTab(tab) ? "\u25CF " : ""}
                  {tab.title}
                </span>
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose(tab.id);
                  }}
                  title="Close tab"
                >
                  {"\u00D7"}
                </button>
              </div>
              {showDivider && <div className="tab-pin-divider" />}
            </div>
          );
        })}
        {/* Drop indicator after last tab */}
        {dragIndex !== null &&
          dropSlot === tabs.length &&
          dropSlot !== dragIndex + 1 && (
            <div className="tab-drop-indicator-end" />
          )}
      </div>
      {canScrollRight && (
        <button
          aria-label="Scroll tabs right"
          className="tab-scroll-btn tab-scroll-right"
          onClick={() => scroll(1)}
        >
          ›
        </button>
      )}

      {/* §38 Context Menu */}
      {contextMenu &&
        (() => {
          const tab = tabs.find((t) => t.id === contextMenu.tabId);
          if (!tab) return null;
          return (
            <div
              className="tab-context-menu"
              onClick={(e) => e.stopPropagation()}
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <div
                className="tab-context-item"
                onClick={() => {
                  togglePinTab(tab.id);
                  setContextMenu(null);
                }}
              >
                {tab.isPinned ? "Unpin Tab" : "Pin Tab"}
              </div>
              <div
                className={`tab-context-item${tab.isPinned ? "tab-context-item--disabled" : ""}`}
                onClick={() => {
                  if (!tab.isPinned) {
                    handleClose(tab.id);
                  }
                  setContextMenu(null);
                }}
              >
                Close Tab
              </div>
              <div
                className="tab-context-item"
                onClick={() => {
                  closeOtherTabs(tab.id);
                  setContextMenu(null);
                }}
              >
                Close Other Tabs
              </div>
              <div
                className="tab-context-item"
                onClick={() => {
                  closeTabsToRight(tab.id);
                  setContextMenu(null);
                }}
              >
                Close Tabs to the Right
              </div>
            </div>
          );
        })()}
    </div>
  );
}
