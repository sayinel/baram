// §4.3 Multi-file tab bar with overflow scroll
import { useCallback, useRef, useState, useEffect } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../stores/editor-store";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditorStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={`tab-item ${tab.id === activeTabId ? "tab-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
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
