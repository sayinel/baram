// §206 App update dialog — shown after a manual check finds an update, or
// when the user opens it from the "Update to vX" button (General tab).
import { useCallback, useEffect, useState } from "react";

import { getVersion } from "@tauri-apps/api/app";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { installAppUpdate } from "../../services/app-update";
import { useAppUpdateStore } from "../../stores/system/app-update";

export function UpdateDialog() {
  const { t } = useTranslation();
  const {
    dialogOpen,
    closeDialog,
    status,
    availableVersion,
    notes,
    progress,
    error,
    fallbackOpened,
  } = useAppUpdateStore(
    useShallow((s) => ({
      dialogOpen: s.dialogOpen,
      closeDialog: s.closeDialog,
      status: s.status,
      availableVersion: s.availableVersion,
      notes: s.notes,
      progress: s.progress,
      error: s.error,
      fallbackOpened: s.fallbackOpened,
    })),
  );
  const [currentVersion, setCurrentVersion] = useState("");

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setCurrentVersion(v);
      })
      .catch(() => {
        /* non-Tauri context (e.g. tests) — leave version blank */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // §206-review: read fresh state via getState() rather than closing over
  // `status`/`closeDialog` from render scope — this listener is attached once
  // per dialogOpen mount (see the effect below) and must not act on a stale
  // "not busy" snapshot from when it was first attached. Without this, Escape
  // during a Windows/Linux download would close the dialog while
  // downloadAndInstall()/relaunch() keep running in the background.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const s = useAppUpdateStore.getState();
    if (s.status === "downloading" || s.status === "installing") return;
    s.closeDialog();
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialogOpen, handleKeyDown]);

  if (!dialogOpen) return null;

  const busy = status === "downloading" || status === "installing";
  const mac = isMacPlatform();
  const percent =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;

  return (
    <div
      className="update-dialog-overlay"
      onClick={() => {
        if (busy) return;
        closeDialog();
      }}
    >
      <div className="update-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="update-dialog-title">{t("update.dialog.title")}</div>
        <div className="update-dialog-versions">
          {t("update.dialog.versionChange")
            .replace("{current}", currentVersion)
            .replace("{available}", availableVersion ?? "")}
        </div>
        {notes && <pre className="update-dialog-notes">{notes}</pre>}
        {status === "error" && (
          <div className="update-dialog-error">
            <div className="update-dialog-error-title">
              {t("update.dialog.error.title")}
            </div>
            <div className="update-dialog-error-message">
              {fallbackOpened
                ? t("update.dialog.error.fallbackOpened")
                : t("update.dialog.error.generic").replace(
                    "{message}",
                    error ?? "",
                  )}
            </div>
          </div>
        )}
        {busy && (
          <div className="update-dialog-progress">
            <div className="update-dialog-progress-track">
              <div
                className="update-dialog-progress-fill"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            <span className="update-dialog-progress-label">
              {status === "installing"
                ? t("update.dialog.installing")
                : t("update.dialog.downloading")}
            </span>
          </div>
        )}
        <div className="update-dialog-actions">
          <button
            className="btn-unstyled update-dialog-cancel"
            disabled={busy}
            onClick={closeDialog}
          >
            {t("common.close")}
          </button>
          <button
            className={`update-dialog-primary${busy ? "update-dialog-primary--busy" : ""}`}
            disabled={busy}
            onClick={() => {
              installAppUpdate().catch(() => {
                /* errors are surfaced via the store's error status */
              });
            }}
          >
            {mac
              ? t("update.dialog.download")
              : t("update.dialog.installRestart")}
          </button>
        </div>
      </div>
    </div>
  );
}

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.includes("Mac");
}
