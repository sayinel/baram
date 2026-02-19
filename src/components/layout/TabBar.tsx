// §4.3 Multi-file tab bar with overflow scroll + VS Code-style drag reorder
import { useCallback, useRef, useState, useEffect } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../stores/editor-store";

const DRAG_THRESHOLD = 3; // px before drag activates

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, reorderTab } =
    useEditorStore();
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

  // Compute drop slot from mouse X by comparing to each tab's center
  const computeDropSlot = useCallback(
    (clientX: number, fromIndex: number): number => {
      const container = scrollRef.current;
      if (!container) return fromIndex;

      const tabEls = container.querySelectorAll<HTMLElement>("[data-tab-id]");
      for (let i = 0; i < tabEls.length; i++) {
        const rect = tabEls[i].getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        if (clientX < center) {
          // Insert before tab i — but if dragging from left of i, slot = i;
          // if dragging from right, slot = i (tab shifts right).
          return i;
        }
      }
      // Past all tabs → place at end
      return tabEls.length;
    },
    [],
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
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={[
              "tab-item",
              tab.id === activeTabId && "tab-active",
              dragIndex === index && "tab-dragging",
              // Show drop indicator on left edge of this tab
              dropSlot === index && dragIndex !== null && dropSlot !== dragIndex && dropSlot !== dragIndex + 1 && "tab-drop-before",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseDown={(e) => handleTabMouseDown(e, index)}
          >
            <span className="tab-title">
              {tab.isDirty ? "\u25CF " : ""}
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
        ))}
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
    </div>
  );
}
