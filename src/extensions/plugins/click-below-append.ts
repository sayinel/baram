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
 * - the press is below the last rendered content — the real "empty area" test.
 *   Geometric, so it also excludes every mid-content click. The threshold is
 *   the last block's bottom edge, EXCEPT when the last block is an empty
 *   paragraph: that trailing blank line is itself empty area, so its top edge
 *   is used and a press inside it lands the caret there (WKWebView won't place
 *   the caret in a trailing empty paragraph on its own — the corpus-doc bug)
 * - the target belongs to this editor (its own subtree or the ancestor chain
 *   up to the scroll container), excluding sibling overlays (block handle,
 *   toolbars). NOT an identity check against the root: when the document fills
 *   the viewport, WKWebView hit-tests the thin padding band below the last
 *   block as the last <p> itself, so requiring target === root wrongly killed
 *   the append there (the bug this replaced).
 */
export function handleEmptyAreaMousedown(
  view: EditorView,
  event: MouseEvent,
): boolean {
  if (!view.editable || !isPlainLeftClick(event)) return false;
  if (document.querySelector(".block-handle-menu")) return false;
  if (windowingSpacerActive(view)) return false;
  if (isHiddenInstance(view)) return false;

  const lastEl = view.dom.lastElementChild;
  if (lastEl) {
    // A trailing empty paragraph is itself empty area: a press anywhere from
    // its top downward should land the caret in it (WKWebView doesn't reliably
    // place the caret there natively, so the user gets no caret at all). For a
    // non-empty last block only the region below its bottom is the empty area,
    // so real content stays clickable. Either way the threshold is the bottom
    // edge of the last *rendered content* — the trailing empty line is not it.
    const lastNode = view.state.doc.lastChild;
    const lastIsEmptyParagraph =
      lastNode?.type.name === "paragraph" && lastNode.content.size === 0;
    const rect = lastEl.getBoundingClientRect();
    const contentBottom = lastIsEmptyParagraph ? rect.top : rect.bottom;
    if (event.clientY <= contentBottom) return false;
  }
  if (!belongsToEditor(view, event)) return false;

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
 * True when the event target belongs to this editor rather than a sibling
 * overlay. Accepts:
 * - the editor root or any descendant of it (real editor DOM — the geometry
 *   guard already restricts these to the empty area below the last block), or
 * - the scroll container or a wrapper on the ancestor chain between it and the
 *   root (the empty band below where the root ends).
 * Overlays (block handle, toolbars, menus) are siblings of the editor wrapper:
 * inside the scroll container but neither an ancestor nor a descendant of the
 * root, so they never match. Clicks outside the scroll container (body/html)
 * are excluded too.
 */
function belongsToEditor(view: EditorView, event: MouseEvent): boolean {
  const root = view.dom;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (root.contains(target)) return true;
  const scroll = root.closest("[data-editor-scroll]");
  return !!scroll && scroll.contains(target) && target.contains(root);
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
