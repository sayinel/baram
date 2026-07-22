import type { EditorView } from "@tiptap/pm/view";

// §4.2 Click-below-to-append — pressing in the empty editor area below the last
// block appends a fresh paragraph and places the caret there (Notion/Logseq
// behavior). Without this, a document ending in a heading/table/math block
// gives no obvious way to start a new line by mouse alone.
//
// Why a document-level MOUSEDOWN listener (not ProseMirror handleClick):
//
// - The `.tiptap` root's min-height:100% cannot resolve against its auto-height
//   EditorContent wrappers, so the root ends at the document content. Clicks in
//   the space below it land on `.editor-area-scroll` — outside the editable —
//   so ProseMirror never sees them.
// - Even for clicks that DO land on the root's own bottom padding, WKWebView
//   starts a text-selection drag anchored to the nearest text (the last
//   paragraph) the instant the pointer moves a few px. That drag suppresses the
//   `click` event and drops the caret INTO the existing block instead of
//   appending — the reason clicking below a paragraph felt dead while a list
//   (no text to anchor to) worked. Handling `mousedown` and calling
//   preventDefault() stops the drag before it starts, making the behavior
//   deterministic regardless of block type or pointer jitter.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

/**
 * Decide whether a mousedown falls in the empty area below the last block and,
 * if so, append (or focus) a trailing paragraph. Returns true when handled.
 * Exported for tests.
 *
 * Guards, in order:
 * - editable, plain unmodified left button only
 * - not a click that dismisses an open block-handle menu (checked here because
 *   BlockHandle closes the menu on this same mousedown)
 * - windowing spacer inactive (see windowingSpacerActive)
 * - this editor instance is visible (keep-alive editors stay mounted with
 *   display:none; their rects are all-zero, so geometry alone can't tell)
 * - target is the empty band, not real content: the editor root itself
 *   (its bottom padding) or the scroll container / a wrapper that contains the
 *   root — never a document node's own DOM, never an overlay (block handle,
 *   toolbars) which don't contain the root
 * - the pointer is below the bottom edge of the last rendered block
 */
export function handleEmptyAreaMousedown(
  view: EditorView,
  event: MouseEvent,
): boolean {
  if (!view.editable || !isPlainLeftClick(event)) return false;
  if (document.querySelector(".block-handle-menu")) return false;
  if (windowingSpacerActive(view)) return false;
  if (isHiddenInstance(view)) return false;
  if (!isEmptyAreaTarget(view, event)) return false;

  const lastEl = view.dom.lastElementChild;
  if (lastEl && event.clientY <= lastEl.getBoundingClientRect().bottom)
    return false;

  // Stop WKWebView from starting a text-selection drag into the last block.
  event.preventDefault();
  return appendOrFocusTrailingParagraph(view);
}

/**
 * Append an empty trailing paragraph and put the caret in it. If the last
 * block already is one, just move the caret — repeated clicks stay idempotent
 * instead of piling up empty paragraphs.
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
 * True when the target is the empty band around the editor content and not a
 * document node or overlay:
 * - the `.tiptap` root itself (a click on its own bottom padding), or
 * - the `[data-editor-scroll]` container or a wrapper between it and the root
 *   (clicks below where the root ends).
 * Document nodes (`<p>`, `<li>`, …) and overlays (block handle, toolbars, menus)
 * are neither the root nor an ancestor of it, so they never match.
 */
function isEmptyAreaTarget(view: EditorView, event: MouseEvent): boolean {
  const root = view.dom;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target === root) return true;
  const scroll = root.closest("[data-editor-scroll]");
  if (!scroll || !scroll.contains(target)) return false;
  return target === scroll || target.contains(root);
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

/** Plain unmodified left button — modified clicks keep their default meaning. */
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
        view(view) {
          // Document-level so it fires whether the press lands on the editor
          // root's padding or on the scroll band below it. Capture phase so
          // preventDefault() runs before WKWebView begins a selection drag.
          const onMouseDown = (event: MouseEvent) => {
            handleEmptyAreaMousedown(view, event);
          };
          document.addEventListener("mousedown", onMouseDown, true);
          return {
            destroy() {
              document.removeEventListener("mousedown", onMouseDown, true);
            },
          };
        },
      }),
    ];
  },
});
