// §39 Tab Switcher — Ctrl+Tab MRU popup
import { useEffect, useRef } from "react";

import type { EditorTab } from "../../stores/editor-store";

interface TabSwitcherProps {
  mruTabs: EditorTab[];
  selectedIndex: number;
}

export function TabSwitcher({ mruTabs, selectedIndex }: TabSwitcherProps) {
  const selectedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (mruTabs.length === 0) return null;

  return (
    <div className="tab-switcher-overlay">
      <div className="tab-switcher-panel">
        <div className="tab-switcher-header">Open Tabs</div>
        <div className="tab-switcher-list">
          {mruTabs.map((tab, i) => (
            <div
              className={`tab-switcher-item${i === selectedIndex ? "tab-switcher-item--selected" : ""}`}
              key={tab.id}
              ref={i === selectedIndex ? selectedRef : null}
            >
              <span className="tab-switcher-title">{tab.title}</span>
              {tab.isDirty && <span className="tab-switcher-dirty">●</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
