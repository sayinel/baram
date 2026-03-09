// §5.9 Callout Extension — Obsidian-compatible callout blocks
// Markdown: > [!type] title / > body
import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CalloutView } from "./callout-view";

export interface CalloutOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: {
        type?: string;
        title?: string;
        collapsed?: boolean;
      }) => ReturnType;
      toggleCallout: () => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create<CalloutOptions>({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      type: { default: "info" },
      title: { default: "" },
      collapsed: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "callout",
        "data-callout-type": node.attrs.type,
        class: "callout",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { type: "info", title: "", collapsed: false, ...attrs },
            content: [{ type: "paragraph" }],
          }),
      toggleCallout:
        () =>
        ({ state, commands }) => {
          const { $from } = state.selection;
          // Check if we're inside a callout
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === this.name) {
              return commands.lift(this.name);
            }
          }
          // Not in a callout — wrap current block
          return commands.insertContent({
            type: this.name,
            attrs: { type: "info", title: "", collapsed: false },
            content: [{ type: "paragraph" }],
          });
        },
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      // Enter on empty last paragraph → exit callout (create paragraph after)
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        // Find callout ancestor
        let calloutDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === this.name) {
            calloutDepth = d;
            break;
          }
        }
        if (calloutDepth < 0) return false;

        const calloutNode = $from.node(calloutDepth);
        const parentNode = $from.parent; // the paragraph containing the cursor

        // Only trigger if: cursor is in the last child of callout AND that child is empty
        const isLastChild =
          $from.index(calloutDepth) === calloutNode.childCount - 1;
        if (!isLastChild) return false;
        if (parentNode.content.size !== 0) return false;

        const { tr } = state;

        if (calloutNode.childCount === 1) {
          // Only child is empty — delete entire callout, replace with empty paragraph
          const calloutStart = $from.before(calloutDepth);
          const calloutAfter = $from.after(calloutDepth);
          const para = state.schema.nodes.paragraph.create();
          tr.replaceWith(calloutStart, calloutAfter, para);
          tr.setSelection(TextSelection.create(tr.doc, calloutStart + 1));
        } else {
          // Delete the empty last paragraph from callout, insert paragraph after callout
          const emptyParaStart = $from.before($from.depth);
          const emptyParaEnd = $from.after($from.depth);
          tr.delete(emptyParaStart, emptyParaEnd);

          // Insert new paragraph after the callout
          const calloutAfter = $from.after(calloutDepth);
          // After deletion, the callout end shifted — recalculate
          const mappedEnd = tr.mapping.map(calloutAfter);
          const para = state.schema.nodes.paragraph.create();
          tr.insert(mappedEnd, para);
          tr.setSelection(TextSelection.create(tr.doc, mappedEnd + 1));
        }

        this.editor.view.dispatch(tr);
        return true;
      },

      // Backspace at start of first child → lift out of callout
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

      // ArrowDown at end of callout → move cursor after callout
      ArrowDown: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === this.name) {
            const calloutNode = $from.node(d);
            const isLastChild = $from.index(d) === calloutNode.childCount - 1;
            const atEnd = $from.parentOffset === $from.parent.content.size;
            if (!isLastChild || !atEnd) return false;

            // At end of last child of callout
            const calloutAfter = $from.after(d);
            if (calloutAfter < state.doc.content.size) {
              const $pos = state.doc.resolve(calloutAfter);
              const after = $pos.nodeAfter;
              if (after?.isTextblock) {
                const { tr } = state;
                tr.setSelection(TextSelection.create(tr.doc, calloutAfter + 1));
                this.editor.view.dispatch(tr);
                return true;
              }
            }

            // No block after callout — create one
            const { tr } = state;
            const para = state.schema.nodes.paragraph.create();
            tr.insert(calloutAfter, para);
            tr.setSelection(TextSelection.create(tr.doc, calloutAfter + 1));
            this.editor.view.dispatch(tr);
            return true;
          }
        }
        return false;
      },
    };
  },
});
