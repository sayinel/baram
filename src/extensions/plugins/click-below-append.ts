import type { EditorView } from "@tiptap/pm/view";

// §4.2 Click-below-to-append — clicking the empty editor area below the last
// block appends a fresh paragraph and places the caret there (Notion/Logseq
// behavior). Without this, clicks below the document only snap the caret to
// the end of the last block, so a document ending in a heading/table/math
// block gives no obvious way to start a new line by mouse alone.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

/**
 * Handle a click on the editor's empty bottom area. Exported for tests.
 *
 * Guards, in order:
 * - editable, plain unmodified left click only
 * - target must be the editor root itself (`.tiptap` padding / empty band),
 *   never a node's own DOM
 * - §perf-large-file C4: when the windowing bottom spacer (`--vbot`, set as
 *   inline style on view.dom) is active, the space below the last *rendered*
 *   block stands in for off-screen content — not the document end — so bail
 * - the click must be below the bottom edge of the last rendered block
 *   (clicks in the horizontal padding beside content stay default)
 */
export function handleClickBelowContent(
  view: EditorView,
  event: MouseEvent,
): boolean {
  if (!view.editable) return false;
  if (
    event.button !== 0 ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return false;
  if (event.target !== view.dom) return false;

  const vbot = parseFloat(view.dom.style.getPropertyValue("--vbot"));
  if (vbot > 0) return false;

  const lastEl = view.dom.lastElementChild;
  if (lastEl && event.clientY <= lastEl.getBoundingClientRect().bottom)
    return false;

  const { doc, schema, tr } = view.state;

  // Last block is already an empty paragraph — just put the caret in it.
  if (lastNodeIsEmptyParagraph(view)) {
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

/** True when the last document block is a paragraph with no content. */
function lastNodeIsEmptyParagraph(view: EditorView): boolean {
  const last = view.state.doc.lastChild;
  return last?.type.name === "paragraph" && last.content.size === 0;
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
      }),
    ];
  },
});
