// §5.5 — keeps the floating table toolbar placed through layout changes that
// move the table or resize the toolbar — sizes, positions, scrolling — which
// the editor events TableToolbar listens to do not report.
import { type RefObject, useCallback, useEffect, useRef } from "react";

import type { Editor } from "@tiptap/react";

import { autoUpdate } from "@floating-ui/dom";

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
 * While `table` is set, scrolling the editor area places it again too.
 *
 * ResizeObserver reports sizes, not positions. While the toolbar shows, the
 * table's position is watched as well, and that watch is rebuilt on every
 * size report and every scroll: a table that moves while all four keep their
 * size — content above it growing as much as content below it shrinks — is
 * placed again too. The position watch sees a move only when the move changes
 * the part of the table that shows inside the rect the watch was last built
 * for, so a move after which the table still covers all of that part goes
 * unseen. For example, a table cut off at the bottom by the editor area that
 * moves up, still cut off: that move goes unseen, so the toolbar stays where
 * it was, that much lower against the table, and a move back down by no more
 * than that goes unseen too. While the toolbar hides there is no position
 * watch at all. Moves missed either way wait for the next event, size report
 * or scroll.
 */
export function useTableToolbarRelayout(
  editor: Editor,
  table: HTMLTableElement | null,
  toolbarRef: RefObject<HTMLElement | null>,
  visible: boolean,
  relayout: () => void,
): void {
  const observerRef = useRef<null | ResizeObserver>(null);
  // Rebuilds the position watch below; null while it is off.
  const restartMoveWatchRef = useRef<(() => void) | null>(null);

  // Every size report and scroll. The position watch keeps the rect it was
  // last built for, and after these the table may cover a different part of
  // the area, so it is rebuilt while it is on — which places the toolbar too.
  const onLayout = useCallback(() => {
    const restart = restartMoveWatchRef.current;
    if (restart) restart();
    else relayout();
  }, [relayout]);

  useEffect(() => {
    // jsdom has no ResizeObserver; without one sizes go unwatched, while the
    // scroll listener and the position watch below still run.
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
    const observer = new ResizeObserver(() => onLayout());
    const area = editor.view.dom.closest(".editor-area-scroll");
    for (const box of [area, editor.view.dom, table]) {
      if (box) observer.observe(box);
    }
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [editor, table, toolbarRef, onLayout]);

  // Scrolling moves the table with no size change. Only while `table` is set:
  // otherwise the toolbar has nothing to show.
  useEffect(() => {
    if (!table) return;
    const area = editor.view.dom.closest(".editor-area-scroll");
    area?.addEventListener("scroll", onLayout, { passive: true });
    return () => area?.removeEventListener("scroll", onLayout);
  }, [editor, table, onLayout]);

  // The table's position, while the toolbar shows: floating-ui's (1.8.0)
  // `autoUpdate` with only `layoutShift` on watches it with an
  // IntersectionObserver whose root margin fits the table's rect, rebuilt
  // after each move it reports (and by `onLayout` here), and calls `relayout`
  // — building it calls `relayout` at least once too. Its callback is a task
  // of its own, outside the ResizeObserver's, and sets state without flushSync
  // like it. Not while the toolbar hides: for a table entirely out of view it
  // re-checks on a one-second timer.
  useEffect(() => {
    if (!visible || !table) return;
    const watch = () =>
      autoUpdate(table, null, relayout, {
        ancestorResize: false,
        ancestorScroll: false,
        elementResize: false,
        layoutShift: true,
      });
    let stop = watch();
    restartMoveWatchRef.current = () => {
      stop();
      stop = watch();
    };
    return () => {
      stop();
      restartMoveWatchRef.current = null;
    };
  }, [visible, table, relayout]);

  // The toolbar is in the tree only while it shows. These deps cover the
  // first effect's, so this re-runs after every observer it replaces.
  useEffect(() => {
    const observer = observerRef.current;
    const toolbar = toolbarRef.current;
    if (!visible || !observer || !toolbar) return;
    observer.observe(toolbar);
    return () => observer.unobserve(toolbar);
  }, [visible, editor, table, toolbarRef, onLayout]);
}
