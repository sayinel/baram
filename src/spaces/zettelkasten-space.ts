import type { SpaceDefinition } from "./types";

import { readFile } from "../ipc/invoke";
import { openFileInTab } from "../services/journal-file-service";
import { useContextStore } from "../stores/context/context";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { refreshZettelIndex } from "../stores/zettelkasten/zettel-index";
import { resolveZettelDir } from "../utils/zettelkasten/zettelkasten";

/** Resolve the configured home note to an absolute path under `resolvedDir` (mirrors `resolveZettelDir`'s absolute-path check). */
function resolveHomeNotePath(resolvedDir: string, homeNote: string): string {
  if (homeNote.startsWith("/") || /^[A-Z]:\\/.test(homeNote)) return homeNote;
  return `${resolvedDir}/${homeNote}`;
}

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
    const {
      zettelkastenEnabled,
      zettelkastenDirectory,
      zettelkastenStartupBehavior,
      zettelkastenHomeNote,
    } = useSettingsStore.getState();
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

    // §98 "nothing" → only ensure the context (done above); no index refresh
    // or file open beyond what ensureSpaceContext already does.
    if (zettelkastenStartupBehavior !== "openInbox") return;

    try {
      await refreshZettelIndex(resolvedDir);
    } catch {
      /* non-fatal */
    }

    if (!zettelkastenHomeNote) return;
    const homePath = resolveHomeNotePath(resolvedDir, zettelkastenHomeNote);
    try {
      const content = await readFile(homePath);
      await openFileInTab(homePath, content);
    } catch {
      // Home note missing/unreadable — leave the inbox as the active file
      // tree (do NOT auto-open an arbitrary inbox file).
    }
  },
};
