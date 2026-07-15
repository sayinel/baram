// §4.2 3-Column resizable layout
import { lazy, Suspense, useCallback } from "react";

import { useShallow } from "zustand/shallow";

import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { ActivityBar } from "./ActivityBar";
import { ContextTabBar } from "./ContextTabBar";
import { Sidebar } from "./Sidebar";
import { Splitter } from "./Splitter";

const AIChatPanel = lazy(() =>
  import("../ai/AIChatPanel").then((m) => ({
    default: m.AIChatPanel,
  })),
);
const HelpPanel = lazy(() =>
  import("../help/HelpPanel").then((m) => ({
    default: m.HelpPanel,
  })),
);
const MemoriesPanel = lazy(() =>
  import("../journal/MemoriesPanel").then((m) => ({
    default: m.MemoriesPanel,
  })),
);
const PhotoGalleryPanel = lazy(() =>
  import("../journal/PhotoGalleryPanel").then((m) => ({
    default: m.PhotoGalleryPanel,
  })),
);
const PropertiesPanel = lazy(() =>
  import("../sidebar/PropertiesPanel").then((m) => ({
    default: m.PropertiesPanel,
  })),
);

interface AppLayoutProps {
  children: React.ReactNode;
  statusBar?: React.ReactNode;
}

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 480;
const MIN_RIGHT_PANEL = 200;
const MAX_RIGHT_PANEL = 500;

export function AppLayout({ children, statusBar }: AppLayoutProps) {
  const {
    sidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    rightPanelOpen,
    rightPanelWidth,
    setRightPanelWidth,
  } = useUIStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen,
      sidebarWidth: s.sidebarWidth,
      setSidebarWidth: s.setSidebarWidth,
      rightPanelOpen: s.rightPanelOpen,
      rightPanelWidth: s.rightPanelWidth,
      setRightPanelWidth: s.setRightPanelWidth,
    })),
  );
  const rootPath = useFileStore((s) => s.rootPath);

  // §89 Sidebar visibility follows the ACTIVE CONTEXT (via rootPath), not the
  // active editor tab. rootPath is set for vault/folder contexts and cleared for
  // standalone FileContexts, so the sidebar hides while an external file is
  // focused and reappears when a Vault Tab is clicked (switchContext restores
  // rootPath). Keying this off the active tab left the flag stuck hidden when
  // the context changed but the external file tab stayed active.
  const showSidebar = !!rootPath && sidebarOpen;

  const handleSidebarResize = useCallback(
    (delta: number) => {
      const current = useUIStore.getState().sidebarWidth;
      setSidebarWidth(
        Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, current + delta)),
      );
    },
    [setSidebarWidth],
  );

  const handleRightPanelResize = useCallback(
    (delta: number) => {
      // Right panel: negative delta means expanding (dragging left)
      const current = useUIStore.getState().rightPanelWidth;
      setRightPanelWidth(
        Math.min(MAX_RIGHT_PANEL, Math.max(MIN_RIGHT_PANEL, current - delta)),
      );
    },
    [setRightPanelWidth],
  );

  return (
    <div className="app-layout">
      {/* §82 Context Tab Bar — hidden when single context */}
      <ContextTabBar />
      {/* Body: sidebar + main + right panel */}
      <div className="app-layout-body">
        {/* Activity Bar — hidden when no folder open */}
        {!!rootPath && <ActivityBar />}

        {/* Left Sidebar */}
        {showSidebar && (
          <>
            <aside
              className="app-sidebar"
              style={{ width: `${sidebarWidth}px` }}
            >
              <Sidebar />
            </aside>
            <Splitter direction="horizontal" onResize={handleSidebarResize} />
          </>
        )}

        {/* Main Editor Area */}
        <div className="app-main">{children}</div>

        {/* Right Panel — hidden when no folder open */}
        {!!rootPath && rightPanelOpen && (
          <>
            <Splitter
              direction="horizontal"
              onResize={handleRightPanelResize}
            />
            <aside
              className="app-right-panel"
              style={{ width: `${rightPanelWidth}px` }}
            >
              <Suspense fallback={null}>
                <AIChatPanel />
                <HelpPanel />
                <MemoriesPanel />
                <PhotoGalleryPanel />
                <PropertiesPanel />
              </Suspense>
            </aside>
          </>
        )}
      </div>

      {/* Status Bar */}
      {statusBar}
    </div>
  );
}
