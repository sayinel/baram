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
  /**
   * The space's startup action, per its startup setting: register its context (§81
   * without activating it) and open its note. Does nothing unless the space's context
   * already exists (§89). Called by the launch restore, and by the Zettel preset
   * (`stores/file/workspace.ts`), which switches to the space first.
   */
  startup?: (opts?: SpaceStartupOptions) => Promise<void>;
  type: VaultType;
}

export interface SpaceLayout {
  rightPanelMode: RightPanelMode;
  rightPanelOpen: boolean;
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
}

export interface SpaceStartupOptions {
  /**
   * §81 Open the space's note behind the active tab. The launch restore passes it:
   * what it restores decides the seat, the file tree and the active tab, and the
   * space only adds its note for later. Entering the space by choice omits it.
   */
  background?: boolean;
}
