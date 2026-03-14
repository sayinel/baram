// §56 Journal — startup auto-creation hook
import { useEffect, useRef } from "react";

import { ensureJournalFile } from "../services/journal-file-service";
import { useFileStore } from "../stores/file-store";
import { useSettingsStore } from "../stores/settings-store";
import { resolveJournalDir } from "../utils/journal/journal";
import { logger } from "../utils/logger";

/**
 * On workspace open (rootPath change), auto-create today's journal
 * if journal is enabled and file doesn't exist yet.
 */
export function useJournal(
  handleOpenFilePath: (path: string) => Promise<void>,
) {
  const rootPath = useFileStore((s) => s.rootPath);
  const didRunRef = useRef<null | string>(null);

  useEffect(() => {
    const {
      journalEnabled,
      journalDirectory,
      journalFilenameFormat,
      journalTemplatePath,
      journalStartupBehavior,
      journalUseHierarchy,
    } = useSettingsStore.getState();

    if (!journalEnabled) return;

    const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
    if (!resolvedDir) return;

    // Only run once per resolved directory
    if (didRunRef.current === resolvedDir) return;
    didRunRef.current = resolvedDir;

    const today = new Date();

    (async () => {
      try {
        const result = await ensureJournalFile(today, {
          journalDirectory,
          journalFilenameFormat,
          journalTemplatePath,
          journalUseHierarchy,
          rootPath,
        });

        // Open journal if configured
        if (result && journalStartupBehavior === "openJournal") {
          await handleOpenFilePath(result.path);
        }
      } catch (err) {
        logger.error("[useJournal] Failed to create/open journal:", err);
      }
    })();
  }, [rootPath, handleOpenFilePath]);
}
