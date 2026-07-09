// §82 Open a recent folder/file. On failure (deleted/moved path) the entry is
// removed from recents and the user is toasted — self-healing the stale list.
import type { Locale } from "../i18n";

import { t } from "../i18n";
import { addFolder } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import { openFileByPath } from "./open-file";
import { basename } from "./path-utils";

export async function openRecentFile(path: string): Promise<void> {
  try {
    await openFileByPath(path);
  } catch {
    useSettingsStore.getState().removeRecentFile(path);
    toastNotFound(path);
  }
}

export async function openRecentFolder(path: string): Promise<void> {
  try {
    await addFolder(path);
  } catch {
    useSettingsStore.getState().removeRecentFolder(path);
    toastNotFound(path);
  }
}

function toastNotFound(path: string): void {
  const { locale } = useSettingsStore.getState();
  useUIStore
    .getState()
    .showToast(
      t("recent.notFound", locale as Locale, { name: basename(path) }),
    );
}
