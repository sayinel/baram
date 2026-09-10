import type { SpaceDefinition } from "./types";

import { readFile } from "../ipc/invoke";
import { openFileInTab } from "../services/journal-file-service";
import { reportSpaceDirectoryTaken } from "../services/space-context-migration";
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
  label: "Zettel",
  maxInstances: 1,
  configFolders: ["inbox", "notes"],
  layout: {
    sidebarOpen: true,
    sidebarPanel: "zettel",
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
      // §98 "nothing" registers the space without taking the seat; only
      // "openHomeNote" activates. Activating here regardless used to pass
      // unnoticed (a local seat change) — since issue 598 a moved directory
      // switches for real, and a user who asked for nothing must not boot
      // into the Zettel space.
      await useContextStore
        .getState()
        .ensureSpaceContext("zettelkasten", resolvedDir, {
          activate: zettelkastenStartupBehavior === "openHomeNote",
          label: "Zettel",
        });
    } catch (err) {
      // Non-fatal — except that a directory already held by another context
      // is the one refusal the user must hear about, or the setting silently
      // never takes effect (issue 598). It is also terminal: indexing that
      // directory or opening its home note would act on a space that does
      // not exist.
      if (reportSpaceDirectoryTaken(err)) return;
    }

    // §98 "nothing" → only ensure the context (done above); no index refresh
    // or file open beyond what ensureSpaceContext already does.
    if (zettelkastenStartupBehavior !== "openHomeNote") return;

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
