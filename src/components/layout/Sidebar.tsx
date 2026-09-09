import { lazy, Suspense } from "react";

// §4.3 Left sidebar container — panel switching via ActivityBar
import { useFeatureFlags } from "../../stores/settings/features";
import { useUIStore } from "../../stores/ui/ui";
import { PluginPanelHost } from "./PluginPanelHost";

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
const NoteTasksSection = lazy(() =>
  import("../tasks/NoteTasksSection").then((m) => ({
    default: m.NoteTasksSection,
  })),
);
const TaskAgendaPanel = lazy(() =>
  import("../tasks/TaskAgendaPanel").then((m) => ({
    default: m.TaskAgendaPanel,
  })),
);
const VersionHistoryPanel = lazy(() =>
  import("../sidebar/VersionHistoryPanel").then((m) => ({
    default: m.VersionHistoryPanel,
  })),
);
const ZettelHubPanel = lazy(() =>
  import("../zettelkasten/ZettelHubPanel").then((m) => ({
    default: m.ZettelHubPanel,
  })),
);

export function Sidebar() {
  const { sidebarPanel } = useUIStore();
  // I2 / §340 ⓑ: 저장된 sidebarPanel 이 꺼진 기능의 좌석을 가리킬 수 있다 —
  // 이동 이펙트(use-settings-effects)보다 첫 페인트가 빠르므로 여기서도 막는다.
  const { journal, tasks, zettelkasten } = useFeatureFlags();

  return (
    <div className="sidebar">
      <Suspense fallback={<div className="sidebar-content" />}>
        <div className="sidebar-content">
          {sidebarPanel === "files" && <FileTree />}
          {sidebarPanel === "search" && <GlobalSearch />}
          {sidebarPanel === "outline" && <Outline />}
          {sidebarPanel === "backlinks" && (
            <>
              <Backlinks />
              {/* §307 A 백링크 **아래**에 붙는다. Backlinks가 로딩·오류로 일찍 반환해도
                  이 섹션은 남아야 하므로 그 안이 아니라 형제로 둔다. */}
              <NoteTasksSection />
            </>
          )}
          {sidebarPanel === "bookmarks" && <BookmarkPanel />}
          {sidebarPanel === "graph" && <GraphView />}
          {sidebarPanel === "git" && <GitPanel />}
          {sidebarPanel === "calendar" && journal && <CalendarPanel />}
          {sidebarPanel === "tags" && <TagPanel />}
          {sidebarPanel === "tasks" && tasks && <TaskAgendaPanel />}
          {sidebarPanel === "snapshots" && <VersionHistoryPanel />}
          {sidebarPanel === "skills-gallery" && <SkillGalleryPanel />}
          {sidebarPanel === "plugins" && <PluginMarketplace />}
          {sidebarPanel === "plugin" && <PluginPanelHost />}
          {sidebarPanel === "zettel" && zettelkasten && <ZettelHubPanel />}
        </div>
      </Suspense>
    </div>
  );
}
