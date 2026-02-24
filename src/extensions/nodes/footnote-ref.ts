// §footnote FootnoteRef Node Extension — [^id] inline reference (superscript)
import { Node, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { FootnoteRefView } from "./footnote-ref-view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnoteRef: {
      insertFootnoteRef: (identifier: string) => ReturnType;
    };
  }
}

// [^id] — footnote reference input rule
const footnoteRefInputRegex = /\[\^([a-zA-Z0-9][\w-]*)\]$/;

export const FootnoteRef = Node.create({
  name: "footnoteRef",
  group: "inline",
  inline: true,
  atom: true,
  marks: "",

  addAttributes() {
    return {
      identifier: { default: "1" },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="footnote-ref"]' }];
  },

  renderHTML({ node }) {
    return [
      "sup",
      {
        "data-type": "footnote-ref",
        "data-identifier": node.attrs.identifier,
        class: "footnote-ref",
      },
      `[${node.attrs.identifier}]`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteRefView);
  },

  addCommands() {
    return {
      insertFootnoteRef:
        (identifier) =>
        ({ editor, commands }) => {
          // Insert the footnoteRef at cursor
          const refInserted = commands.insertContent({
            type: this.name,
            attrs: { identifier },
          });
          if (!refInserted) return false;

          // Check if a footnoteDefinition with this identifier already exists
          let exists = false;
          editor.state.doc.descendants((node) => {
            if (
              node.type.name === "footnoteDefinition" &&
              node.attrs.identifier === identifier
            ) {
              exists = true;
              return false;
            }
          });

          // If definition doesn't exist, append one at the end of the document
          if (!exists) {
            const { tr, schema } = editor.state;
            const defNode = schema.nodes.footnoteDefinition?.create(
              { identifier },
              [schema.nodes.paragraph.create()],
            );
            if (defNode) {
              tr.insert(tr.doc.content.size, defNode);
              editor.view.dispatch(tr);
            }
          }

          return true;
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: footnoteRefInputRegex,
        handler: ({ state, range, match, chain }) => {
          const identifier = match[1];
          const { tr, schema } = state;

          tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ identifier }),
          );

          // Check if definition exists
          let exists = false;
          state.doc.descendants((node) => {
            if (
              node.type.name === "footnoteDefinition" &&
              node.attrs.identifier === identifier
            ) {
              exists = true;
              return false;
            }
          });

          // Append definition at end if it doesn't exist
          if (!exists && schema.nodes.footnoteDefinition) {
            const defNode = schema.nodes.footnoteDefinition.create(
              { identifier },
              [schema.nodes.paragraph.create()],
            );
            // Use the transaction's doc (after replaceWith) for correct size
            const mappedSize = tr.doc.content.size;
            tr.insert(mappedSize, defNode);
          }

          // The chain parameter isn't needed since we dispatch directly via tr
          void chain;
        },
      }),
    ];
  },
});
