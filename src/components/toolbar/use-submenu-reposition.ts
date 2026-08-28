import { type RefObject, useCallback, useLayoutEffect } from "react";

import { getEditorZoom } from "../../utils/zoom-coords";

// §4.8 Clamp the dropdown to the viewport. The menu is position:fixed and
// opens downward from the handle, so near the window bottom it would be cut
// off at the app window edge. Layout effect → repositioned before paint (no
// flash at the unclamped spot). rect is visual-viewport px while style.top
// is a pre-zoom coordinate (see handlePos in BlockHandle), so the measured
// overflow is divided by zoom before applying.
export function useMenuViewportClamp(
  menuRef: RefObject<HTMLDivElement | null>,
): void {
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const zoom = getEditorZoom();
    const overflow =
      el.getBoundingClientRect().bottom - (window.innerHeight - 8);
    if (overflow > 0) {
      const top = parseFloat(el.style.top) || 0;
      el.style.top = `${Math.max(8 / zoom, top - overflow / zoom)}px`;
    }
  }, [menuRef]);
}

// Reposition submenus (Turn into / Ask AI) to avoid going off-screen.
// Submenus are position:absolute inside the zoomed editor area, so CSS
// lengths render at ×zoom — divide the measured (visual) overflow by zoom.
export function useSubmenuReposition(
  menuRef: RefObject<HTMLDivElement | null>,
): (subEl: HTMLDivElement | null) => void {
  return useCallback(
    (subEl: HTMLDivElement | null) => {
      if (!subEl || !menuRef.current) return;
      const zoom = getEditorZoom();
      const menuRect = menuRef.current.getBoundingClientRect();
      const subRect = subEl.getBoundingClientRect();
      // If submenu goes off right edge, flip to left side
      if (menuRect.right + subRect.width > window.innerWidth - 8) {
        subEl.style.left = "auto";
        subEl.style.right = "100%";
      }
      // If submenu goes off bottom edge, shift up to fit
      const overflow = subRect.bottom - (window.innerHeight - 8);
      if (overflow > 0) {
        subEl.style.marginTop = `-${overflow / zoom}px`;
      }
    },
    [menuRef],
  );
}
