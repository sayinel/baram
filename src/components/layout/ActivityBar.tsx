// Activity Bar — VS Code style vertical icon bar
import type { ReactNode } from "react";

import {
  Blocks,
  Bookmark,
  BookText,
  BotMessageSquare,
  Calendar,
  CircleCheck,
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

import { useTranslation } from "../../i18n/useTranslation";
import { formatKeyForDisplay } from "../../keybindings/key-utils";
import { useKeybindings } from "../../keybindings/use-keybindings";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { useSettingsStore } from "../../stores/settings/store";
import {
  type RightPanelMode,
  type SidebarPanel,
  useUIStore,
} from "../../stores/ui/ui";
import { Tooltip } from "../Tooltip";

const ICON_PROPS = { size: 22, strokeWidth: 1.5 } as const;

/**
 * Every icon's words come from `settings.activitybar.item.<id>` — the same keys the Activity Bar
 * settings tab renders, so an item cannot be named one thing in the settings list and another on
 * the bar. `label-key-coverage.test.ts` derives its check from DEFAULT_ACTIVITY_BAR_CONFIG and so
 * covers both surfaces at once.
 */
function itemLabelKey(id: string): string {
  return `settings.activitybar.item.${id}`;
}

const PANEL_ICONS: { icon: ReactNode; id: SidebarPanel }[] = [
  { id: "files", icon: <Folder {...ICON_PROPS} /> },
  { id: "search", icon: <Search {...ICON_PROPS} /> },
  { id: "outline", icon: <List {...ICON_PROPS} /> },
  { id: "backlinks", icon: <Link {...ICON_PROPS} /> },
  { id: "bookmarks", icon: <Bookmark {...ICON_PROPS} /> },
  { id: "graph", icon: <Share2 {...ICON_PROPS} /> },
  { id: "git", icon: <GitBranch {...ICON_PROPS} /> },
  { id: "calendar", icon: <Calendar {...ICON_PROPS} /> },
  { id: "tags", icon: <Tag {...ICON_PROPS} /> },
  { id: "tasks", icon: <CircleCheck {...ICON_PROPS} /> },
  { id: "zettel", icon: <StickyNote {...ICON_PROPS} /> },
  {
    id: "skills-gallery",
    icon: <Zap {...ICON_PROPS} />,
  },
  { id: "plugins", icon: <Puzzle {...ICON_PROPS} /> },
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
}

const BOTTOM_ITEMS: Record<string, BottomItemDef> = {
  chat: { icon: AIChatIcon, mode: "chat" },
  memories: { icon: MemoriesIcon, mode: "memories" },
  "photo-gallery": {
    icon: PhotoGalleryIcon,
    mode: "photo-gallery",
  },
  snapshots: {
    icon: SnapshotsIcon,
    panelId: "snapshots",
  },
  help: { icon: HelpIcon, mode: "help" },
};

/**
 * Activity bar item id → the keybinding whose shortcut its label mentions.
 *
 * These two labels used to carry the shortcut as literal text (`"AI Chat (⌘⇧A)"`), which every
 * rebind turned into a lie — the keys are customizable, and nothing pointed the literal at the
 * command it claimed to describe. Resolved through the registry instead, so a remapped chat
 * panel re-labels itself. `activity-bar-labels.test.tsx` pins that both ids still exist.
 */
const SHORTCUT_COMMAND_IDS: Record<string, string> = {
  chat: "ai.chatPanel",
  "photo-gallery": "journal.photoGallery",
};

export function ActivityBar() {
  const { t } = useTranslation();
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
  const { activityBarConfig, tasksEnabled } = useSettingsStore(
    useShallow((s) => ({
      activityBarConfig: s.activityBarConfig,
      tasksEnabled: s.tasksEnabled,
    })),
  );
  const { activePluginPanelId, sidebarPanels, setActivePluginPanelId } =
    usePluginUIStore(
      useShallow((s) => ({
        activePluginPanelId: s.activePluginPanelId,
        setActivePluginPanelId: s.setActivePluginPanelId,
        sidebarPanels: s.sidebarPanels,
      })),
    );
  const keybindings = useKeybindings();
  const isMac = navigator.platform.includes("Mac");

  const labelFor = (id: string) => {
    const commandId = SHORTCUT_COMMAND_IDS[id];
    const entry = commandId
      ? keybindings.find((k) => k.id === commandId)
      : undefined;
    const name = t(itemLabelKey(id));
    return entry
      ? `${name} (${formatKeyForDisplay(entry.activeKey, isMac)})`
      : name;
  };

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
    // I2: tasksEnabled off hides the icon entirely, not just incremental updates.
    .filter((c) => c.id !== "tasks" || tasksEnabled)
    .map((c) => PANEL_ICONS.find((p) => p.id === c.id))
    .filter(Boolean) as { icon: ReactNode; id: SidebarPanel }[];

  const visibleBottomItems = activityBarConfig
    .filter((c) => c.section === "bottom" && c.visible)
    .map((c) => ({ ...BOTTOM_ITEMS[c.id], id: c.id }))
    .filter((item) => item.icon);

  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        {visibleTopItems.map((item) => (
          <Tooltip key={item.id} label={labelFor(item.id)}>
            <button
              className={`activity-bar-btn ${sidebarOpen && sidebarPanel === item.id ? "activity-bar-btn-active" : ""}`}
              onClick={() => handlePanelClick(item.id)}
            >
              {item.icon}
            </button>
          </Tooltip>
        ))}
        {sidebarPanels.map((panel) => (
          <Tooltip key={panel.panelId} label={panel.title}>
            <button
              className={`activity-bar-btn ${
                sidebarOpen &&
                sidebarPanel === "plugin" &&
                activePluginPanelId === panel.panelId
                  ? "activity-bar-btn-active"
                  : ""
              }`}
              onClick={() => handlePluginPanelClick(panel.panelId)}
            >
              {panel.icon ? (
                <span className="activity-bar-plugin-icon">{panel.icon}</span>
              ) : (
                <Blocks {...ICON_PROPS} />
              )}
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="activity-bar-bottom">
        {visibleBottomItems.map((item) => (
          <Tooltip key={item.id} label={labelFor(item.id)}>
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
              onClick={() => {
                if (item.panelId) {
                  handlePanelClick(item.panelId);
                } else if (item.mode) {
                  handleRightPanelClick(item.mode);
                }
              }}
            >
              {item.icon}
            </button>
          </Tooltip>
        ))}
        <Tooltip label={t("settings.title")}>
          <button className="activity-bar-btn" onClick={() => toggleSettings()}>
            {SettingsIcon}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
