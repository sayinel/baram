// §4.3 Left sidebar container — panel switching via ActivityBar
import { useUIStore } from "../../stores/ui-store";
import { FileTree } from "../sidebar/FileTree";
import { Outline } from "../sidebar/Outline";
import { GlobalSearch } from "../sidebar/GlobalSearch";
import { Backlinks } from "../sidebar/Backlinks";
import { BookmarkPanel } from "../sidebar/BookmarkPanel";
import { GraphView } from "../sidebar/GraphView";
import { GitPanel } from "../sidebar/GitPanel";
import { CalendarPanel } from "../sidebar/CalendarPanel";
import { TagPanel } from "../sidebar/TagPanel";
import { VersionHistoryPanel } from "../sidebar/VersionHistoryPanel";
import { SkillGalleryPanel } from "../sidebar/SkillGalleryPanel";
import type { Editor } from "@tiptap/react";

interface SidebarProps {
  editor: Editor | null;
}

export function Sidebar({ editor }: SidebarProps) {
  const { sidebarPanel } = useUIStore();

  return (
    <div className="sidebar">
      <div className="sidebar-content">
        {sidebarPanel === "files" && <FileTree editor={editor} />}
        {sidebarPanel === "search" && <GlobalSearch />}
        {sidebarPanel === "outline" && <Outline editor={editor} />}
        {sidebarPanel === "backlinks" && <Backlinks />}
        {sidebarPanel === "bookmarks" && <BookmarkPanel />}
        {sidebarPanel === "graph" && <GraphView />}
        {sidebarPanel === "git" && <GitPanel />}
        {sidebarPanel === "calendar" && <CalendarPanel />}
        {sidebarPanel === "tags" && <TagPanel />}
        {sidebarPanel === "snapshots" && <VersionHistoryPanel />}
        {sidebarPanel === "skills-gallery" && <SkillGalleryPanel />}
      </div>
    </div>
  );
}
