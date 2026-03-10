import type { Node as PmNode, Schema } from "@tiptap/pm/model";

// Definition List Extension — Term\n: Definition → <dl><dt><dd>
import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    definitionList: {
      setDefinitionList: () => ReturnType;
    };
  }
}

/** Unwrap all children of a definitionList into paragraphs */
function unwrapDlToParagraphs(dlNode: PmNode, schema: Schema): PmNode[] {
  const paragraphs: PmNode[] = [];
  dlNode.forEach((child) => {
    paragraphs.push(schema.nodes.paragraph.create(null, child.content));
  });
  return paragraphs;
}

export const DefinitionList = Node.create({
  name: "definitionList",
  group: "block",
  content: "(definitionTerm definitionDescription+)+",
  defining: true,

  parseHTML() {
    return [{ tag: "dl.definition-list" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "dl",
      mergeAttributes(HTMLAttributes, { class: "definition-list" }),
      0,
    ];
  },

  addCommands() {
    return {
      setDefinitionList:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [
              { type: "definitionTerm" },
              { type: "definitionDescription" },
            ],
          }),
    };
  },
});

export const DefinitionTerm = Node.create({
  name: "definitionTerm",
  content: "inline*",
  marks: "_",

  parseHTML() {
    return [{ tag: "dt" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["dt", mergeAttributes(HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Enter in term → move to next description
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        if ($from.parent.type.name !== this.name) return false;

        const dlDepth = $from.depth - 1;
        if (dlDepth < 1) return false;
        const dlNode = $from.node(dlDepth);
        if (dlNode.type.name !== "definitionList") return false;

        const termIndex = $from.index(dlDepth);
        if (termIndex + 1 < dlNode.childCount) {
          const nextChild = dlNode.child(termIndex + 1);
          if (nextChild.type.name === "definitionDescription") {
            const afterTerm = $from.after($from.depth);
            const { tr } = state;
            tr.setSelection(TextSelection.create(tr.doc, afterTerm + 1));
            this.editor.view.dispatch(tr);
            return true;
          }
        }

        return false;
      },

      // Backspace at start of term → unwrap definition list to paragraphs
      Backspace: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        if ($from.parent.type.name !== this.name) return false;
        if ($from.parentOffset !== 0) return false;

        const dlDepth = $from.depth - 1;
        if (dlDepth < 1) return false;
        const dlNode = $from.node(dlDepth);
        if (dlNode.type.name !== "definitionList") return false;

        const termIndex = $from.index(dlDepth);

        if (termIndex === 0) {
          // First term → unwrap entire dl to paragraphs
          const dlStart = $from.before(dlDepth);
          const dlEnd = $from.after(dlDepth);
          const { tr } = state;
          const paragraphs = unwrapDlToParagraphs(dlNode, state.schema);
          tr.replaceWith(dlStart, dlEnd, paragraphs);
          tr.setSelection(TextSelection.create(tr.doc, dlStart + 1));
          this.editor.view.dispatch(tr);
          return true;
        }

        // Non-first term → merge with previous description
        const prevChild = dlNode.child(termIndex - 1);
        if (prevChild.type.name === "definitionDescription") {
          const termStart = $from.before($from.depth);
          const termEnd = $from.after($from.depth);
          const termContent = $from.parent.content;

          const { tr } = state;
          // Append term content to end of previous description
          const prevDescEndPos = termStart - 1; // inside previous desc, at end
          if (termContent.size > 0) {
            tr.insert(prevDescEndPos, termContent);
          }
          // Delete the now-empty term and its following description(s)
          // to maintain valid structure — just delete the term node
          const mappedTermStart = tr.mapping.map(termStart);
          const mappedTermEnd = tr.mapping.map(termEnd);
          tr.delete(mappedTermStart, mappedTermEnd);

          tr.setSelection(
            TextSelection.create(tr.doc, tr.mapping.map(prevDescEndPos)),
          );
          this.editor.view.dispatch(tr);
          return true;
        }

        return false;
      },
    };
  },
});

export const DefinitionDescription = Node.create({
  name: "definitionDescription",
  content: "inline*",
  marks: "_",

  parseHTML() {
    return [{ tag: "dd" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["dd", mergeAttributes(HTMLAttributes), 0];
  },

  addInputRules() {
    return [
      // `: ` at start of a paragraph → convert previous paragraph to term,
      // current paragraph to description, wrap in definitionList
      new InputRule({
        find: /^:\s$/,
        handler: ({ state, range }) => {
          const { tr, schema } = state;
          const $from = state.doc.resolve(range.from);

          // Must be inside a paragraph (not already in a definition list)
          const currentNode = $from.node($from.depth);
          if (currentNode.type.name !== "paragraph") return;

          // Must not be inside a definitionList already
          for (let d = $from.depth - 1; d >= 0; d--) {
            if ($from.node(d).type.name === "definitionList") return;
          }

          // Find previous sibling — it will become the term
          const parentDepth = $from.depth - 1;
          const indexInParent = $from.index(parentDepth);
          if (indexInParent === 0) return;

          const parentNode = $from.node(parentDepth);
          const prevChild = parentNode.child(indexInParent - 1);

          // Previous sibling must be a paragraph (the term)
          if (prevChild.type.name !== "paragraph") return;

          // Calculate positions of both paragraphs
          const currentParaStart = $from.before($from.depth);
          const currentParaEnd = $from.after($from.depth);
          const prevParaStart = currentParaStart - prevChild.nodeSize;

          // Build definition list: term (from prev paragraph) + empty description
          const termNode = schema.nodes.definitionTerm.create(
            null,
            prevChild.content,
          );
          const descNode = schema.nodes.definitionDescription.create();
          const dlNode = schema.nodes.definitionList.create(null, [
            termNode,
            descNode,
          ]);

          tr.replaceWith(prevParaStart, currentParaEnd, dlNode);

          const cursorPos = prevParaStart + 1 + termNode.nodeSize + 1;
          tr.setSelection(TextSelection.create(tr.doc, cursorPos));
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Enter on empty description → exit definition list
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        if ($from.parent.type.name !== this.name) return false;
        if ($from.parent.content.size !== 0) return false;

        const dlDepth = $from.depth - 1;
        if (dlDepth < 1) return false;
        const dlNode = $from.node(dlDepth);
        if (dlNode.type.name !== "definitionList") return false;

        const descIndex = $from.index(dlDepth);
        const isLastChild = descIndex === dlNode.childCount - 1;
        if (!isLastChild) return false;

        const { tr } = state;

        if (dlNode.childCount <= 2) {
          // Only one term+desc pair and desc is empty — delete entire list
          const dlStart = $from.before(dlDepth);
          const dlAfter = $from.after(dlDepth);
          const para = state.schema.nodes.paragraph.create();
          tr.replaceWith(dlStart, dlAfter, para);
          tr.setSelection(TextSelection.create(tr.doc, dlStart + 1));
        } else {
          // Delete the empty description, insert paragraph after dl
          const emptyStart = $from.before($from.depth);
          const emptyEnd = $from.after($from.depth);
          tr.delete(emptyStart, emptyEnd);

          const dlAfter = $from.after(dlDepth);
          const mappedEnd = tr.mapping.map(dlAfter);
          const para = state.schema.nodes.paragraph.create();
          tr.insert(mappedEnd, para);
          tr.setSelection(TextSelection.create(tr.doc, mappedEnd + 1));
        }

        this.editor.view.dispatch(tr);
        return true;
      },

      // Backspace at start of description → handle deletion
      Backspace: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        if ($from.parent.type.name !== this.name) return false;
        if ($from.parentOffset !== 0) return false;

        const dlDepth = $from.depth - 1;
        if (dlDepth < 1) return false;
        const dlNode = $from.node(dlDepth);
        if (dlNode.type.name !== "definitionList") return false;

        const descIndex = $from.index(dlDepth);
        const prevSibling = descIndex > 0 ? dlNode.child(descIndex - 1) : null;
        const descIsEmpty = $from.parent.content.size === 0;

        // Count how many descriptions follow the current term
        // Walk backward to find the term for this description
        let termIdx = descIndex - 1;
        while (
          termIdx >= 0 &&
          dlNode.child(termIdx).type.name !== "definitionTerm"
        ) {
          termIdx--;
        }
        let descCountForTerm = 0;
        for (let ci = termIdx + 1; ci < dlNode.childCount; ci++) {
          if (dlNode.child(ci).type.name === "definitionDescription") {
            descCountForTerm++;
          } else {
            break;
          }
        }

        const { tr } = state;

        if (descIsEmpty) {
          // Empty description
          if (dlNode.childCount <= 2) {
            // Only one term+desc pair → unwrap dl, keep term as paragraph
            const dlStart = $from.before(dlDepth);
            const dlEnd = $from.after(dlDepth);
            const termNode = dlNode.child(0);
            const para = state.schema.nodes.paragraph.create(
              null,
              termNode.content,
            );
            tr.replaceWith(dlStart, dlEnd, para);
            const cursorPos = dlStart + 1 + termNode.content.size;
            tr.setSelection(TextSelection.create(tr.doc, cursorPos));
            this.editor.view.dispatch(tr);
            return true;
          }

          if (descCountForTerm === 1 && termIdx >= 0) {
            // Only description for this term → delete entire term+desc pair
            let pairStart = $from.before($from.depth);
            // Walk back to include the term
            for (let ci = descIndex - 1; ci >= termIdx; ci--) {
              pairStart -= dlNode.child(ci).nodeSize;
            }
            const pairEnd = $from.after($from.depth);
            tr.delete(pairStart, pairEnd);
            const $mapped = tr.doc.resolve(
              Math.min(tr.mapping.map(pairStart), tr.doc.content.size),
            );
            tr.setSelection(TextSelection.near($mapped));
            this.editor.view.dispatch(tr);
            return true;
          }

          // Multiple descriptions → just delete this one
          const descStart = $from.before($from.depth);
          const descEnd = $from.after($from.depth);
          tr.delete(descStart, descEnd);
          const $mapped = tr.doc.resolve(
            Math.min(tr.mapping.map(descStart), tr.doc.content.size),
          );
          tr.setSelection(TextSelection.near($mapped));
          this.editor.view.dispatch(tr);
          return true;
        }

        // Non-empty description at start → merge content into previous node
        if (prevSibling) {
          const descContent = $from.parent.content;
          const descStart = $from.before($from.depth);
          const descEnd = $from.after($from.depth);
          const prevEndPos = descStart - 1; // inside prev node, at end

          if (descContent.size > 0) {
            tr.insert(prevEndPos, descContent);
          }
          const mappedDescStart = tr.mapping.map(descStart);
          const mappedDescEnd = tr.mapping.map(descEnd);
          tr.delete(mappedDescStart, mappedDescEnd);

          tr.setSelection(
            TextSelection.create(tr.doc, tr.mapping.map(prevEndPos)),
          );
          this.editor.view.dispatch(tr);
          return true;
        }

        return false;
      },

      // Shift-Enter on non-empty description → add new term+description pair
      "Shift-Enter": () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;

        if ($from.parent.type.name !== this.name) return false;
        if (empty && $from.parent.content.size === 0) return false;

        const dlDepth = $from.depth - 1;
        if (dlDepth < 1) return false;
        const dlNode = $from.node(dlDepth);
        if (dlNode.type.name !== "definitionList") return false;

        const afterDesc = $from.after($from.depth);
        const { tr } = state;
        const newTerm = state.schema.nodes.definitionTerm.create();
        const newDesc = state.schema.nodes.definitionDescription.create();
        tr.insert(afterDesc, [newTerm, newDesc]);
        tr.setSelection(TextSelection.create(tr.doc, afterDesc + 1));
        this.editor.view.dispatch(tr);
        return true;
      },
    };
  },
});
