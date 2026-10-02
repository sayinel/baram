// §81 The file the user was last looking at — what On Launch = "Restore last file"
// reopens — and the head of the recent-files list, recorded from the editor's
// active file tab.
//
// Both used to be set to a file by `openFileByPath` alone, while most openers (the
// file tree, the quick switcher, search, backlinks, the graph, the calendar, …) put a
// tab on screen through `openTab` — directly, or through `openFileInTab` — and
// recorded nothing: "Restore last file" reopened whatever `openFileByPath` happened
// to see last. This recorder is now the code that sets them to a file. Other
// writers take things away and stay as they were: `closeFolder`
// (`stores/file/file.ts`) clears `lastOpenedFile`; `removeRecentFile` (a recent file
// that failed to open, `utils/recent-open.ts`) and `clearRecent` (the "+" menu, the
// native Open Recent menu) empty the list.
//
// ‼️ A subscription, not a write inside the store's tab actions. In `editor.ts` the
// active tab is written by `openTab`, `setActiveTab`, `closeTab`, `closeOtherTabs`,
// `closeTabsToRight`, `closeTabsForContexts` and `closeAllTabs`, and a tab's path by
// `renameTab` and `renameDirInTabs` — but also from outside the store, through
// `useEditorStore.setState`: saving points a tab at the file it wrote that way — an
// untitled tab in `handleSave` and `saveDirtyTab` (`use-file-operations.ts`,
// `use-close-guard.ts`), any tab given a new path in `handleSaveAs`. A write placed in
// each action is a list the next door escapes; the subscription sees the outcome of
// every `set`, whoever made it.
//
// Started by `useAppStartup`, with the restore it serves, rather than at module
// evaluation (the way `stores/file/file.ts` mirrors the active context into
// `rootPath`): its lifetime is then the app's, and a test turns it on where it tests
// it instead of every editor-store test writing settings.
import type { EditorTab } from "./editor";

import { useSettingsStore } from "../settings/store";
import { isFileTab, useEditorStore } from "./editor";

interface ActiveTabSlice {
  activeTabId: null | string;
  tabs: EditorTab[];
}

/**
 * Start recording. Returns the unsubscribe.
 *
 * Only a file on disk is recorded: a graph, plugin or untitled tab (empty
 * `filePath`) becoming active leaves the last file as it was — it is still the
 * file the user last looked at. So does no tab at all.
 */
export function startLastOpenedFileRecorder(): () => void {
  return useEditorStore.subscribe((state, prev) => {
    // Most editor writes touch neither (dirty flags, selection, refresh keys).
    if (state.activeTabId === prev.activeTabId && state.tabs === prev.tabs) {
      return;
    }
    const path = activeFile(state);
    if (!path || path === activeFile(prev)) return;
    const { addRecentFile, lastOpenedFile, recentFiles } =
      useSettingsStore.getState();
    // Equality gate: already recorded at the head (the launch restore activating
    // `lastOpenedFile` itself). A `set` here would still be a new state root and a
    // persist write for nothing.
    if (lastOpenedFile === path && recentFiles[0]?.path === path) return;
    // `addRecentFile` sets `lastOpenedFile` too.
    addRecentFile(path);
  });
}

function activeFile(state: ActiveTabSlice): null | string {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  return isFileTab(tab) && tab.filePath ? tab.filePath : null;
}
