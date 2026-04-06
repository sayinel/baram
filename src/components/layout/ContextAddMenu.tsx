// §82 Context add dropdown menu
import { useCallback, useEffect, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import { initVault } from "../../ipc/context";
import { readFile } from "../../ipc/fs";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { addFolder, useFileStore } from "../../stores/file/file";
import { logger } from "../../utils/logger";

interface Props {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export function ContextAddMenu({ onClose, anchorRef }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

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
        const filePath = selected as string;
        const contextStore = useContextStore.getState();
        const ctx = await contextStore.ensureFileContext(filePath);
        const content = await readFile(filePath);
        const fileName = filePath.split("/").pop() ?? "Untitled";
        useEditorStore.getState().openTab({
          id: crypto.randomUUID(),
          filePath,
          title: fileName,
          isDirty: false,
          isPinned: false,
          contextId: ctx.id,
        });
        useFileStore.getState().setFileContent(filePath, content);
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
        const folderName = path.split("/").pop() ?? "vault";
        // Initialize .baram/config.json
        await initVault(path, folderName);
        // Open as vault context
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
    </div>
  );
}
