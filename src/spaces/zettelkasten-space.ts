import type { SpaceDefinition } from "./types";

import { useContextStore } from "../stores/context/context";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { resolveZettelDir } from "../utils/zettelkasten/zettelkasten";

export const zettelkastenSpace: SpaceDefinition = {
  type: "zettelkasten",
  label: "Zettelkasten",
  maxInstances: 1,
  configFolders: ["inbox", "notes"],
  layout: {
    sidebarOpen: true,
    sidebarPanel: "backlinks",
    rightPanelOpen: false,
    rightPanelMode: "none",
  },
  startup: async () => {
    const existing = useContextStore.getState().spaceContext("zettelkasten");
    if (!existing) return;
    const { zettelkastenEnabled, zettelkastenDirectory } =
      useSettingsStore.getState();
    if (!zettelkastenEnabled) return;
    const resolvedDir = resolveZettelDir(
      useFileStore.getState().rootPath ?? "",
      zettelkastenDirectory,
    );
    if (!resolvedDir) return;
    try {
      await useContextStore
        .getState()
        .ensureSpaceContext("zettelkasten", resolvedDir);
    } catch {
      /* non-fatal */
    }
  },
};
