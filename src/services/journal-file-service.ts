// §56 Journal file service — shared open/create logic across journal entry points
import { createDir, readFile, writeFile } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import {
  applyJournalTemplate,
  generateDefaultJournal,
  getHierarchicalJournalPath,
  getJournalFilePath,
  resolveJournalDir,
} from "../utils/journal/journal";

export interface JournalFileOptions {
  journalDirectory: string;
  journalFilenameFormat: string;
  journalTemplatePath: null | string | undefined;
  journalUseHierarchy: boolean;
  rootPath?: null | string;
}

/**
 * Ensures a journal file for the given date exists (creating it from template
 * or default content if needed) and returns the resolved path and content.
 *
 * Does NOT open a tab — the caller decides what to do with the file.
 *
 * Returns null if the path cannot be resolved.
 */
export async function ensureJournalFile(
  date: Date,
  options: JournalFileOptions,
): Promise<null | { content: string; path: string }> {
  const {
    journalDirectory,
    journalFilenameFormat,
    journalTemplatePath,
    journalUseHierarchy,
    rootPath,
  } = options;

  const resolved = resolveJournalDir(rootPath ?? null, journalDirectory);
  if (!resolved) return null;

  const journalPath = journalUseHierarchy
    ? getHierarchicalJournalPath(resolved, date, journalFilenameFormat)
    : getJournalFilePath(
        rootPath ?? null,
        journalDirectory,
        date,
        journalFilenameFormat,
      );
  if (!journalPath) return null;

  let content: string;
  try {
    content = await readFile(journalPath);
  } catch {
    // File doesn't exist — create it
    const parentDir = journalPath.substring(0, journalPath.lastIndexOf("/"));
    await createDir(parentDir);

    if (journalTemplatePath) {
      try {
        const tpl = await readFile(journalTemplatePath);
        content = applyJournalTemplate(tpl, date);
      } catch {
        content = generateDefaultJournal(date);
      }
    } else {
      content = generateDefaultJournal(date);
    }

    await writeFile(journalPath, content);
  }

  return { path: journalPath, content };
}

/**
 * Opens a file in the editor tab bar.
 * If the file is already open, activates its existing tab.
 */
export async function openFileInTab(
  filePath: string,
  content: string,
): Promise<void> {
  const edStore = useEditorStore.getState();
  const existing = edStore.tabs.find((t) => t.filePath === filePath);
  if (existing) {
    // Only update the file content store when the tab is not dirty.
    // If the tab has unsaved edits, keep the user's in-progress changes.
    if (!existing.isDirty) {
      useFileStore.getState().setFileContent(filePath, content);
    }
    edStore.setActiveTab(existing.id);
  } else {
    useFileStore.getState().setFileContent(filePath, content);
    edStore.openTab({
      contextId: "",
      id: crypto.randomUUID(),
      filePath,
      title: filePath.split("/").pop() ?? "Journal",
      isDirty: false,
      isPinned: false,
    });
  }
}
