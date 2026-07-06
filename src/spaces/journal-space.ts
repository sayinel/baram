import type { SpaceDefinition } from "./types";

import {
  ensureJournalFile,
  openFileInTab,
} from "../services/journal-file-service";
import { useContextStore } from "../stores/context/context";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { resolveJournalDir } from "../utils/journal/journal";

export const journalSpace: SpaceDefinition = {
  type: "journal",
  label: "Journal",
  maxInstances: 1,
  configFolders: ["daily"],
  layout: {
    sidebarOpen: true,
    sidebarPanel: "calendar",
    rightPanelOpen: true,
    rightPanelMode: "memories",
  },
  newFileFlow: async () => {
    const {
      journalDirectory,
      journalFilenameFormat,
      journalTemplatePath,
      journalUseHierarchy,
    } = useSettingsStore.getState();
    const { rootPath } = useFileStore.getState();
    const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
    if (!resolvedDir) return null;
    const result = await ensureJournalFile(new Date(), {
      journalDirectory,
      journalFilenameFormat,
      journalTemplatePath,
      journalUseHierarchy,
      rootPath: resolvedDir,
    });
    if (result) await openFileInTab(result.path, result.content);
    return result;
  },
  startup: async () => {
    const existingJournal = useContextStore.getState().journalContext();
    if (!existingJournal) return;
    const { journalEnabled, journalStartupBehavior, journalDirectory } =
      useSettingsStore.getState();
    if (
      !journalEnabled ||
      journalStartupBehavior !== "openJournal" ||
      !journalDirectory
    )
      return;
    const resolvedDir = resolveJournalDir(
      useFileStore.getState().rootPath ?? "",
      journalDirectory,
    );
    if (!resolvedDir) return;
    try {
      await useContextStore.getState().ensureJournalContext(resolvedDir);
    } catch {
      /* non-fatal */
    }
  },
};
