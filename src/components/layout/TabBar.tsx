// §4.3 Multi-file tab bar
import { useCallback } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../stores/editor-store";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useEditorStore();

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
              handleClose(tab.id);
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
