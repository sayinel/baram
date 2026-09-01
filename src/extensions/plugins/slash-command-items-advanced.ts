import type { SlashMenuItem } from "../../components/command/SlashMenu";
import type { Editor } from "@tiptap/core";

import { chainWithVimExternalEdit } from "./vim/vim-keys";

export function buildAdvancedItems(editor: Editor): SlashMenuItem[] {
  return [
    // §footnote Footnote
    {
      id: "footnote",
      label: "Footnote",
      category: "Advanced",
      description: "Insert footnote reference",
      mdHint: "[^1]",
      action: () => {
        // Calculate next available numeric footnote identifier
        let maxId = 0;
        editor.state.doc.descendants((node) => {
          if (node.type.name === "footnoteRef") {
            const id = parseInt(node.attrs.identifier as string, 10);
            if (!isNaN(id) && id > maxId) maxId = id;
          }
        });
        const nextId = String(maxId + 1);
        chainWithVimExternalEdit(editor).insertFootnoteRef(nextId).run();
      },
    },
  ];
}
