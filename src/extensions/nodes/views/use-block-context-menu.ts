// issue 521 — the right-click menu machinery of a diagram block (mermaid,
// svg), in one place. The two views carried comment-for-comment identical
// copies; this is the consolidation use-atom-edit-session.ts did for the
// edit session, for the same reason (a fix landing in one copy only).
//
// Ownership goes by the ELEMENT under the pointer, not by the block's mode.
// A native text control (the source textarea, the caption input) is the
// browser's: the event bubbles untouched and the document-level rule
// (ContextMenu.tsx, same predicate) yields to the native menu. Everything
// else on the block — the rendered diagram in either mode, the header —
// opens the block's own menu. Portal-borne events (the fullscreen modals
// live in the block's React tree but not in its DOM) are nobody's here.
//
// One menu at a time. In preview state the block stops the right-button
// mousedown so ProseMirror does not select it (which would open the edit
// session) — and that same stop hides the mousedown from every other menu's
// dismiss listener. So opening, or yielding to the browser, first tells every
// other menu to close (context-menu-exclusive.ts), and this menu closes on
// that signal from anyone else.
//
// The menu is bound to what it opened on — the mode and the source. Either
// changing under an open menu (an Escape the textarea's vim stair stops
// before the document listener can see it; typing; an undo from the Edit
// menu) closes it rather than re-binding it to something the user did not
// right-click. A render landing for the SAME source is not a change: items
// gated on it may appear.
import { type RefObject, useCallback, useEffect, useState } from "react";
import type React from "react";

import {
  closeAllContextMenus,
  onCloseAllContextMenus,
} from "../../../utils/editor/context-menu-exclusive";
import { isInNativeTextControl } from "../../../utils/editor/native-text-control";

export interface BlockContextMenu {
  close: () => void;
  contextMenu: BlockContextMenuPosition | null;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Wrapper mousedown for preview state; undefined while editing, where
   *  there is no selection to protect. */
  onMouseDown: ((e: React.MouseEvent) => void) | undefined;
}

export interface BlockContextMenuPosition {
  x: number;
  y: number;
}

export interface UseBlockContextMenuOptions {
  /** The block's edit session is open (useAtomEditSession). */
  editing: boolean;
  /** What the menu acts on: the session's code while editing, the committed
   *  attribute otherwise. A change closes the menu. */
  source: string;
  /** The NodeViewWrapper element — what counts as "inside the block". */
  wrapperRef: RefObject<HTMLElement | null>;
}

export function useBlockContextMenu({
  editing,
  source,
  wrapperRef,
}: UseBlockContextMenuOptions): BlockContextMenu {
  const [contextMenu, setContextMenu] =
    useState<BlockContextMenuPosition | null>(null);

  // Dismiss on outside mousedown, Escape, or another menu opening.
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", onKey);
    const offCloseAll = onCloseAllContextMenus(dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", onKey);
      offCloseAll();
    };
  }, [contextMenu]);

  // A mode flip or a source change closes the menu (see the header).
  useEffect(() => {
    setContextMenu(null);
  }, [editing, source]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) return;
      if (isInNativeTextControl(e.target)) {
        // No menu of ours may linger beside the native one.
        closeAllContextMenus();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      closeAllContextMenus();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [wrapperRef],
  );

  const stopRightButton = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) e.stopPropagation();
  }, []);

  const close = useCallback(() => setContextMenu(null), []);

  return {
    close,
    contextMenu,
    onContextMenu,
    onMouseDown: editing ? undefined : stopRightButton,
  };
}
