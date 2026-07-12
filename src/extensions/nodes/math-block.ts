// §5.3 Math Block Extension — $$...$$ (atom:true, textarea editing)
import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { NodeSelection, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";
import {
  type AtomBlockEntryState,
  createAtomBlockEntryPlugin,
} from "./atom-block-entry-plugin";
import { MathBlockView } from "./math-block-view";

export interface MathBlockOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathBlock: {
      setMathBlock: () => ReturnType;
    };
  }
}

// Plugin state: tracks entry direction when a mathBlock gets selected
export type MathBlockEntryState = AtomBlockEntryState;

export const mathBlockEntryKey = new PluginKey<MathBlockEntryState>(
  "mathBlockEntry",
);

export const MathBlock = Node.create<MathBlockOptions>({
  name: "mathBlock",
  group: "block",
  atom: true,
  defining: true,

  ...htmlAttributesOptions,

  addAttributes() {
    return {
      formula: { default: "" },
      mathSize: { default: "normal" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mathBlock"]',
        getAttrs: (el) => ({
          formula: (el as HTMLElement).textContent || "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "mathBlock",
        "data-math-size": node.attrs.mathSize || "normal",
        class: "math-block",
      }),
    ];
  },

  addNodeView() {
    // trackNodeViewPosition: keep the NodeView's cached position (`currentPos`)
    // in sync when an edit ABOVE shifts this block (e.g. merging table cells,
    // typing in a paragraph above). Without it, @tiptap/react only refreshes
    // currentPos on mount / update(), and a pure position shift never calls
    // update() on the unchanged atom — so handleSelectionUpdate compares the
    // live NodeSelection against a stale pos, decides "not selected", and the
    // block can no longer enter edit mode on click until the doc is reopened.
    return ReactNodeViewRenderer(MathBlockView, {
      trackNodeViewPosition: true,
    });
  },

  addProseMirrorPlugins() {
    return [createAtomBlockEntryPlugin("mathBlock", mathBlockEntryKey)];
  },

  addCommands() {
    return {
      setMathBlock:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { formula: "" } })
            .run(),
    };
  },

  addKeyboardShortcuts() {
    const key = resolveShortcut("formatting.mathBlock", "Mod-Shift-m");
    return {
      [key]: () => this.editor.commands.setMathBlock(),
      Enter: () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        if (
          $from.parent.type.name === "paragraph" &&
          $from.parent.textContent === "$$"
        ) {
          const pos = $from.before();
          const { tr } = state;
          tr.replaceWith(pos, $from.after(), this.type.create({ formula: "" }));
          tr.setSelection(NodeSelection.create(tr.doc, pos));
          this.editor.view.dispatch(tr);
          return true;
        }
        return false;
      },
    };
  },

  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: /^\$\$[\s\n]$/,
        handler({ state, range }) {
          const $start = state.doc.resolve(range.from);
          const { tr } = state;
          const blockPos = $start.before($start.depth);
          // Replace the current paragraph with an empty mathBlock
          tr.replaceWith(
            blockPos,
            $start.after($start.depth),
            type.create({ formula: "" }),
          );
          // Select the new mathBlock so NodeView enters edit mode
          tr.setSelection(NodeSelection.create(tr.doc, blockPos));
        },
      }),
    ];
  },
});
