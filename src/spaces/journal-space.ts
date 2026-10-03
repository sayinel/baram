import type { SpaceDefinition } from "./types";

import {
  ensureJournalFile,
  openFileInTab,
} from "../services/journal-file-service";
import { reportSpaceDirectoryTaken } from "../services/space-context-migration";
import { useContextStore } from "../stores/context/context";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { resolveJournalDir } from "../utils/journal/journal";
import { logger } from "../utils/logger";

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
  startup: async (opts) => {
    const existingJournal = useContextStore.getState().journalContext();
    if (!existingJournal) return;
    const {
      journalEnabled,
      journalStartupBehavior,
      journalDirectory,
      journalFilenameFormat,
      journalTemplatePath,
      journalUseHierarchy,
    } = useSettingsStore.getState();
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
    let journal = existingJournal;
    try {
      // §81 Registers without taking the seat: activating here moved the vault
      // tab to the journal while the file tree stayed where the launch restore
      // had put it.
      journal = await useContextStore
        .getState()
        .ensureJournalContext(resolvedDir, { activate: false });
    } catch (err) {
      // Non-fatal — except that a directory already held by another context
      // is the one refusal the user must hear about, or the setting silently
      // never takes effect (issue 598). It is also terminal: today's entry
      // would be written into a space that does not exist.
      if (reportSpaceDirectoryTaken(err)) return;
    }
    // §81 "Open today's journal" is opened HERE, in the startup's order, and no
    // longer by `use-journal.ts` — from a React effect it raced the restore and
    // took the active tab whenever it landed. Created if it does not exist yet.
    try {
      const entry = await ensureJournalFile(new Date(), {
        journalDirectory,
        journalFilenameFormat,
        journalTemplatePath,
        journalUseHierarchy,
        rootPath: resolvedDir,
      });
      if (entry) {
        await openFileInTab(entry.path, entry.content, {
          activate: !opts?.background,
          contextId: journal.id,
        });
      }
    } catch (err) {
      // ‼️ error, not warn — `logger.warn` is gated on `import.meta.env.DEV`.
      logger.error("[journal] startup could not open today's entry:", err);
    }
  },
};
