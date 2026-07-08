// §4.8 — Presentational context-menu list. Owns viewport clamping, outside-click,
// and Escape close so both ContextMenu (right-click) and TableSelectionHandles
// (grip popup) share one look + behavior.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { MenuItem } from "./context-menu-types";

export interface MenuListProps {
  items: MenuItem[];
  onClose: () => void;
  x: number;
  y: number;
}

export function MenuList({ items, onClose, x, y }: MenuListProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<null | { x: number; y: number }>(
    null,
  );

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth)
      nx = window.innerWidth - rect.width - 4;
    if (ny + rect.height > window.innerHeight)
      ny = window.innerHeight - rect.height - 4;
    if (nx < 0) nx = 4;
    if (ny < 0) ny = 4;
    setAdjusted({ x: nx, y: ny });
  }, [x, y, items]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const runItem = useCallback(
    (item: MenuItem) => {
      item.action();
      onClose();
    },
    [onClose],
  );

  const pos = adjusted ?? { x, y };

  return (
    <div
      className="context-menu"
      ref={menuRef}
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div className="context-menu-separator" key={i} />
        ) : (
          <button
            className="context-menu-item"
            key={i}
            onClick={() => runItem(item)}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
