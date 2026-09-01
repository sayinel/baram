import type { SlashMenuItem } from "../../components/command/slash-menu-item";
import type { Editor } from "@tiptap/core";

import { awaitBoundToEditor } from "../../utils/editor/mutation-tasks";
import { showTableGridPicker } from "../../utils/table-grid-picker";
import { chainWithVimExternalEdit } from "./vim/vim-keys";

export function buildRichContentItems(editor: Editor): SlashMenuItem[] {
  return [
    // Rich content
    {
      id: "code-block",
      label: "Code Block",
      category: "Rich Content",
      description: "Syntax highlighted code",
      mdHint: "```",
      action: () =>
        chainWithVimExternalEdit(editor).focus().toggleCodeBlock().run(),
    },
    {
      id: "math-block",
      label: "Math Block",
      category: "Rich Content",
      description: "LaTeX math equation",
      mdHint: "$$",
      action: () =>
        chainWithVimExternalEdit(editor)
          .focus()
          .insertContent({ type: "mathBlock", attrs: { formula: "" } })
          .run(),
    },
    {
      id: "mermaid",
      label: "Mermaid Diagram",
      category: "Rich Content",
      description: "Flowchart, sequence, and more",
      mdHint: "```mermaid",
      action: () => chainWithVimExternalEdit(editor).setMermaidBlock().run(),
    },
    {
      id: "svg",
      label: "SVG Image",
      category: "Rich Content",
      description: "Render raw SVG markup",
      mdHint: "```svg",
      action: () => chainWithVimExternalEdit(editor).setSvgBlock().run(),
    },
    {
      id: "html",
      label: "HTML Block",
      category: "Rich Content",
      description: "Embed raw HTML (sanitized)",
      mdHint: "<div>",
      action: () => chainWithVimExternalEdit(editor).setHtmlBlock().run(),
    },
    {
      id: "query",
      label: "Query",
      category: "Rich Content",
      description: "Dynamic query block",
      mdHint: "```query",
      action: () => chainWithVimExternalEdit(editor).setQueryBlock().run(),
    },
    {
      id: "table",
      label: "Table",
      category: "Rich Content",
      description: "Insert a table (grid picker)",
      mdHint: "| | |",
      action: async () => {
        // Get cursor position for picker placement
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        // §12-9b: picker resolution is an unbounded async gap (design §5c) —
        // awaitBoundToEditor guarantees finish() even if the picker rejects
        const result = await awaitBoundToEditor(
          editor.view,
          showTableGridPicker(coords.left, coords.bottom + 4),
        );
        if (!result) return;
        chainWithVimExternalEdit(editor)
          .focus()
          .insertTable({
            rows: result.rows,
            cols: result.cols,
            withHeaderRow: true,
          })
          .run();
      },
    },
  ];
}
