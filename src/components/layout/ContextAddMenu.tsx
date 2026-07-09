// §82 Context add dropdown menu
import { useCallback, useEffect, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import { FileText, Folder } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { initVault } from "../../ipc/context";
import { useContextStore } from "../../stores/context/context";
import { addFolder } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { logger } from "../../utils/logger";
import { openFileByPath } from "../../utils/open-file";
import { basename } from "../../utils/path-utils";
import { openRecentFile, openRecentFolder } from "../../utils/recent-open";

interface Props {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export function ContextAddMenu({ onClose, anchorRef }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const { t } = useTranslation();

  const { recentFolders, recentFiles, clearRecent } = useSettingsStore(
    useShallow((s) => ({
      recentFolders: s.recentFolders,
      recentFiles: s.recentFiles,
      clearRecent: s.clearRecent,
    })),
  );
  const contexts = useContextStore((s) => s.contexts);
  const isVaultPath = (p: string) =>
    contexts.some((c) => c.contextType === "vault" && c.path === p);

  const hasRecents = recentFolders.length > 0 || recentFiles.length > 0;

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setStyle({ left: rect.left, top: rect.bottom + 2 });
    }
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  const handleOpenFolder = useCallback(async () => {
    onClose();
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        await addFolder(selected as string);
      }
    } catch (err) {
      logger.error("[ContextAddMenu] openFolder failed:", err);
    }
  }, [onClose]);

  const handleOpenFile = useCallback(async () => {
    onClose();
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (selected) {
        await openFileByPath(selected as string);
      }
    } catch (err) {
      logger.error("[ContextAddMenu] openFile failed:", err);
    }
  }, [onClose]);

  const handleInitVault = useCallback(async () => {
    onClose();
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        const path = selected as string;
        const folderName = basename(path) || "vault";
        await initVault(path, folderName);
        await addFolder(path);
      }
    } catch (err) {
      logger.error("[ContextAddMenu] initVault failed:", err);
    }
  }, [onClose]);

  return (
    <div className="context-add-menu" ref={menuRef} style={style}>
      <button className="context-add-menu__item" onClick={handleOpenFolder}>
        Open Folder…
      </button>
      <button className="context-add-menu__item" onClick={handleOpenFile}>
        Open File…
      </button>
      <div className="context-add-menu__sep" />
      <button className="context-add-menu__item" onClick={handleInitVault}>
        Initialize as Vault…
      </button>

      {hasRecents && <div className="context-add-menu__sep" />}

      {recentFolders.length > 0 && (
        <>
          <div className="context-add-menu__label">{t("recent.folders")}</div>
          {recentFolders.slice(0, 5).map((f) => {
            const vault = f.isVault === true || isVaultPath(f.path);
            return (
              <button
                className="context-add-menu__item context-add-menu__item--recent"
                key={f.path}
                onClick={() => {
                  onClose();
                  void openRecentFolder(f.path);
                }}
                title={f.path}
              >
                <Folder className="context-add-menu__icon" size={14} />
                <span className="context-add-menu__text">
                  {basename(f.path)}
                </span>
                {vault && (
                  <span className="context-add-menu__badge">
                    {t("recent.vaultBadge")}
                  </span>
                )}
              </button>
            );
          })}
        </>
      )}

      {recentFiles.length > 0 && (
        <>
          <div className="context-add-menu__label">{t("recent.files")}</div>
          {recentFiles.slice(0, 5).map((f) => (
            <button
              className="context-add-menu__item context-add-menu__item--recent"
              key={f.path}
              onClick={() => {
                onClose();
                void openRecentFile(f.path);
              }}
              title={f.path}
            >
              <FileText className="context-add-menu__icon" size={14} />
              <span className="context-add-menu__text">{basename(f.path)}</span>
            </button>
          ))}
        </>
      )}

      {hasRecents && (
        <>
          <div className="context-add-menu__sep" />
          <button
            className="context-add-menu__item context-add-menu__item--muted"
            onClick={() => clearRecent()}
          >
            {t("recent.clear")}
          </button>
        </>
      )}
    </div>
  );
}
