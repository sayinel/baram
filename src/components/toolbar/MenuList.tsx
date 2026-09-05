// §4.8 — Presentational context-menu list. Owns viewport clamping, outside-click,
// and Escape close so ContextMenu (right-click), TableToolbar (the ⋯ overflow
// popup) and GraphView share one look + behavior.
//
// issue 542: the outside-click listener is in the CAPTURE phase. NodeView
// controls (the diagram blocks' hover toolbar, their caption) stop the native
// mousedown so ProseMirror will not select the block, and a bubble-phase
// listener never saw those clicks — the menu stayed open beside them. Capture
// runs before any stopPropagation. Mousedowns inside the menu itself, and
// inside the element that toggles it (`toggleRef`), leave it alone: the first
// because a click needs its menu, the second so a toggle button's click can
// decide open/close from state instead of racing the dismiss.
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { MenuItem } from "./context-menu-types";

import { onCloseAllContextMenus } from "../../utils/editor/context-menu-exclusive";

export interface MenuListProps {
  items: MenuItem[];
  onClose: () => void;
  /** The control that opens and closes this menu — a mousedown inside it does
   *  not dismiss, so its click sees the menu still open and can toggle. */
  toggleRef?: RefObject<HTMLElement | null>;
  x: number;
  y: number;
}

export function MenuList({ items, onClose, toggleRef, x, y }: MenuListProps) {
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
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (toggleRef?.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onKeyDown);
    // issue 521: a NodeView opening its own menu closes this one. (Its
    // right-button mousedown is visible in the capture phase now, but the
    // signal also covers a contextmenu with no mousedown at all.)
    const offCloseAll = onCloseAllContextMenus(onClose);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown, true);
      document.removeEventListener("keydown", onKeyDown);
      offCloseAll();
    };
  }, [onClose, toggleRef]);

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
