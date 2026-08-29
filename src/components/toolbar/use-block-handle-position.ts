import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Editor } from "@tiptap/react";

import { getEditorZoom } from "../../utils/zoom-coords";

export interface HandlePosition {
  pos: number;
  top: number;
}

interface UseBlockHandlePositionResult {
  cancelHideTimeout: () => void;
  handle: HandlePosition | null;
  scheduleHide: () => void;
  setHandle: Dispatch<SetStateAction<HandlePosition | null>>;
}

// §4.8 Block Handle hover tracking — finds the block-level node under the
// cursor and positions the handle at its first-line vertical center. Split
// out of BlockHandle.tsx so mousemove (~60/s) only ever touches this hook's
// state, never the menu's (see BlockHandleMenu.tsx).
export function useBlockHandlePosition(
  editor: Editor,
  menuOpen: boolean,
  closeMenu: () => void,
): UseBlockHandlePositionResult {
  const [handle, setHandle] = useState<HandlePosition | null>(null);
  const hideTimeoutRef = useRef<null | ReturnType<typeof setTimeout>>(null);

  const cancelHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // Delay hide so the user can move the cursor onto the handle element.
  const scheduleHide = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setHandle(null);
    }, 300);
  }, []);

  // Track which block the mouse is hovering over
  useEffect(() => {
    const editorDom = editor.view.dom;
    // Listen on scroll container for wider event surface (includes gutter area)
    const scrollContainer = (editorDom.closest("[data-editor-scroll]") ??
      editorDom.parentElement ??
      editorDom) as HTMLElement;

    const handleMouseMove = (e: MouseEvent) => {
      if (menuOpen) return;
      cancelHideTimeout();

      // §4.2 Zoom: editorRect and mouse events are both in visual viewport
      // space, but the gutter band and probe offset are content-space sizes that
      // scale with zoom — multiply by the zoom factor so the hover zone tracks
      // the (scaled) gutter at any zoom level. No-op at zoom 1.
      const zoom = getEditorZoom();
      const editorRect = editorDom.getBoundingClientRect();
      // Reveal the handle whenever the mouse is anywhere over the editor's
      // horizontal span — from just left of the gutter through the full
      // content width — so hovering *inside* a block (not only its left edge)
      // shows the handle, matching Notion. The probe below still samples the
      // left edge to resolve which block the cursor's row belongs to.
      if (
        e.clientX < editorRect.left - 10 * zoom ||
        e.clientX > editorRect.right + 10 * zoom
      ) {
        setHandle(null);
        return;
      }

      // Find the block-level node under the cursor. posAtCoords() takes visual
      // viewport coords; probe 80 content-px (× zoom) into the editor.
      try {
        const pos = editor.view.posAtCoords({
          left: editorRect.left + 80 * zoom,
          top: e.clientY,
        });
        if (!pos) {
          setHandle(null);
          return;
        }

        // Resolve the top-level block under the probe. Plain text blocks
        // (paragraph/heading/list) land *inside* their content (depth ≥ 1),
        // so the nearest depth-1 ancestor is the block. But atom & custom
        // NodeView blocks (mathBlock, mermaidBlock, codeBlock/CodeMirror) have
        // no editable caret position inside them, so posAtCoords reports a node
        // *boundary* (depth 0) — the depth check alone rejected them and the
        // handle never appeared. posAtCoords also returns `inside`: the start
        // position of the node the coords fell within. Fall back to it so these
        // NodeView blocks get a handle too.
        const resolved = editor.state.doc.resolve(pos.pos);
        let blockPos: null | number = null;
        if (resolved.depth >= 1) {
          blockPos = resolved.before(1);
        } else if (pos.inside >= 0) {
          const $inside = editor.state.doc.resolve(pos.inside);
          blockPos = $inside.depth >= 1 ? $inside.before(1) : pos.inside;
        }
        if (blockPos === null) {
          setHandle(null);
          return;
        }
        const dom = editor.view.nodeDOM(blockPos);
        if (!dom || !(dom instanceof HTMLElement)) {
          setHandle(null);
          return;
        }

        const domRect = dom.getBoundingClientRect();
        // §4.8 Align the handle to the vertical center of the block's FIRST
        // line, not its top edge. For large-font blocks (headings) the top
        // edge sits well above the visual center of the glyphs, leaving the
        // handle floating high. Offset by (first-line-center − btn-center).
        // Applied uniformly to every block — including atom/NodeView blocks
        // (math/mermaid) — so handle placement stays consistent across the
        // document. computed line-height/padding are content-space sizes →
        // × zoom to match the visual-space domRect.top. No-op at zoom 1.
        const cs = window.getComputedStyle(dom);
        let lineHeight = parseFloat(cs.lineHeight);
        if (Number.isNaN(lineHeight)) {
          lineHeight = parseFloat(cs.fontSize) * 1.2;
        }
        const paddingTop = parseFloat(cs.paddingTop) || 0;
        const BTN_HEIGHT = 24; // .block-handle-btn height (toolbar.css)
        const lineCenterOffset =
          (paddingTop + lineHeight / 2 - BTN_HEIGHT / 2) * zoom;
        setHandle((prev) =>
          nextHandleState(prev, domRect.top + lineCenterOffset, blockPos),
        );
      } catch {
        setHandle(null);
      }
    };

    const handleMouseLeave = () => {
      if (menuOpen) return;
      scheduleHide();
    };

    // Hide on scroll: the handle is position:fixed and its top was captured at
    // a single scroll offset, so it stays pinned on screen while the block
    // scrolls away — leaving it stranded over the wrong block. Clear it (and any
    // open menu) so the next mousemove re-places it on the block under the
    // cursor. passive: hot path, never preventDefault.
    const handleScroll = () => {
      setHandle(null);
      closeMenu();
    };

    scrollContainer.addEventListener("mousemove", handleMouseMove);
    scrollContainer.addEventListener("mouseleave", handleMouseLeave);
    scrollContainer.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    return () => {
      scrollContainer.removeEventListener("mousemove", handleMouseMove);
      scrollContainer.removeEventListener("mouseleave", handleMouseLeave);
      scrollContainer.removeEventListener("scroll", handleScroll);
      cancelHideTimeout();
    };
  }, [editor, menuOpen, cancelHideTimeout, closeMenu, scheduleHide]);

  // Reset handle when document changes (e.g. tab switch, wikilink navigation)
  useEffect(() => {
    const handler = () => {
      setHandle(null);
      closeMenu();
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, closeMenu]);

  // §4.2 Hide the handle on zoom (and window resize). A handle that's already
  // showing was positioned & sized for the OLD zoom level, so it visibly drifts
  // and rescales until the next hover recomputes it. applyZoom() in use-zoom.ts
  // dispatches a "resize" event right after changing --editor-zoom, so clearing
  // here makes the handle vanish during zoom; the next mousemove re-places it
  // correctly at the new zoom.
  useEffect(() => {
    const hide = () => {
      setHandle(null);
      closeMenu();
    };
    window.addEventListener("resize", hide);
    return () => window.removeEventListener("resize", hide);
  }, [closeMenu]);

  return { handle, setHandle, cancelHideTimeout, scheduleHide };
}

// Perf: mousemove fires ~60/s, so a naive `setHandle({ pos, top })` allocates
// a fresh object every call even when the cursor is still over the same
// block — React can't bail out on an unchanged *reference*, so the whole
// component (menu-closed included) re-renders on every mouse tick. Return
// `prev` unchanged when pos/top match so the updater form of setState lets
// React skip the re-render.
export function nextHandleState(
  prev: HandlePosition | null,
  top: number,
  pos: number,
): HandlePosition {
  return prev && prev.pos === pos && prev.top === top ? prev : { pos, top };
}
