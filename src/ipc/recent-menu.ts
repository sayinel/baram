// §82 Native "Open Recent" submenu — assemble entries from the recent store,
// push them into the Rust menu, and route menu clicks back to open helpers.
import { invoke } from "@tauri-apps/api/core";

import type {
  RecentFileEntry,
  RecentFolderEntry,
} from "../stores/settings/general-settings";
import type { RecentMenuEntry } from "./types";

import { type Locale, t } from "../i18n";
import { useSettingsStore } from "../stores/settings/store";
import { basename } from "../utils/path-utils";
import { openRecentFile, openRecentFolder } from "../utils/recent-open";

const MAX_ITEMS = 5;
const FOLDER_PREFIX = "recent_folder:";
const FILE_PREFIX = "recent_file:";
const CLEAR_ID = "recent_clear";

/** Assemble the ordered menu-entry list mirroring the in-app '+' recent menu. */
export function buildRecentMenuEntries(
  folders: RecentFolderEntry[],
  files: RecentFileEntry[],
  locale: Locale,
): RecentMenuEntry[] {
  const topFolders = folders.slice(0, MAX_ITEMS);
  const topFiles = files.slice(0, MAX_ITEMS);
  if (topFolders.length === 0 && topFiles.length === 0) return [];

  const entries: RecentMenuEntry[] = [];

  if (topFolders.length > 0) {
    entries.push({
      kind: "item",
      label: t("recent.folders", locale),
      enabled: false,
    });
    for (const f of topFolders) {
      const label = f.isVault
        ? `${basename(f.path)} · ${t("recent.vaultBadge", locale)}`
        : basename(f.path);
      entries.push({ kind: "item", id: `${FOLDER_PREFIX}${f.path}`, label });
    }
  }

  if (topFiles.length > 0) {
    if (entries.length > 0) entries.push({ kind: "separator" });
    entries.push({
      kind: "item",
      label: t("recent.files", locale),
      enabled: false,
    });
    for (const f of topFiles) {
      entries.push({
        kind: "item",
        id: `${FILE_PREFIX}${f.path}`,
        label: basename(f.path),
      });
    }
  }

  entries.push({ kind: "separator" });
  entries.push({
    kind: "item",
    id: CLEAR_ID,
    label: t("recent.clear", locale),
  });
  return entries;
}

/** Route a "menu-event" payload if it belongs to the recent submenu. */
export function handleRecentMenuEvent(payload: string): boolean {
  if (payload.startsWith(FOLDER_PREFIX)) {
    void openRecentFolder(payload.slice(FOLDER_PREFIX.length));
    return true;
  }
  if (payload.startsWith(FILE_PREFIX)) {
    void openRecentFile(payload.slice(FILE_PREFIX.length));
    return true;
  }
  if (payload === CLEAR_ID) {
    useSettingsStore.getState().clearRecent();
    return true;
  }
  return false;
}

/** Push the current recent list into the native menu. */
export async function syncRecentMenu(): Promise<void> {
  const s = useSettingsStore.getState();
  const entries = buildRecentMenuEntries(
    s.recentFolders,
    s.recentFiles,
    s.locale as Locale,
  );
  await invoke("update_recent_menu", { entries });
}
