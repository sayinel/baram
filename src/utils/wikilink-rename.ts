// §33 Update wikilink targets in an open ProseMirror editor
import type { Editor } from "@tiptap/core";

/**
 * Traverse the ProseMirror doc and replace wikilink nodes whose target
 * matches `oldTarget` (case-insensitive) with `newTarget`.
 */
export function updateOpenEditorWikilinks(
  editor: Editor,
  oldTarget: string,
  newTarget: string,
): void {
  const { state } = editor.view;
  const { tr } = state;
  const oldNormalized = oldTarget.toLowerCase();
  let changed = false;

  state.doc.descendants((node, pos) => {
    if (node.type.name === "wikilink") {
      const currentTarget = (node.attrs.target as string) || "";
      if (currentTarget.toLowerCase() === oldNormalized) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          target: newTarget,
        });
        changed = true;
      }
    }
  });

  if (changed) {
    editor.view.dispatch(tr);
  }
}
