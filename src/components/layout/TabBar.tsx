// §4.3 Multi-file tab bar
import { useEditorStore } from "../../stores/editor-store";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditorStore();

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
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
              closeTab(tab.id);
            }}
            title="Close tab"
          >
            \u00D7
          </button>
        </div>
      ))}
    </div>
  );
}
