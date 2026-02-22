// §4.3 Multi-file tab bar with overflow scroll + VS Code-style drag reorder
// §38 Tab Pin — context menu, pinned rendering, drag boundary clamping
import { useCallback, useRef, useState, useEffect } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEditorStore, isFileTab } from "../../stores/editor-store";

const DRAG_THRESHOLD = 3; // px before drag activates

/** SVG pin icon — 14×14 */
function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="currentColor"
    >
      <path d="M10.97 2.29a1 1 0 0 0-1.41 0L7.44 4.4 5.03 3.03a1 1 0 0 0-1.2.15L2.79 4.22a1 1 0 0 0 .15 1.2l1.37 2.41L2.2 9.94a1 1 0 0 0 0 1.41l2.44 2.44a1 1 0 0 0 1.41 0l2.12-2.12 2.41 1.37a1 1 0 0 0 1.2-.15l1.04-1.04a1 1 0 0 0 .15-1.2L11.6 8.56l2.12-2.12a1 1 0 0 0 0-1.41L10.97 2.29z" />
    </svg>
  );
}

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
  } = useEditorStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const dragState = useRef<{
    index: number;
    startX: number;
    active: boolean;
  } | null>(null);

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

        const slot = computeDropSlot(ev.clientX, ds.index);
        setDropSlot(slot);
      };

      const handleMouseUp = (ev: MouseEvent) => {
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
    [tabs, setActiveTab, reorderTab, computeDropSlot],
  );

  // §38 Context menu handler
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault();
      setContextMenu({ tabId, x: e.clientX, y: e.clientY });
    },
    [],
  );

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {canScrollLeft && (
        <button
          className="tab-scroll-btn tab-scroll-left"
          onClick={() => scroll(-1)}
          aria-label="Scroll tabs left"
        >
          ‹
        </button>
      )}
      <div
        className="tab-scroll-area"
        ref={scrollRef}
        onWheel={handleWheel}
      >
        {tabs.map((tab, index) => {
          const showDivider =
            tab.isPinned &&
            index === pinnedCount - 1 &&
            pinnedCount < tabs.length;

          return (
            <div key={tab.id} style={{ display: "contents" }}>
              <div
                data-tab-id={tab.id}
                className={[
                  "tab-item",
                  tab.id === activeTabId && "tab-active",
                  tab.isPinned && "tab-pinned",
                  dragIndex === index && "tab-dragging",
                  // Show drop indicator on left edge of this tab
                  dropSlot === index && dragIndex !== null && dropSlot !== dragIndex && dropSlot !== dragIndex + 1 && "tab-drop-before",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseDown={(e) => handleTabMouseDown(e, index)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
              >
                {tab.isPinned && <PinIcon className="tab-pin-icon" />}
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
        {dragIndex !== null && dropSlot === tabs.length && dropSlot !== dragIndex + 1 && (
          <div className="tab-drop-indicator-end" />
        )}
      </div>
      {canScrollRight && (
        <button
          className="tab-scroll-btn tab-scroll-right"
          onClick={() => scroll(1)}
          aria-label="Scroll tabs right"
        >
          ›
        </button>
      )}

      {/* §38 Context Menu */}
      {contextMenu && (() => {
        const tab = tabs.find((t) => t.id === contextMenu.tabId);
        if (!tab) return null;
        return (
          <div
            className="tab-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
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
              className={`tab-context-item${tab.isPinned ? " tab-context-item--disabled" : ""}`}
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
