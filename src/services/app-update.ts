// §206 App auto-update — check()/install() wrapper + periodic background
// checker. Every platform downloads, installs, and relaunches in place.
//
// macOS was notify-only until this change. The reason was that its releases were
// ad-hoc signed, which left the bundle no identity that survived a rebuild, so
// replacing it reset the TCC folder grant. release.yml has signed with a
// Developer ID certificate and notarized since v0.6.0, so that reason is gone.
//
// ‼️ The gate lived in the **running** app, so taking it out here changes nothing
// for a user updating away from a build that still has it — the first hop it
// governs is the one *out of* the release carrying this file. That is deliberate:
// it gives the signed-to-signed replace a release cycle to be verified before any
// user takes it. The procedure is in dev/guides/auto-update-206.md.
//
// Linux deb/rpm installs are unsupported by the updater plugin, so an install
// error there falls back to opening the releases page (mirrors
// src/plugins/update-checker.ts). That fallback is platform-independent — it is
// the only thing standing between a failed replace and a user with no way
// forward.
//
// ‼️ Installing ends this process, and no guard on that way out asks about unsaved work. On
// Windows the plugin's install starts the installer and calls `std::process::exit(0)`. On
// macOS and Linux `relaunch()` becomes `ExitRequested { code: Some(RESTART_EXIT_CODE) }`; the
// guard in src-tauri/src/lib.rs acts only on `code.is_none()`, and tauri ignores
// `prevent_exit` for that code anyway. So the question is asked here, in `installAppUpdate`.
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { hasUnsavedTabs } from "../hooks/use-close-guard";
import { type Locale, t } from "../i18n";
import { useSettingsStore } from "../stores/settings/store";
import { useAppUpdateStore } from "../stores/system/app-update";
import { useUIStore } from "../stores/ui/ui";
import { logger } from "../utils/logger";
import { relaunchApp, saveBeforeExit } from "./app-exit";

export const RELEASES_URL = "https://github.com/sayinel/baram/releases/latest";

const INITIAL_DELAY = 15_000; // 15 seconds after startup
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

let intervalId: null | ReturnType<typeof setInterval> = null;
/** The Update resource from the last successful check(), consumed by install. */
let pendingUpdate: null | Update = null;
/**
 * The Update holding a downloaded package, so a Cancel does not cost a second download. An install
 * takes it, and a later check() replaces `pendingUpdate`, which then downloads again.
 */
let downloadedUpdate: null | Update = null;
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

/**
 * Download the update found by the last checkForAppUpdate(), then install it — unless a tab
 * holds unsaved work, in which case the shared modal decides (`installDownloadedUpdate` is its
 * Save and Don't Save; on Cancel nothing runs and the package stays for the next attempt).
 *
 * The question comes after the download, not when the button is pressed: the app keeps running
 * through the download, and an edit made during it would be lost by a question already answered.
 */
export async function installAppUpdate(): Promise<void> {
  const store = useAppUpdateStore.getState();
  const update = pendingUpdate;
  if (!update) return;

  store.setDownloading();
  if (downloadedUpdate !== update) {
    downloadedBytes = 0;
    try {
      await update.download((event) => {
        switch (event.event) {
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
    } catch (err) {
      failInstall(err);
      return;
    }
    downloadedUpdate = update;
  }

  if (await hasUnsavedTabs()) {
    store.setInstallDeferred();
    // Another question keeps the screen. Replaced now, the button about to be pressed would answer
    // this one instead, and Don't Save for a quit would install and restart. Beneath the conflict
    // modal this one would still take the focus, so Enter there would install. The package stays,
    // so pressing Install again asks.
    const ui = useUIStore.getState();
    if (!ui.unsavedModal && !ui.conflictModal) {
      ui.openUnsavedModal({ intent: "installUpdate" });
    }
    return;
  }
  await installDownloadedUpdate();
}

/** Install the package `installAppUpdate` downloaded and relaunch. Does not ask about unsaved work. */
export async function installDownloadedUpdate(): Promise<void> {
  const store = useAppUpdateStore.getState();
  const update = downloadedUpdate;
  if (!update) return;
  // Taken either way: the plugin drops the package once it is installed, and a retry after a
  // failure starts over from the download, as it did when the two were one call.
  downloadedUpdate = null;

  // Escape, or Tab to its Close button, can close the dialog beneath the question. This is where
  // the progress and a failure show, so it comes back.
  store.openDialog();
  store.setInstalling();
  try {
    // §44 Save before installing, not only before the relaunch (#800): on Windows the
    // plugin's install starts the installer and ends the process right there
    // (`std::process::exit(0)` in tauri-plugin-updater's Windows `install_inner`), so
    // `relaunchApp` below is never reached. On macOS and Linux the install returns and the
    // relaunch saves again, which writes only what changed in between.
    await saveBeforeExit();
    await update.install();
  } catch (err) {
    failInstall(err);
    return;
  }
  // §44 The update is installed. Save the chat history and relaunch (#800). A failure from
  // here on is not an install failure — the releases page would only offer the same
  // version again — so it keeps the installed state and asks for a manual restart.
  try {
    await relaunchApp();
  } catch (err) {
    logger.warn("[AppUpdate] relaunch after install failed:", err);
    store.setInstalled();
  }
}

/**
 * One periodic tick: gated on the user's autoCheckUpdates setting (read at
 * call time, not captured, so a toggle mid-session takes effect immediately).
 * Exported separately so tests can exercise the setting gate independently of
 * the DEV gate in startAppUpdateChecker.
 *
 * It also skips the tick during an install: a check resets the status, which frees the dialog's
 * buttons mid-download, and its answer can close the dialog or change the version it shows, while
 * the open question's answer installs the package already downloaded.
 */
export function runPeriodicCheck(): void {
  if (!useSettingsStore.getState().autoCheckUpdates) return;
  const { status } = useAppUpdateStore.getState();
  if (status === "downloading" || status === "installing") return;
  if (useUIStore.getState().unsavedModal?.intent === "installUpdate") return;
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

/** Send the user to the releases page: a failed update must not leave them with no way forward. */
function failInstall(err: unknown): void {
  // e.g. Linux deb/rpm: in-app install is unsupported by the plugin.
  logger.warn("[AppUpdate] install failed:", err);
  openUrl(RELEASES_URL).catch(() => {
    /* best-effort fallback — nothing more we can do here */
  });
  useAppUpdateStore
    .getState()
    .setError(err instanceof Error ? err.message : String(err), true);
}
