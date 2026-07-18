// §4.3 Panel shown in the file tree when a folder cannot be read (macOS TCC / EACCES).
import { useState } from "react";

import { openUrl } from "@tauri-apps/plugin-opener";

import type { FileTreeLoadError } from "../../stores/file/file";

import { useTranslation } from "../../i18n/useTranslation";
import { logger } from "../../utils/logger";

const FULL_DISK_ACCESS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
const FILES_AND_FOLDERS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders";

export function FolderAccessError({
  loadError,
  onRetry,
}: {
  loadError: FileTreeLoadError;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const mac = isMacOS();
  const permission = loadError.kind === "permission-denied";

  return (
    <div className="file-tree-access-error" role="alert">
      <div aria-hidden="true" className="file-tree-access-error-icon">
        ⚠
      </div>
      <p className="file-tree-access-error-title">
        {t("fileTree.accessDenied.title")}
      </p>
      <p className="file-tree-access-error-body">
        {mac && permission
          ? t("fileTree.accessDenied.bodyMac")
          : t("fileTree.accessDenied.bodyGeneric")}
      </p>

      {mac && permission && (
        <div className="file-tree-access-error-actions">
          <button
            className="file-tree-access-error-btn primary"
            onClick={() => openSettings(FULL_DISK_ACCESS_URL)}
          >
            {t("fileTree.accessDenied.fullDiskAccess")}
          </button>
          <button
            className="file-tree-access-error-btn"
            onClick={() => openSettings(FILES_AND_FOLDERS_URL)}
          >
            {t("fileTree.accessDenied.filesAndFolders")}
          </button>
        </div>
      )}

      {mac && permission && (
        <button
          aria-expanded={showDetails}
          className="file-tree-access-error-disclosure btn-unstyled"
          onClick={() => setShowDetails((v) => !v)}
        >
          {showDetails ? "▾ " : "▸ "}
          {t("fileTree.accessDenied.details")}
        </button>
      )}
      {mac && permission && showDetails && (
        <ol className="file-tree-access-error-steps">
          <li>{t("fileTree.accessDenied.step1")}</li>
          <li>{t("fileTree.accessDenied.step2")}</li>
          <li>{t("fileTree.accessDenied.step3")}</li>
        </ol>
      )}

      <button className="file-tree-access-error-retry" onClick={onRetry}>
        {t("fileTree.accessDenied.retry")}
      </button>
    </div>
  );
}

function isMacOS(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
}

function openSettings(url: string): void {
  // Non-fatal: if the anchor is unsupported on this macOS version, the manual
  // steps remain visible as a fallback.
  openUrl(url).catch((e) => logger.warn("§4.3 openUrl failed", e));
}
