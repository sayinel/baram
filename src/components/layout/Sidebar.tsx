import { lazy, Suspense } from "react";

// §4.3 Left sidebar container — panel switching via ActivityBar
import { useUIStore } from "../../stores/ui-store";

const PluginMarketplace = lazy(() =>
  import("../plugins/PluginMarketplace").then((m) => ({
    default: m.PluginMarketplace,
  })),
);
const Backlinks = lazy(() =>
  import("../sidebar/Backlinks").then((m) => ({
    default: m.Backlinks,
  })),
);
const BookmarkPanel = lazy(() =>
  import("../sidebar/BookmarkPanel").then((m) => ({
    default: m.BookmarkPanel,
  })),
);
const CalendarPanel = lazy(() =>
  import("../sidebar/CalendarPanel").then((m) => ({
    default: m.CalendarPanel,
  })),
);
const FileTree = lazy(() =>
  import("../sidebar/FileTree").then((m) => ({
    default: m.FileTree,
  })),
);
const GitPanel = lazy(() =>
  import("../sidebar/GitPanel").then((m) => ({
    default: m.GitPanel,
  })),
);
const GlobalSearch = lazy(() =>
  import("../sidebar/GlobalSearch").then((m) => ({
    default: m.GlobalSearch,
  })),
);
const GraphView = lazy(() =>
  import("../sidebar/GraphView").then((m) => ({
    default: m.GraphView,
  })),
);
const Outline = lazy(() =>
  import("../sidebar/Outline").then((m) => ({
    default: m.Outline,
  })),
);
const SkillGalleryPanel = lazy(() =>
  import("../sidebar/SkillGalleryPanel").then((m) => ({
    default: m.SkillGalleryPanel,
  })),
);
const TagPanel = lazy(() =>
  import("../sidebar/TagPanel").then((m) => ({
    default: m.TagPanel,
  })),
);
const VersionHistoryPanel = lazy(() =>
  import("../sidebar/VersionHistoryPanel").then((m) => ({
    default: m.VersionHistoryPanel,
  })),
);

export function Sidebar() {
  const { sidebarPanel } = useUIStore();

  return (
    <div className="sidebar">
      <Suspense fallback={<div className="sidebar-content" />}>
        <div className="sidebar-content">
          {sidebarPanel === "files" && <FileTree />}
          {sidebarPanel === "search" && <GlobalSearch />}
          {sidebarPanel === "outline" && <Outline />}
          {sidebarPanel === "backlinks" && <Backlinks />}
          {sidebarPanel === "bookmarks" && <BookmarkPanel />}
          {sidebarPanel === "graph" && <GraphView />}
          {sidebarPanel === "git" && <GitPanel />}
          {sidebarPanel === "calendar" && <CalendarPanel />}
          {sidebarPanel === "tags" && <TagPanel />}
          {sidebarPanel === "snapshots" && <VersionHistoryPanel />}
          {sidebarPanel === "skills-gallery" && <SkillGalleryPanel />}
          {sidebarPanel === "plugins" && <PluginMarketplace />}
        </div>
      </Suspense>
    </div>
  );
}
