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
  startup: async (opts) => {
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
    let space = existing;
    try {
      // §81 Registers the space without taking the seat, whatever the startup
      // behaviour. "openHomeNote" used to activate it — locally, so the vault
      // tab said Zettel while the file tree stayed on the folder the launch
      // restore had opened. The restore decides the seat; the preset that
      // enters the space switches to it before calling this.
      space = await useContextStore
        .getState()
        .ensureSpaceContext("zettelkasten", resolvedDir, {
          activate: false,
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
    // §81 Which context the tab belongs to — never whichever one holds the seat
    // (what `openTab` falls back to):
    // - In the background (the launch restore), the context that holds the file
    //   — the lookup `openFileByPath` makes — else the space. A home note set by
    //   absolute path in another context, tagged with the space, would switch the
    //   app to Zettel when selected; when it is also the last file, the launch
    //   restore would end there.
    // - In front (the Zettel preset, entering the space), the space: tagged with
    //   the folder holding the file, the note would switch the app straight back
    //   out of the space the preset just entered.
    const holder = opts?.background
      ? useContextStore.getState().getContextForPath(homePath)
      : null;
    const contextId =
      holder && holder.contextType !== "file" ? holder.id : space.id;
    try {
      const content = await readFile(homePath);
      await openFileInTab(homePath, content, {
        activate: !opts?.background,
        contextId,
      });
    } catch {
      // Home note missing/unreadable — leave the inbox as the active file
      // tree (do NOT auto-open an arbitrary inbox file).
    }
  },
};
