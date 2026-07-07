import type { VaultType } from "../ipc/types";
import type { RightPanelMode, SidebarPanel } from "../stores/ui/ui";

export interface SpaceDefinition {
  /** Folders to create under the vault root on first init (e.g. ["inbox","notes"]). */
  configFolders: string[];
  label: string;
  /** Sidebar/right-panel layout applied when this space's preset is opened. */
  layout: SpaceLayout;
  /** null = unlimited (general); 1 = at most one instance (journal, zettelkasten). */
  maxInstances: null | number;
  /** Create the space's "new note/file"; returns null if not applicable. */
  newFileFlow?: () => Promise<null | { content: string; path: string }>;
  /** App-startup action when this space is the active/restored context. */
  startup?: () => Promise<void>;
  type: VaultType;
}

export interface SpaceLayout {
  rightPanelMode: RightPanelMode;
  rightPanelOpen: boolean;
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
}
