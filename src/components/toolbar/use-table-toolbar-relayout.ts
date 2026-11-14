// §5.5 — keeps the floating table toolbar placed through layout that moves the
// table or resizes the toolbar with no editor selection or transaction event
// and no scroll, the events TableToolbar places itself on.
import { type RefObject, useEffect, useRef } from "react";

import type { Editor } from "@tiptap/react";

/**
 * While `table` is set — TableToolbar keeps it while the toolbar hides because
 * the table is out of view, so a layout change that brings it back shows the
 * toolbar again — watches boxes whose size changes move the table or resize
 * the toolbar, and calls `relayout` when one of them changes size:
 * - the editor area (`.editor-area-scroll`): the window or a side panel
 *   resizing it, which also moves a width-capped text column;
 * - the document (`view.dom`): content above the table growing, such as an
 *   image that finishes loading;
 * - the table: a column drag, which prosemirror-tables draws on the `<col>`s
 *   without a transaction, or a font or density dial;
 * - the toolbar, while it is drawn: a dial changing its size.
 *
 * ResizeObserver reports sizes, not positions. A table that moves while all
 * four keep their size — content above it growing as much as content below
 * it shrinks — is placed again only on the next event TableToolbar listens to.
 */
export function useTableToolbarRelayout(
  editor: Editor,
  table: HTMLTableElement | null,
  toolbarRef: RefObject<HTMLElement | null>,
  visible: boolean,
  relayout: () => void,
): void {
  const observerRef = useRef<null | ResizeObserver>(null);

  useEffect(() => {
    // jsdom has no ResizeObserver; without one the toolbar is placed on the
    // events TableToolbar listens to only.
    if (!table || typeof ResizeObserver === "undefined") return;
    // No flushSync: the browser calls this after layout and before paint, and
    // a commit made here can change what is watched — the toolbar mounting,
    // the caret's table replaced, this observer replaced — from inside the
    // callback. A target that becomes active during a callback and is no
    // deeper than every target that reported is held to the next frame with a
    // "ResizeObserver loop completed with undelivered notifications" error
    // (Resize Observer spec, "gather active observations at depth"), and the
    // toolbar sits at the top of `.editor-area-scroll`, shallower than the
    // document and the table. React commits this update on its own pass
    // instead, so the toolbar can follow a resize a frame late.
    const observer = new ResizeObserver(() => relayout());
    const area = editor.view.dom.closest(".editor-area-scroll");
    for (const box of [area, editor.view.dom, table]) {
      if (box) observer.observe(box);
    }
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [editor, table, toolbarRef, relayout]);

  // The toolbar is in the tree only while it shows. These deps cover the
  // effect above's, so this re-runs after every observer it replaces.
  useEffect(() => {
    const observer = observerRef.current;
    const toolbar = toolbarRef.current;
    if (!visible || !observer || !toolbar) return;
    observer.observe(toolbar);
    return () => observer.unobserve(toolbar);
  }, [visible, editor, table, toolbarRef, relayout]);
}
