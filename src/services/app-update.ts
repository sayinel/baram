// §206 App auto-update — check()/install() wrapper + periodic background
// checker. macOS has no Apple Developer signing yet, so it never replaces the
// app bundle: it only notifies and opens the releases page. Windows and
// Linux(AppImage) download, install, and relaunch. Linux deb/rpm installs are
// unsupported by the updater plugin, so an install error there falls back to
// opening the releases page too (mirrors src/plugins/update-checker.ts).
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { type Locale, t } from "../i18n";
import { useSettingsStore } from "../stores/settings/store";
import { useAppUpdateStore } from "../stores/system/app-update";
import { useUIStore } from "../stores/ui/ui";
import { logger } from "../utils/logger";

export const RELEASES_URL = "https://github.com/sayinel/baram/releases/latest";

const INITIAL_DELAY = 15_000; // 15 seconds after startup
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

let intervalId: null | ReturnType<typeof setInterval> = null;
/** The Update resource from the last successful check(), consumed by install. */
let pendingUpdate: null | Update = null;
let downloadedBytes = 0;

/**
 * Run check(); update the store and, for a manual check, surface a dialog
 * (update found) or toast (up to date / failed). Auto checks stay quiet on
 * "up to date"/error and only toast when an update is actually found.
 */
export async function checkForAppUpdate(manual: boolean): Promise<void> {
  const store = useAppUpdateStore.getState();
  store.setChecking();
  try {
    const update = await check();
    pendingUpdate = update;
    if (update) {
      store.setAvailable(update.version, update.body ?? null);
      if (manual) {
        store.openDialog();
      } else {
        useUIStore.getState().showToast(
          t("update.available.toast", currentLocale(), {
            version: update.version,
          }),
        );
      }
    } else {
      store.setUpToDate();
      if (manual) {
        useUIStore
          .getState()
          .showToast(t("update.upToDate.toast", currentLocale()));
      }
    }
  } catch (err) {
    logger.warn("[AppUpdate] check failed:", err);
    store.setError(err instanceof Error ? err.message : String(err));
    if (manual) {
      useUIStore
        .getState()
        .showToast(t("update.checkFailed.toast", currentLocale()), "error");
    }
  }
}

/** Install the update found by the last checkForAppUpdate() (macOS: notify-only). */
export async function installAppUpdate(): Promise<void> {
  const store = useAppUpdateStore.getState();
  const update = pendingUpdate;
  if (!update) return;

  if (isMacPlatform()) {
    openUrl(RELEASES_URL).catch((err) =>
      logger.warn("[AppUpdate] openUrl failed:", err),
    );
    return;
  }

  store.setDownloading();
  downloadedBytes = 0;
  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Finished":
          store.setInstalling();
          break;
        case "Progress":
          downloadedBytes += event.data.chunkLength;
          store.setProgress({
            downloaded: downloadedBytes,
            total: useAppUpdateStore.getState().progress?.total ?? null,
          });
          break;
        case "Started":
          store.setProgress({
            downloaded: 0,
            total: event.data.contentLength ?? null,
          });
          break;
      }
    });
    await relaunch();
  } catch (err) {
    // e.g. Linux deb/rpm: in-app install is unsupported by the plugin.
    logger.warn("[AppUpdate] install failed:", err);
    openUrl(RELEASES_URL).catch(() => {
      /* best-effort fallback — nothing more we can do here */
    });
    store.setError(err instanceof Error ? err.message : String(err), true);
  }
}

/**
 * One periodic tick: gated on the user's autoCheckUpdates setting (read at
 * call time, not captured, so a toggle mid-session takes effect immediately).
 * Exported separately so tests can exercise the setting gate independently of
 * the DEV gate in startAppUpdateChecker.
 */
export function runPeriodicCheck(): void {
  if (!useSettingsStore.getState().autoCheckUpdates) return;
  checkForAppUpdate(false).catch((err) =>
    logger.warn("[AppUpdate] Periodic check failed:", err),
  );
}

/** Start the periodic background checker (mirrors plugins/update-checker.ts). */
export function startAppUpdateChecker(): void {
  if (import.meta.env.DEV) return;
  if (intervalId) return;

  setTimeout(runPeriodicCheck, INITIAL_DELAY);
  intervalId = setInterval(runPeriodicCheck, CHECK_INTERVAL);
}

/** Stop the periodic background checker. */
export function stopAppUpdateChecker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function currentLocale(): Locale {
  return useSettingsStore.getState().locale as Locale;
}

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.includes("Mac");
}
