// §footnote FootnoteDefinition Node Extension — [^id]: content block
import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { FootnoteDefinitionView } from "./footnote-definition-view";

export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      identifier: { default: "1" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="footnote-definition"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "footnote-definition",
        "data-identifier": node.attrs.identifier,
        id: `fn-${node.attrs.identifier}`,
        class: "footnote-definition",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteDefinitionView);
  },

  addKeyboardShortcuts() {
    return {
      // Enter on empty last paragraph → exit footnote definition
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        let defDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === this.name) {
            defDepth = d;
            break;
          }
        }
        if (defDepth < 0) return false;

        const defNode = $from.node(defDepth);
        const parentNode = $from.parent;

        const isLastChild = $from.index(defDepth) === defNode.childCount - 1;
        if (!isLastChild) return false;
        if (parentNode.content.size !== 0) return false;

        const { tr } = state;

        if (defNode.childCount === 1) {
          // Only child is empty — delete entire definition, replace with paragraph
          const defStart = $from.before(defDepth);
          const defAfter = $from.after(defDepth);
          const para = state.schema.nodes.paragraph.create();
          tr.replaceWith(defStart, defAfter, para);
          tr.setSelection(TextSelection.create(tr.doc, defStart + 1));
        } else {
          // Delete empty last paragraph, insert paragraph after definition
          const emptyParaStart = $from.before($from.depth);
          const emptyParaEnd = $from.after($from.depth);
          tr.delete(emptyParaStart, emptyParaEnd);

          const defAfter = $from.after(defDepth);
          const mappedEnd = tr.mapping.map(defAfter);
          const para = state.schema.nodes.paragraph.create();
          tr.insert(mappedEnd, para);
          tr.setSelection(TextSelection.create(tr.doc, mappedEnd + 1));
        }

        this.editor.view.dispatch(tr);
        return true;
      },

      // Backspace at start of first child → lift out
      Backspace: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === this.name) {
            const parentOffset = $from.parentOffset;
            if (parentOffset === 0 && $from.index(d) === 0) {
              return this.editor.commands.lift(this.name);
            }
            return false;
          }
        }
        return false;
      },
    };
  },
});
