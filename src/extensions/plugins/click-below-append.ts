import type { EditorView } from "@tiptap/pm/view";

// §4.2 Click-below-to-append — clicking the empty editor area below the last
// block appends a fresh paragraph and places the caret there (Notion/Logseq
// behavior). Without this, clicks below the document only snap the caret to
// the end of the last block, so a document ending in a heading/table/math
// block gives no obvious way to start a new line by mouse alone.
//
// Two click paths cover the empty area:
// 1. ProseMirror handleClick — clicks landing on the `.tiptap` root itself
//    (its 2rem bottom padding band).
// 2. A document-level listener (plugin view) — clicks BELOW the `.tiptap`
//    root. The root's min-height:100% cannot resolve against its auto-height
//    EditorContent wrappers, so it ends at the document content and clicks in
//    the space below land on `.editor-area-scroll`; ProseMirror never sees
//    them, so a DOM listener outside the editor is required.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

/**
 * Path 1 — click on the `.tiptap` root's own empty band. Exported for tests.
 *
 * Guards, in order:
 * - editable, plain unmodified left click only
 * - target must be the editor root itself (`.tiptap` padding / empty band),
 *   never a node's own DOM
 * - windowing spacer inactive (see windowingSpacerActive)
 * - the click must be below the bottom edge of the last rendered block
 *   (clicks in the horizontal padding beside content stay default)
 */
export function handleClickBelowContent(
  view: EditorView,
  event: MouseEvent,
): boolean {
  if (!view.editable || !isPlainLeftClick(event)) return false;
  if (event.target !== view.dom) return false;
  if (windowingSpacerActive(view)) return false;

  const lastEl = view.dom.lastElementChild;
  if (lastEl && event.clientY <= lastEl.getBoundingClientRect().bottom)
    return false;

  return appendOrFocusTrailingParagraph(view);
}

/**
 * Path 2 — click on the scroll area's empty band below the `.tiptap` root.
 * Exported for tests.
 *
 * Guards, in order:
 * - editable, plain unmodified left click only
 * - target is the band itself (the [data-editor-scroll] container or a
 *   wrapper between it and the PM root) — never overlays like the block
 *   handle or floating toolbars, and never nodes inside the document
 * - this editor instance is visible (keep-alive editors stay mounted with
 *   display:none; their rects are all-zero, so geometry alone can't tell)
 * - windowing spacer inactive (see windowingSpacerActive)
 * - the click must be below the bottom edge of the editor root
 */
export function handleScrollAreaClick(
  view: EditorView,
  event: MouseEvent,
): boolean {
  if (!view.editable || !isPlainLeftClick(event)) return false;
  if (!isScrollBandTarget(view, event)) return false;
  if (isHiddenInstance(view)) return false;
  if (windowingSpacerActive(view)) return false;
  if (event.clientY <= view.dom.getBoundingClientRect().bottom) return false;

  return appendOrFocusTrailingParagraph(view);
}

/**
 * Append an empty trailing paragraph and put the caret in it. If the last
 * block already is one, just move the caret — repeated clicks stay
 * idempotent instead of piling up empty paragraphs.
 */
function appendOrFocusTrailingParagraph(view: EditorView): boolean {
  const { doc, schema, tr } = view.state;

  const last = doc.lastChild;
  if (last?.type.name === "paragraph" && last.content.size === 0) {
    const caret = TextSelection.create(doc, doc.content.size - 1);
    if (!view.state.selection.eq(caret)) {
      view.dispatch(tr.setSelection(caret));
    }
    view.focus();
    return true;
  }

  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return false;
  tr.insert(doc.content.size, paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

/**
 * §perf-large-file C3.5: keep-alive editors stay mounted (display:none
 * wrapper) while another tab is active. Their document listener would
 * otherwise append to the hidden document, since a display:none subtree
 * reports zero rects and passes every geometry guard.
 */
function isHiddenInstance(view: EditorView): boolean {
  if (!view.dom.isConnected) return true;
  let el: HTMLElement | null = view.dom;
  while (el) {
    if (getComputedStyle(el).display === "none") return true;
    el = el.parentElement;
  }
  return false;
}

/** Plain unmodified left click — modified clicks keep their default meaning. */
function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}

/**
 * True when the event target is the empty band around the editor content:
 * the [data-editor-scroll] container itself or a wrapper between it and the
 * PM root. Overlays inside the scroll container (block handle, toolbars,
 * menus) and nodes inside the document don't contain the PM root, so they
 * never match.
 */
function isScrollBandTarget(view: EditorView, event: MouseEvent): boolean {
  const scroll = view.dom.closest("[data-editor-scroll]");
  if (!scroll) return false;
  const target = event.target;
  if (!(target instanceof Element) || !scroll.contains(target)) return false;
  return target === scroll || target.contains(view.dom);
}

/**
 * §perf-large-file C4: while the windowing bottom spacer (`--vbot`, set as
 * inline style on view.dom) is active, the space below the last *rendered*
 * block stands in for off-screen content — not the document end.
 */
function windowingSpacerActive(view: EditorView): boolean {
  const vbot = parseFloat(view.dom.style.getPropertyValue("--vbot"));
  return vbot > 0;
}

export const ClickBelowAppend = Extension.create({
  name: "clickBelowAppend",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("clickBelowAppend"),
        props: {
          handleClick(view, _pos, event) {
            return handleClickBelowContent(view, event);
          },
        },
        view(view) {
          // Arm on mousedown so a text-selection drag that starts inside the
          // document and releases over the band (the browser fires the click
          // on the common ancestor — the scroll container) never counts as a
          // band click. Document-level because the editor may not be attached
          // under [data-editor-scroll] yet when the plugin view is created.
          let armed = false;
          const onMouseDown = (event: MouseEvent) => {
            // The open-menu check must happen HERE: BlockHandle closes its
            // menu on this same mousedown, so by click time the menu is
            // already unmounted and a dismissal click would look like a
            // plain band click and append.
            armed =
              isPlainLeftClick(event) &&
              isScrollBandTarget(view, event) &&
              !document.querySelector(".block-handle-menu");
          };
          const onClick = (event: MouseEvent) => {
            if (!armed) return;
            armed = false;
            handleScrollAreaClick(view, event);
          };
          document.addEventListener("mousedown", onMouseDown);
          document.addEventListener("click", onClick);
          return {
            destroy() {
              document.removeEventListener("mousedown", onMouseDown);
              document.removeEventListener("click", onClick);
            },
          };
        },
      }),
    ];
  },
});
