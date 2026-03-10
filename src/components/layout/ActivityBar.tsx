// Activity Bar — VS Code style vertical icon bar
import type { ReactNode } from "react";

import { useSettingsStore } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";

type PanelId =
  | "backlinks"
  | "bookmarks"
  | "calendar"
  | "files"
  | "git"
  | "graph"
  | "outline"
  | "plugins"
  | "search"
  | "skills-gallery"
  | "snapshots"
  | "tags";

const PANEL_ICONS: { icon: ReactNode; id: PanelId; label: string }[] = [
  {
    id: "files",
    label: "Files",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "search",
    label: "Search",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" x2="16.65" y1="21" y2="16.65" />
      </svg>
    ),
  },
  {
    id: "outline",
    label: "Outline",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <line x1="8" x2="21" y1="6" y2="6" />
        <line x1="8" x2="21" y1="12" y2="12" />
        <line x1="8" x2="21" y1="18" y2="18" />
        <line x1="3" x2="3.01" y1="6" y2="6" />
        <line x1="3" x2="3.01" y1="12" y2="12" />
        <line x1="3" x2="3.01" y1="18" y2="18" />
      </svg>
    ),
  },
  {
    id: "backlinks",
    label: "Backlinks",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
  {
    id: "bookmarks",
    label: "Bookmarks",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "graph",
    label: "Graph View",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="18" r="3" />
        <line x1="8.5" x2="15.5" y1="7.5" y2="16.5" />
        <line x1="15.5" x2="8.5" y1="7.5" y2="16.5" />
        <line x1="6" x2="6" y1="9" y2="15" />
      </svg>
    ),
  },
  {
    id: "git",
    label: "Source Control",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <line x1="8" x2="8" y1="5" y2="19" />
        <path d="M8 16c3 0 5-3 8-5" />
        <circle cx="8" cy="5" r="2" />
        <circle cx="16" cy="11" r="2" />
        <circle cx="8" cy="19" r="2" />
      </svg>
    ),
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <rect height="18" rx="2" ry="2" width="18" x="3" y="4" />
        <line x1="16" x2="16" y1="2" y2="6" />
        <line x1="8" x2="8" y1="2" y2="6" />
        <line x1="3" x2="21" y1="10" y2="10" />
      </svg>
    ),
  },
  {
    id: "tags",
    label: "Tags",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" x2="7.01" y1="7" y2="7" />
      </svg>
    ),
  },
  {
    id: "skills-gallery",
    label: "Skills Gallery",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: (
      <svg
        fill="none"
        height="22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        width="22"
      >
        <path d="M20 16V8a2 2 0 0 0-2-2h-3.5a1 1 0 0 1-1-1v0a2.5 2.5 0 0 0-5 0v0a1 1 0 0 1-1 1H4a2 2 0 0 0-2 2v3.5a1 1 0 0 0 1 1h0a2.5 2.5 0 0 1 0 5h0a1 1 0 0 0-1 1V20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-1.5a1 1 0 0 0-1-1h0a2.5 2.5 0 0 1 0-5h0a1 1 0 0 0 1-1z" />
      </svg>
    ),
  },
];

const SettingsIcon = (
  <svg
    fill="none"
    height="22"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 24 24"
    width="22"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const AIChatIcon = (
  <svg
    fill="none"
    height="22"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="1 1 22 22"
    width="22"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <text
      dominantBaseline="central"
      fill="currentColor"
      fontFamily="system-ui, sans-serif"
      fontSize="8"
      fontWeight="700"
      stroke="none"
      textAnchor="middle"
      x="12"
      y="10"
    >
      AI
    </text>
  </svg>
);

const HelpIcon = (
  <svg
    fill="none"
    height="22"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 24 24"
    width="22"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" x2="12.01" y1="17" y2="17" />
  </svg>
);

const MemoriesIcon = (
  <svg
    fill="none"
    height="22"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 24 24"
    width="22"
  >
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    <line x1="9" x2="16" y1="7" y2="7" />
    <line x1="9" x2="14" y1="11" y2="11" />
  </svg>
);

const PhotoGalleryIcon = (
  <svg
    fill="none"
    height="22"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 24 24"
    width="22"
  >
    <rect height="18" rx="2" ry="2" width="18" x="3" y="3" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const SnapshotsIcon = (
  <svg
    fill="none"
    height="22"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
    viewBox="0 0 24 24"
    width="22"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

interface BottomItemDef {
  icon: ReactNode;
  mode?: RightPanelMode;
  panelId?: PanelId;
  title: string;
}

type RightPanelMode =
  | "chat"
  | "help"
  | "memories"
  | "none"
  | "photo-gallery"
  | "properties";

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
  } = useUIStore();
  const { activityBarConfig } = useSettingsStore();

  const handlePanelClick = (panelId: PanelId) => {
    if (!sidebarOpen) {
      setSidebarPanel(panelId);
      toggleSidebar();
    } else if (sidebarPanel === panelId) {
      toggleSidebar();
    } else {
      setSidebarPanel(panelId);
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
    .filter(Boolean) as { icon: ReactNode; id: PanelId; label: string }[];

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
