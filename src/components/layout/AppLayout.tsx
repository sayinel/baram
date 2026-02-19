// §4.2 3-Column resizable layout
import { useCallback } from "react";
import { useUIStore } from "../../stores/ui-store";
import { Splitter } from "./Splitter";
import { Sidebar } from "./Sidebar";
import { ActivityBar } from "./ActivityBar";
import type { Editor } from "@tiptap/react";

interface AppLayoutProps {
  editor: Editor | null;
  children: React.ReactNode;
  statusBar?: React.ReactNode;
}

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 480;
const MIN_RIGHT_PANEL = 200;
const MAX_RIGHT_PANEL = 500;

export function AppLayout({ editor, children, statusBar }: AppLayoutProps) {
  const {
    sidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    rightPanelOpen,
    rightPanelWidth,
    setRightPanelWidth,
  } = useUIStore();

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
        Math.min(
          MAX_RIGHT_PANEL,
          Math.max(MIN_RIGHT_PANEL, current - delta),
        ),
      );
    },
    [setRightPanelWidth],
  );

  return (
    <div className="app-layout">
      {/* Body: sidebar + main + right panel */}
      <div className="app-layout-body">
        {/* Activity Bar — always visible */}
        <ActivityBar />

        {/* Left Sidebar */}
        {sidebarOpen && (
          <>
            <aside
              className="app-sidebar"
              style={{ width: `${sidebarWidth}px` }}
            >
              <Sidebar editor={editor} />
            </aside>
            <Splitter direction="horizontal" onResize={handleSidebarResize} />
          </>
        )}

        {/* Main Editor Area */}
        <div className="app-main">
          {children}
        </div>

        {/* Right Panel */}
        {rightPanelOpen && (
          <>
            <Splitter direction="horizontal" onResize={handleRightPanelResize} />
            <aside
              className="app-right-panel"
              style={{ width: `${rightPanelWidth}px` }}
            >
              <div className="right-panel-placeholder">Right Panel</div>
            </aside>
          </>
        )}
      </div>

      {/* Status Bar */}
      {statusBar}
    </div>
  );
}
