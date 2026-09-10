// §4.2 3-Column resizable layout
import { lazy, Suspense, useCallback } from "react";

import { useShallow } from "zustand/shallow";

import { useFileStore } from "../../stores/file/file";
import { useFeatureFlags } from "../../stores/settings/features";
import { isRightPanelUsable } from "../../stores/ui/panel-feature";
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
    rightPanelMode,
    rightPanelWidth,
    setRightPanelWidth,
  } = useUIStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen,
      sidebarWidth: s.sidebarWidth,
      setSidebarWidth: s.setSidebarWidth,
      rightPanelOpen: s.rightPanelOpen,
      rightPanelMode: s.rightPanelMode,
      rightPanelWidth: s.rightPanelWidth,
      setRightPanelWidth: s.setRightPanelWidth,
    })),
  );
  const rootPath = useFileStore((s) => s.rootPath);
  const featureFlags = useFeatureFlags();

  // §340 ⓒ render-time filter (C-2 / I-1 / I-2): the right panel wrapper must not
  // render when the feature owning the CURRENT rightPanelMode is disabled — regardless
  // of whether ⓐ (the pointer-move effect in use-settings-effects.ts) has already fired.
  // ⓐ alone leaves two gaps open (see fix-b-brief.md): a mode set while ⓐ's deps didn't
  // change (skills-mode restoring a saved pointer) and a mode written straight into a
  // persisted preset (custom workspace layouts). Both leave `rightPanelOpen: true`
  // pointing at a hidden seat with no icon left to close it, since this branch hid the
  // three escape hatches (activity bar icon, chat shortcut, native menu) for a disabled
  // feature. Gating the render instead of relying on the pointer having moved closes
  // all three paths at once, the same principle this branch already applies to the
  // activity bar (`activityBarConfig` isn't mutated — visibility is filtered at render).
  const rightPanelUsable = isRightPanelUsable(rightPanelMode, featureFlags);

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
      {/* §82 Context Tab Bar — hidden only when NO vault/folder context is open.
          It stays up for a single one so the "+" that adds the next is reachable;
          `ContextTabBar` returns null on `visibleContexts.length === 0`. */}
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

        {/* Right Panel — hidden when no folder open, panel is closed, or the current
            mode's owning feature is off (§340 ⓒ, see rightPanelUsable above) */}
        {!!rootPath && rightPanelOpen && rightPanelUsable && (
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
