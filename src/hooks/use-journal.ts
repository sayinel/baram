// §56 Journal — startup auto-creation hook
import { useEffect, useRef } from "react";

import { createDir, readFile, writeFile } from "../ipc/invoke";
import { useFileStore } from "../stores/file-store";
import { useSettingsStore } from "../stores/settings-store";
import {
  applyJournalTemplate,
  generateDefaultJournal,
  getHierarchicalJournalPath,
  getJournalFilePath,
  resolveJournalDir,
} from "../utils/journal";

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
    const journalPath = journalUseHierarchy
      ? getHierarchicalJournalPath(resolvedDir, today, journalFilenameFormat)
      : getJournalFilePath(
          rootPath,
          journalDirectory,
          today,
          journalFilenameFormat,
        );
    if (!journalPath) return;

    (async () => {
      try {
        // Ensure journal directory exists — for hierarchical paths,
        // create the full parent directory (e.g. daily/YYYY/MM/)
        const fileDir = journalUseHierarchy
          ? journalPath.substring(0, journalPath.lastIndexOf("/"))
          : resolvedDir;
        await createDir(fileDir);

        // Check if today's journal already exists
        let exists = true;
        try {
          await readFile(journalPath);
        } catch {
          exists = false;
        }

        // Create journal if it doesn't exist
        if (!exists) {
          let content: string;
          if (journalTemplatePath) {
            try {
              const tpl = await readFile(journalTemplatePath);
              content = applyJournalTemplate(tpl, today);
            } catch {
              // Template read failed — use default
              content = generateDefaultJournal(today);
            }
          } else {
            content = generateDefaultJournal(today);
          }
          await writeFile(journalPath, content);
        }

        // Open journal if configured
        if (journalStartupBehavior === "openJournal") {
          await handleOpenFilePath(journalPath);
        }
      } catch (err) {
        console.error("[useJournal] Failed to create/open journal:", err);
      }
    })();
  }, [rootPath, handleOpenFilePath]);
}
