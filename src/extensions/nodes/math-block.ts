// §5.3 Math Block Extension — $$...$$ (atom:true, textarea editing)
import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";
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
export interface MathBlockEntryState {
  direction: "above" | "below";
}

export const mathBlockEntryKey = new PluginKey<MathBlockEntryState>(
  "mathBlockEntry",
);

export const MathBlock = Node.create<MathBlockOptions>({
  name: "mathBlock",
  group: "block",
  atom: true,
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

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
    return ReactNodeViewRenderer(MathBlockView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<MathBlockEntryState>({
        key: mathBlockEntryKey,
        state: {
          init() {
            return { direction: "above" };
          },
          apply(tr, value, oldState) {
            const newSel = tr.selection;
            const oldSel = oldState.selection;
            // Detect when a mathBlock node becomes selected
            if (
              newSel instanceof NodeSelection &&
              newSel.node.type.name === "mathBlock"
            ) {
              // Only update direction on fresh entry (not re-selection of same node)
              if (
                !(oldSel instanceof NodeSelection) ||
                oldSel.from !== newSel.from
              ) {
                const enteredFromBelow = oldSel.from > newSel.from;
                return { direction: enteredFromBelow ? "below" : "above" };
              }
            }
            return value;
          },
        },
      }),
    ];
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
    return {
      "Mod-Shift-m": () => this.editor.commands.setMathBlock(),
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
          // Replace the current paragraph with an empty mathBlock
          tr.replaceWith(
            $start.before($start.depth),
            $start.after($start.depth),
            type.create({ formula: "" }),
          );
        },
      }),
    ];
  },
});
