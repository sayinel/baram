// §5.1 Toggle Extension — <details><summary> collapsible block
import { Node, mergeAttributes } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { ResolvedPos } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ToggleView } from "./toggle-view";

export interface ToggleOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: (attrs?: {
        open?: boolean;
        summaryType?: "heading";
        level?: number;
      }) => ReturnType;
      toggleToggle: () => ReturnType;
      unsetToggle: () => ReturnType;
    };
  }
}

/** Find the nearest toggle ancestor depth, or -1 */
function findToggleDepth($from: ResolvedPos, name: string): number {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === name) return d;
  }
  return -1;
}

/** Move cursor to after the toggle (next sibling or create paragraph) */
function moveAfterToggle(
  state: EditorState,
  view: EditorView,
  toggleDepth: number,
): boolean {
  const { $from } = state.selection;
  const toggleAfter = $from.after(toggleDepth);

  if (toggleAfter < state.doc.content.size) {
    const sel = TextSelection.findFrom(state.doc.resolve(toggleAfter), 1);
    if (sel) {
      const { tr } = state;
      tr.setSelection(sel);
      view.dispatch(tr);
      return true;
    }
  }

  // No block after toggle → create paragraph
  const { tr } = state;
  const para = state.schema.nodes.paragraph.create();
  tr.insert(toggleAfter, para);
  tr.setSelection(TextSelection.create(tr.doc, toggleAfter + 1));
  view.dispatch(tr);
  return true;
}

export const Toggle = Node.create<ToggleOptions>({
  name: "toggle",
  group: "block",
  content: "(paragraph | heading) block*",
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      open: { default: true },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "toggle",
        "data-open": node.attrs.open ? "true" : "false",
        class: "toggle",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },

  addCommands() {
    return {
      setToggle:
        (attrs) =>
        ({ commands }) => {
          const isHeading = attrs?.summaryType === "heading";
          const summaryContent = isHeading
            ? {
                type: "heading" as const,
                attrs: { level: attrs?.level ?? 2 },
              }
            : { type: "paragraph" as const };
          return commands.insertContent({
            type: this.name,
            attrs: { open: attrs?.open ?? true },
            content: [summaryContent],
          });
        },
      toggleToggle:
        () =>
        ({ state, commands }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === this.name) {
              return commands.lift(this.name);
            }
          }
          return commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [{ type: "paragraph" }],
          });
        },
      unsetToggle:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        const toggleDepth = findToggleDepth($from, this.name);
        if (toggleDepth < 0) return false;

        const toggleNode = $from.node(toggleDepth);
        const childIndex = $from.index(toggleDepth);
        const parentNode = $from.parent;
        const isOpen = toggleNode.attrs.open as boolean;

        // === Summary (first child) ===
        if (childIndex === 0) {
          if (!isOpen) {
            // Collapsed: create new toggle sibling below
            // Text after cursor → new toggle's summary
            const { tr } = state;
            const afterContent = parentNode.content.cut($from.parentOffset);

            // Delete text after cursor from current summary
            if ($from.parentOffset < parentNode.content.size) {
              tr.delete($from.pos, $from.end());
            }

            // Insert new toggle after current toggle
            const toggleAfterPos = tr.mapping.map($from.after(toggleDepth));

            // Preserve summary type: if heading, new sibling gets same heading level
            let newSummary;
            if (parentNode.type.name === "heading") {
              newSummary = state.schema.nodes.heading.create(
                { level: parentNode.attrs.level },
                afterContent.size > 0 ? afterContent : undefined,
              );
            } else {
              newSummary = state.schema.nodes.paragraph.create(
                null,
                afterContent.size > 0 ? afterContent : undefined,
              );
            }
            const newToggle = state.schema.nodes.toggle.create(
              { open: false },
              [newSummary],
            );
            tr.insert(toggleAfterPos, newToggle);
            // Cursor at start of new toggle's summary (+1 toggle open, +1 summary open)
            tr.setSelection(
              TextSelection.create(tr.doc, toggleAfterPos + 2),
            );

            view.dispatch(tr);
            return true;
          }

          // Expanded: let default ProseMirror splitBlock handle it
          // (creates new paragraph inside toggle as second child)
          return false;
        }

        // === Body (not summary): exit on empty last child ===
        const isLastChild = childIndex === toggleNode.childCount - 1;
        if (!isLastChild) return false;
        if (parentNode.content.size !== 0) return false;

        // Delete empty paragraph, create paragraph after toggle
        const { tr } = state;
        const emptyParaStart = $from.before($from.depth);
        const emptyParaEnd = $from.after($from.depth);
        tr.delete(emptyParaStart, emptyParaEnd);

        const toggleAfter = $from.after(toggleDepth);
        const mappedEnd = tr.mapping.map(toggleAfter);
        const para = state.schema.nodes.paragraph.create();
        tr.insert(mappedEnd, para);
        tr.setSelection(TextSelection.create(tr.doc, mappedEnd + 1));

        view.dispatch(tr);
        return true;
      },

      // Backspace at start of summary → unwrap toggle (children become siblings)
      Backspace: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        const toggleDepth = findToggleDepth($from, this.name);
        if (toggleDepth < 0) return false;

        const childIndex = $from.index(toggleDepth);
        if (childIndex !== 0 || $from.parentOffset !== 0) return false;

        // Unwrap: replace toggle with its children
        const toggleNode = $from.node(toggleDepth);
        const toggleStart = $from.before(toggleDepth);
        const toggleEnd = $from.after(toggleDepth);
        const { tr } = state;
        tr.replaceWith(toggleStart, toggleEnd, toggleNode.content);
        tr.setSelection(TextSelection.create(tr.doc, toggleStart + 1));

        view.dispatch(tr);
        return true;
      },

      // ArrowDown: collapsed summary → skip to next sibling; last body child → exit
      ArrowDown: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        const toggleDepth = findToggleDepth($from, this.name);
        if (toggleDepth < 0) return false;

        const toggleNode = $from.node(toggleDepth);
        const childIndex = $from.index(toggleDepth);
        const isOpen = toggleNode.attrs.open as boolean;
        const atEnd = $from.parentOffset === $from.parent.content.size;

        // Collapsed summary: skip body, jump to next sibling
        if (childIndex === 0 && !isOpen && atEnd) {
          return moveAfterToggle(state, view, toggleDepth);
        }

        // Last body child at end: exit toggle
        const isLastChild = childIndex === toggleNode.childCount - 1;
        if (isLastChild && atEnd) {
          return moveAfterToggle(state, view, toggleDepth);
        }

        return false;
      },

      // Cmd+Enter: toggle open/close
      "Mod-Enter": () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;

        const toggleDepth = findToggleDepth($from, this.name);
        if (toggleDepth < 0) return false;

        const toggleNode = $from.node(toggleDepth);
        const pos = $from.before(toggleDepth);
        const { tr } = state;
        tr.setNodeMarkup(pos, undefined, {
          ...toggleNode.attrs,
          open: !toggleNode.attrs.open,
        });
        view.dispatch(tr);
        return true;
      },
    };
  },
});
