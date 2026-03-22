// §82 Context add dropdown menu
import { useCallback, useEffect, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import { addFolder } from "../../stores/file/file";
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

  return (
    <div className="context-add-menu" ref={menuRef} style={style}>
      <button className="context-add-menu__item" onClick={handleOpenFolder}>
        Open Folder…
      </button>
    </div>
  );
}
