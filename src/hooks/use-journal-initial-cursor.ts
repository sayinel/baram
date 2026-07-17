// §56 Journal — place the caret on a body line below the date title when a
// freshly-created journal template loads.
//
// The default journal template is just frontmatter + an H1 date heading, so the
// editor's `autofocus` drops the caret at the END of the title line. The user
// then has to press Enter before writing. This hook detects a just-created
// journal (a one-shot request set at creation time) and, once its content is
// installed, ensures an empty paragraph exists below the title and moves the
// caret into it.
//
// The adjustment rides a JOURNAL_CURSOR_INIT_META transaction so the auto-save
// update handler folds it into the dirty baseline — an empty trailing paragraph
// never serializes back to markdown, so the just-opened file must not go dirty.
import { useEffect } from "react";

import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";

import { TextSelection } from "@tiptap/pm/state";

import { useEditorStore } from "../stores/editor/editor";
import {
  JOURNAL_CURSOR_INIT_META,
  subscribeContentLoaded,
} from "../utils/editor/programmatic-update";
import { consumeJournalBodyCursor } from "../utils/journal/journal-events";

/**
 * Ensure a plain-text body line exists below the date title and place the caret
 * there. No-op (leaves the default caret) when the doc has no title heading.
 * Exported for unit testing against a real editor instance.
 */
export function placeJournalBodyCursor(editor: Editor): void {
  const { state } = editor;
  const { doc, schema } = state;
  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType) return;

  // Find the first top-level heading (the date title) and the block after it.
  let headingEnd = -1;
  let nextAfterHeading: Node | null = null;
  doc.forEach((node, offset, index) => {
    if (headingEnd >= 0) return;
    if (node.type.name === "heading") {
      headingEnd = offset + node.nodeSize;
      nextAfterHeading = doc.maybeChild(index + 1);
    }
  });

  // No title heading (e.g. a custom template) — leave the default caret alone.
  if (headingEnd < 0) return;

  const next = nextAfterHeading as Node | null;
  if (next !== null && next.type.name !== "paragraph") {
    // A structured block follows the title (e.g. a custom template's "## Today"
    // section) — don't insert into it; leave the default caret untouched.
    return;
  }

  const tr = state.tr;
  // Caret goes just inside the body paragraph (start of its text content).
  const caretPos = headingEnd + 1;

  if (next === null) {
    // The title is the last block (the default template) — add an empty body
    // line below it to type into. An empty paragraph is never serialized back
    // to markdown, so the file content is unchanged.
    tr.insert(headingEnd, paragraphType.create());
  }
  // Otherwise a body paragraph already follows the title: just move the caret.

  tr.setSelection(TextSelection.create(tr.doc, caretPos));
  tr.setMeta(JOURNAL_CURSOR_INIT_META, true);
  tr.scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
}

/**
 * Subscribe to content-load events and, for a just-created journal file, place
 * the caret on a body line below the date title.
 */
export function useJournalInitialCursor(editor: Editor | null): void {
  useEffect(() => {
    if (!editor) return;
    return subscribeContentLoaded((tabId) => {
      const { activeTabId, tabs } = useEditorStore.getState();
      // The content that just loaded belongs to the active tab's shared editor.
      // Journals are always small docs, so they never use a keep-alive editor.
      if (tabId !== activeTabId) return;
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab?.filePath) return;
      if (!consumeJournalBodyCursor(tab.filePath)) return;

      // Defer one frame so the natural post-load normalization update captures
      // the dirty baseline first; our meta-tagged transaction then folds its
      // paragraph into that baseline without ever marking the tab dirty.
      requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        if (useEditorStore.getState().activeTabId !== tabId) return;
        placeJournalBodyCursor(editor);
      });
    });
  }, [editor]);
}
