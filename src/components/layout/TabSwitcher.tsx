// §39 Tab Switcher — Ctrl+Tab MRU popup
import type { EditorTab } from "../../stores/editor-store";

interface TabSwitcherProps {
  mruTabs: EditorTab[];
  selectedIndex: number;
}

export function TabSwitcher({ mruTabs, selectedIndex }: TabSwitcherProps) {
  if (mruTabs.length === 0) return null;

  return (
    <div className="tab-switcher-overlay">
      <div className="tab-switcher-panel">
        <div className="tab-switcher-header">Open Tabs</div>
        {mruTabs.map((tab, i) => (
          <div
            key={tab.id}
            className={`tab-switcher-item${i === selectedIndex ? " tab-switcher-item--selected" : ""}`}
          >
            <span className="tab-switcher-title">{tab.title}</span>
            {tab.isDirty && <span className="tab-switcher-dirty">●</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
