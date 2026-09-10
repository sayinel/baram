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
  // §340 M-11 정정: bare `useUIStore()`는 스토어 전체를 구독해 무관한 UI write마다
  // (예: 우측 패널 크기 드래그) 이 컴포넌트를 재렌더한다. 필요한 건 이 필드 하나뿐.
  const sidebarPanel = useUIStore((s) => s.sidebarPanel);
  // I2 / §340 ⓑ (Fix E / M-1 정정: "저장된" · "첫 페인트가 이동 이펙트보다 빠르다"는
  // 근거가 틀렸다 — `useUIStore`엔 persist가 없어 재하이드레이션이 없다) sidebarPanel
  // 이 꺼진 기능의 좌석을 가리킬 수 있는 진짜 경로: 이동 이펙트(ⓐ, 네 기능 플래그
  // 변화에만 반응)가 볼 수 없는 writer — 가장 직접적인 예가 커스텀 워크스페이스
  // 프리셋(`workspace.ts`의 `customPresets`)이다. 이쪽은 sidebarPanel까지 함께
  // 복원하고, **진짜로** 영속된다(재시작을 넘어 산다).
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
