// §4.3 Left sidebar container — panel switching via ActivityBar
import { useUIStore } from "../../stores/ui-store";
import { FileTree } from "../sidebar/FileTree";
import { Outline } from "../sidebar/Outline";
import { Backlinks } from "../sidebar/Backlinks";
import { BookmarkPanel } from "../sidebar/BookmarkPanel";
import { GraphView } from "../sidebar/GraphView";
import type { Editor } from "@tiptap/react";

interface SidebarProps {
  editor: Editor | null;
}

export function Sidebar({ editor }: SidebarProps) {
  const { sidebarPanel } = useUIStore();

  return (
    <div className="sidebar">
      <div className="sidebar-content">
        {sidebarPanel === "files" && <FileTree />}
        {sidebarPanel === "outline" && <Outline editor={editor} />}
        {sidebarPanel === "backlinks" && <Backlinks />}
        {sidebarPanel === "bookmarks" && <BookmarkPanel />}
        {sidebarPanel === "graph" && <GraphView />}
      </div>
    </div>
  );
}
