// §56 Journal file service — shared open/create logic across journal entry points
import { createDir, readFile, writeFile } from "../ipc/invoke";
import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { maybeRefreshForPath } from "../stores/zettelkasten/zettel-index";
import {
  applyJournalTemplate,
  generateDefaultJournal,
  getHierarchicalJournalPath,
  getJournalFilePath,
  resolveJournalDir,
} from "../utils/journal/journal";
import {
  notifyJournalChanged,
  requestJournalBodyCursor,
} from "../utils/journal/journal-events";
import { logger } from "../utils/logger";
import { resolveZettelDir } from "../utils/zettelkasten/zettelkasten";

export interface JournalFileOptions {
  journalDirectory: string;
  journalFilenameFormat: string;
  journalTemplatePath: null | string | undefined;
  journalUseHierarchy: boolean;
  rootPath?: null | string;
}

/**
 * Make the journal directory known to the backend before any filesystem call on it.
 *
 * `resolveJournalDir` accepts absolute paths only, so the journal directory can sit
 * outside the open vault, and there `check_vault` permits nothing until the journal
 * context exists (the Rust ContextManager is in-memory; startup re-registers only the
 * contexts the store already persisted). Six call sites write under this directory and
 * five of them used to skip registration — the shortcut, the calendar, Alt+←/→ day
 * navigation, date-wikilink navigation (`use-navigation.ts`) and the startup hook —
 * each failing identically: readFile denied, read as "no such file", createDir denied,
 * swallowed by the caller's catch. Only the journal space registered.
 *
 * ‼️ Registers WITHOUT activating. `ensureSpaceContext` used to activate
 * unconditionally, and the subscription in `stores/file/file.ts` syncs `rootPath`
 * without loading the tree (the zettel preset compensates with an explicit
 * `switchContext`) — so activating from here would repoint `rootPath` at the journal
 * while the sidebar still showed the previous vault, and "New file" in that tree would
 * write into the journal directory. Switching spaces stays the preset's job.
 *
 * A failure is logged and swallowed on purpose: the following filesystem call then
 * produces the real error instead of being masked by a context error. ‼️ Known gap: the
 * backend refuses to register a path that does not exist, so a journal directory that
 * was deleted, renamed or lives on an unmounted volume still ends in the silent no-op
 * described above — the write cannot create it either. Tracked in dev/backlog.md.
 *
 * §89 note: creating the context here can bring back a journal context the user closed.
 * That is accepted for EXPLICIT requests (a calendar day, Alt+←/→, a date wikilink, the
 * shortcut): a write outside the vault requires a registered context, so refusing would
 * mean refusing what the user just asked for. Activation is what made the old behaviour
 * intrusive, and that is gone. The automatic paths keep their own §89 guards and check
 * `journalContext()` before calling in (`use-journal.ts`, `spaces/journal-space.ts`).
 */
export async function ensureJournalDirRegistered(
  journalDir: string,
): Promise<void> {
  try {
    await useContextStore
      .getState()
      .ensureJournalContext(journalDir, { activate: false });
  } catch (err) {
    logger.warn("[journal] journal context registration failed:", err);
  }
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

  await ensureJournalDirRegistered(resolved);

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

    // A new entry now exists on disk — refresh the calendar dots / Memories,
    // and ask the editor to drop the caret on a body line below the date title
    // once this template loads (§56 journal-events).
    notifyJournalChanged();
    requestJournalBodyCursor(journalPath);
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

  // Seed the self-write baseline so the creation/open echo from the watcher
  // (and this app's own subsequent saves) are not mistaken for external
  // changes. Without this, a just-created/opened note's writeFile echo trips
  // the conflict/auto-reload path. (use-file-watcher.ts self-write guard.)
  useFileStore.getState().updateLastSaveMtime(filePath, Date.now());

  // §95 M2: populate the zettel id index when opening a note under the
  // zettel space, even if it was reached without activating the
  // "zettelkasten" workspace preset. No-op for non-zettel paths (see
  // maybeRefreshForPath) — cheap for the common (non-zettel) case.
  const { zettelkastenDirectory } = useSettingsStore.getState();
  const { rootPath } = useFileStore.getState();
  maybeRefreshForPath(
    filePath,
    resolveZettelDir(rootPath, zettelkastenDirectory),
  ).catch(() => {});
}
