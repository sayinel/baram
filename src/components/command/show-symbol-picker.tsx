// §377 Open the symbol picker at the caret and wait for a pick.
//
// The table picker's shape (utils/table-grid-picker.ts): a full-window overlay
// catches the mousedown outside, the promise settles once, and the slash item
// awaits it through `awaitBoundToEditor`. The picker is React, so it gets its
// own root, unmounted when the promise settles.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import {
  type PopupAnchor,
  positionPopup,
} from "../../extensions/plugins/suggestion-renderer";
import { restoreFocus } from "../../utils/restore-focus";
import { SymbolPicker } from "./SymbolPicker";

export function showSymbolPicker(anchor: PopupAnchor): Promise<null | string> {
  return new Promise((resolve) => {
    // Every exit hands focus back — cancel, Escape and a pick alike
    // (restore-focus.ts). The search box takes it on mount.
    const returnFocusTo = document.activeElement;

    const overlay = document.createElement("div");
    overlay.className = "symbol-picker-overlay";
    const popup = document.createElement("div");
    popup.className = "symbol-picker-popup";
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    const root = createRoot(popup);

    let settled = false;
    const settle = (value: null | string): void => {
      if (settled) return;
      settled = true;
      root.unmount();
      overlay.remove();
      restoreFocus(returnFocusTo);
      resolve(value);
    };

    overlay.addEventListener("mousedown", (event) => {
      if (event.target !== overlay) return;
      event.preventDefault();
      settle(null);
    });

    // Rendered synchronously so the popup has a size for positionPopup to measure.
    flushSync(() => {
      root.render(
        <SymbolPicker onCancel={() => settle(null)} onPick={settle} />,
      );
    });
    positionPopup(popup, anchor, popup.getBoundingClientRect().height);
  });
}
