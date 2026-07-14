// Activity Bar — VS Code style vertical icon bar
import type { ReactNode } from "react";

import {
  Blocks,
  Bookmark,
  BookText,
  BotMessageSquare,
  Calendar,
  CircleHelp,
  Clock,
  Folder,
  GitBranch,
  Image,
  Link,
  List,
  Puzzle,
  Search,
  Settings,
  Share2,
  StickyNote,
  Tag,
  Zap,
} from "lucide-react";
import { useShallow } from "zustand/shallow";

import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { useSettingsStore } from "../../stores/settings/store";
import {
  type RightPanelMode,
  type SidebarPanel,
  useUIStore,
} from "../../stores/ui/ui";

const ICON_PROPS = { size: 22, strokeWidth: 1.5 } as const;

const PANEL_ICONS: { icon: ReactNode; id: SidebarPanel; label: string }[] = [
  { id: "files", label: "Files", icon: <Folder {...ICON_PROPS} /> },
  { id: "search", label: "Search", icon: <Search {...ICON_PROPS} /> },
  { id: "outline", label: "Outline", icon: <List {...ICON_PROPS} /> },
  { id: "backlinks", label: "Backlinks", icon: <Link {...ICON_PROPS} /> },
  { id: "bookmarks", label: "Bookmarks", icon: <Bookmark {...ICON_PROPS} /> },
  { id: "graph", label: "Graph View", icon: <Share2 {...ICON_PROPS} /> },
  { id: "git", label: "Source Control", icon: <GitBranch {...ICON_PROPS} /> },
  { id: "calendar", label: "Calendar", icon: <Calendar {...ICON_PROPS} /> },
  { id: "tags", label: "Tags", icon: <Tag {...ICON_PROPS} /> },
  { id: "zettel", label: "Zettel", icon: <StickyNote {...ICON_PROPS} /> },
  {
    id: "skills-gallery",
    label: "Skills Gallery",
    icon: <Zap {...ICON_PROPS} />,
  },
  { id: "plugins", label: "Plugins", icon: <Puzzle {...ICON_PROPS} /> },
];

const SettingsIcon = <Settings {...ICON_PROPS} />;
const AIChatIcon = <BotMessageSquare {...ICON_PROPS} />;
const HelpIcon = <CircleHelp {...ICON_PROPS} />;
const MemoriesIcon = <BookText {...ICON_PROPS} />;
const PhotoGalleryIcon = <Image {...ICON_PROPS} />;
const SnapshotsIcon = <Clock {...ICON_PROPS} />;

interface BottomItemDef {
  icon: ReactNode;
  mode?: RightPanelMode;
  panelId?: SidebarPanel;
  title: string;
}

const BOTTOM_ITEMS: Record<string, BottomItemDef> = {
  chat: { icon: AIChatIcon, title: "AI Chat (\u2318\u21E7A)", mode: "chat" },
  memories: { icon: MemoriesIcon, title: "Memories", mode: "memories" },
  "photo-gallery": {
    icon: PhotoGalleryIcon,
    title: "Photo Gallery (\u2318\u21E7P)",
    mode: "photo-gallery",
  },
  snapshots: {
    icon: SnapshotsIcon,
    title: "Version History",
    panelId: "snapshots",
  },
  help: { icon: HelpIcon, title: "Help", mode: "help" },
};

export function ActivityBar() {
  const {
    sidebarOpen,
    sidebarPanel,
    toggleSidebar,
    setSidebarPanel,
    toggleSettings,
    rightPanelOpen,
    rightPanelMode,
    toggleRightPanel,
    setRightPanelMode,
  } = useUIStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen,
      sidebarPanel: s.sidebarPanel,
      toggleSidebar: s.toggleSidebar,
      setSidebarPanel: s.setSidebarPanel,
      toggleSettings: s.toggleSettings,
      rightPanelOpen: s.rightPanelOpen,
      rightPanelMode: s.rightPanelMode,
      toggleRightPanel: s.toggleRightPanel,
      setRightPanelMode: s.setRightPanelMode,
    })),
  );
  const { activityBarConfig } = useSettingsStore();
  const { activePluginPanelId, sidebarPanels, setActivePluginPanelId } =
    usePluginUIStore(
      useShallow((s) => ({
        activePluginPanelId: s.activePluginPanelId,
        setActivePluginPanelId: s.setActivePluginPanelId,
        sidebarPanels: s.sidebarPanels,
      })),
    );

  const handlePanelClick = (panelId: SidebarPanel) => {
    if (!sidebarOpen) {
      setSidebarPanel(panelId);
      toggleSidebar();
    } else if (sidebarPanel === panelId) {
      toggleSidebar();
    } else {
      setSidebarPanel(panelId);
    }
  };

  // Dedicated handler — reusing handlePanelClick("plugin") would toggle-close
  // the sidebar when switching between two different plugin panels (it only
  // compares sidebarPanel, not activePluginPanelId).
  const handlePluginPanelClick = (panelId: string) => {
    const active = activePluginPanelId;
    setActivePluginPanelId(panelId);
    if (!sidebarOpen) {
      setSidebarPanel("plugin");
      toggleSidebar();
    } else if (sidebarPanel === "plugin" && active === panelId) {
      toggleSidebar(); // same panel already open → close
    } else {
      setSidebarPanel("plugin");
    }
  };

  const handleRightPanelClick = (mode: RightPanelMode) => {
    if (!rightPanelOpen) {
      setRightPanelMode(mode);
      toggleRightPanel();
    } else if (rightPanelMode === mode) {
      toggleRightPanel();
    } else {
      setRightPanelMode(mode);
    }
  };

  const visibleTopItems = activityBarConfig
    .filter((c) => c.section === "top" && c.visible)
    .map((c) => PANEL_ICONS.find((p) => p.id === c.id))
    .filter(Boolean) as { icon: ReactNode; id: SidebarPanel; label: string }[];

  const visibleBottomItems = activityBarConfig
    .filter((c) => c.section === "bottom" && c.visible)
    .map((c) => ({ ...BOTTOM_ITEMS[c.id], id: c.id }))
    .filter((item) => item.icon);

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        {visibleTopItems.map((item) => (
          <button
            className={`activity-bar-btn ${sidebarOpen && sidebarPanel === item.id ? "activity-bar-btn-active" : ""}`}
            key={item.id}
            onClick={() => handlePanelClick(item.id)}
            title={item.label}
          >
            {item.icon}
          </button>
        ))}
        {sidebarPanels.map((panel) => (
          <button
            className={`activity-bar-btn ${
              sidebarOpen &&
              sidebarPanel === "plugin" &&
              activePluginPanelId === panel.panelId
                ? "activity-bar-btn-active"
                : ""
            }`}
            key={panel.panelId}
            onClick={() => handlePluginPanelClick(panel.panelId)}
            title={panel.title}
          >
            {panel.icon ? (
              <span className="activity-bar-plugin-icon">{panel.icon}</span>
            ) : (
              <Blocks {...ICON_PROPS} />
            )}
          </button>
        ))}
      </div>
      <div className="activity-bar-bottom">
        {visibleBottomItems.map((item) => (
          <button
            className={`activity-bar-btn ${
              item.panelId
                ? sidebarOpen && sidebarPanel === item.panelId
                  ? "activity-bar-btn-active"
                  : ""
                : rightPanelOpen && rightPanelMode === item.mode
                  ? "activity-bar-btn-active"
                  : ""
            }`}
            key={item.id}
            onClick={() => {
              if (item.panelId) {
                handlePanelClick(item.panelId);
              } else if (item.mode) {
                handleRightPanelClick(item.mode);
              }
            }}
            title={item.title}
          >
            {item.icon}
          </button>
        ))}
        <button
          className="activity-bar-btn"
          onClick={() => toggleSettings()}
          title="Settings"
        >
          {SettingsIcon}
        </button>
      </div>
    </div>
  );
}
