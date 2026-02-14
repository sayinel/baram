// §4.3 Left sidebar container with mode tabs
import { useUIStore } from "../../stores/ui-store";
import { FileTree } from "../sidebar/FileTree";
import { Outline } from "../sidebar/Outline";
import baramSymbol from "../../assets/baram-symbol.png";
import type { Editor } from "@tiptap/react";

interface SidebarProps {
  editor: Editor | null;
}

const SIDEBAR_TABS = [
  { id: "files" as const, label: "Files", icon: "\uD83D\uDCC1" },
  { id: "outline" as const, label: "Outline", icon: "\uD83D\uDCCB" },
] as const;

export function Sidebar({ editor }: SidebarProps) {
  const { sidebarPanel, setSidebarPanel } = useUIStore();

  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <img src={baramSymbol} alt="Baram" className="sidebar-brand-icon" />
        <span className="sidebar-brand-name">Baram</span>
      </div>
      <div className="sidebar-tabs">
        {SIDEBAR_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`sidebar-tab ${sidebarPanel === tab.id ? "sidebar-tab-active" : ""}`}
            onClick={() => setSidebarPanel(tab.id)}
            title={tab.label}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {sidebarPanel === "files" && <FileTree />}
        {sidebarPanel === "outline" && <Outline editor={editor} />}
      </div>
    </div>
  );
}
