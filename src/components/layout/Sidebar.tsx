// §4.3 Left sidebar container with mode tabs
import { useUIStore } from "../../stores/ui-store";
import { FileTree } from "../sidebar/FileTree";
import { Outline } from "../sidebar/Outline";
import { Backlinks } from "../sidebar/Backlinks";
import type { Editor } from "@tiptap/react";

interface SidebarProps {
  editor: Editor | null;
}

const SIDEBAR_TABS = [
  { id: "files" as const, label: "Files" },
  { id: "outline" as const, label: "Outline" },
  { id: "backlinks" as const, label: "Backlinks" },
] as const;

export function Sidebar({ editor }: SidebarProps) {
  const { sidebarPanel, setSidebarPanel } = useUIStore();

  return (
    <div className="sidebar">
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
        {sidebarPanel === "backlinks" && <Backlinks />}
      </div>
    </div>
  );
}
