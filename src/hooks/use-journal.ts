// §56 Journal — startup auto-creation hook
import { useEffect, useRef } from "react";

import { ensureJournalFile } from "../services/journal-file-service";
import { useContextStore } from "../stores/context/context";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { resolveJournalDir } from "../utils/journal/journal";
import { logger } from "../utils/logger";
import { launchRestoreSettled } from "./use-app-startup";

/**
 * On workspace open (rootPath change), auto-create today's journal
 * if journal is enabled and file doesn't exist yet.
 * §85 Ensures journal context is registered before file operations
 * so validate_path_any doesn't block journal directory access.
 *
 * §81 Creates only. Opening today's entry ("Open today's journal") is the journal
 * space's startup action (`spaces/journal-space.ts`), which the launch restore runs
 * in its order, behind the tab it restores. Opened from here it raced the restore —
 * this effect fires whenever `rootPath` changes — and took the active tab.
 *
 * §81 And it waits for the launch restore first. `rootPath` is first set when the
 * persisted contexts hydrate, before the restore has registered any of them in Rust,
 * which then refuses every path (`check_vault`, deny-by-default). A run at that
 * moment had its read of today's entry refused, took that for "no such file", had
 * the creation refused too, and the once-per-directory latch kept it from trying
 * again: with Journal "On Startup: nothing" no entry was made at launch. A later run
 * could race the journal startup's own creation. After the restore the journal
 * context is registered, and with "Open today's journal" the entry already exists.
 */
export function useJournal() {
  const rootPath = useFileStore((s) => s.rootPath);
  const didRunRef = useRef<null | string>(null);

  useEffect(() => {
    void (async () => {
      await launchRestoreSettled();
      // Read after the wait: the restore waited for the settings to hydrate.
      const {
        journalEnabled,
        journalDirectory,
        journalFilenameFormat,
        journalTemplatePath,
        journalUseHierarchy,
      } = useSettingsStore.getState();

      if (!journalEnabled) return;

      const resolvedDir = resolveJournalDir(rootPath, journalDirectory);
      if (!resolvedDir) return;

      // §89 Only auto-create journal files if a journal context already exists.
      // Don't recreate it if the user explicitly closed all contexts.
      const journalCtx = useContextStore.getState().journalContext();
      if (!journalCtx) return;

      // Only run once per resolved directory
      if (didRunRef.current === resolvedDir) return;
      didRunRef.current = resolvedDir;

      try {
        await ensureJournalFile(new Date(), {
          journalDirectory,
          journalFilenameFormat,
          journalTemplatePath,
          journalUseHierarchy,
          rootPath,
        });
      } catch (err) {
        logger.error("[useJournal] Failed to create journal:", err);
      }
    })();
  }, [rootPath]);
}
