// §5.5 Mermaid Block Extension — ```mermaid (atom:true, dual mode)
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { resolveShortcut } from "../utils/shortcut-resolver";
import { MermaidBlockView } from "./mermaid-block-view";

export interface MermaidBlockOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaidBlock: {
      setMermaidBlock: () => ReturnType;
    };
  }
}

export interface MermaidBlockEntryState {
  direction: "above" | "below";
}

export const mermaidBlockEntryKey = new PluginKey<MermaidBlockEntryState>(
  "mermaidBlockEntry",
);

export const MermaidBlock = Node.create<MermaidBlockOptions>({
  name: "mermaidBlock",
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
      code: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mermaidBlock"]',
        getAttrs: (el) => ({
          code: (el as HTMLElement).textContent || "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "mermaidBlock",
        class: "mermaid-block",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidBlockView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<MermaidBlockEntryState>({
        key: mermaidBlockEntryKey,
        state: {
          init() {
            return { direction: "above" };
          },
          apply(tr, value, oldState) {
            const newSel = tr.selection;
            const oldSel = oldState.selection;
            if (
              newSel instanceof NodeSelection &&
              newSel.node.type.name === "mermaidBlock"
            ) {
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
        props: {
          handleClickOn(view, _pos, node, nodePos, _event, direct) {
            if (node.type.name === "mermaidBlock" && direct) {
              const tr = view.state.tr.setSelection(
                NodeSelection.create(view.state.doc, nodePos),
              );
              view.dispatch(tr);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setMermaidBlock:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { code: "flowchart LR\n  A --> B" },
            })
            .run(),
    };
  },

  addKeyboardShortcuts() {
    const key = resolveShortcut("formatting.mermaid", "Mod-Shift-d");
    return { [key]: () => this.editor.commands.setMermaidBlock() };
  },
});
