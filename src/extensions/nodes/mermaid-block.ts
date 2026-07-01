// §5.5 Mermaid Block Extension — ```mermaid (atom:true, dual mode)
import { mergeAttributes, Node } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";
import {
  AtomBlockEntryState,
  createAtomBlockEntryPlugin,
} from "./atom-block-entry-plugin";
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

export type MermaidBlockEntryState = AtomBlockEntryState;

export const mermaidBlockEntryKey = new PluginKey<MermaidBlockEntryState>(
  "mermaidBlockEntry",
);

export const MermaidBlock = Node.create<MermaidBlockOptions>({
  name: "mermaidBlock",
  group: "block",
  atom: true,
  defining: true,

  ...htmlAttributesOptions,

  addAttributes() {
    return {
      code: { default: "" },
      // §5.5 display width (% of block) and caption. Stored as node attrs and
      // serialized into a `%% baram-meta` fence comment by the transformer, so
      // the editable `code` stays a pure mermaid diagram. data-* on the editor
      // HTML keeps them on copy/paste.
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const w = el.getAttribute("data-width");
          return w ? parseFloat(w) : null;
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.width != null ? { "data-width": String(attrs.width) } : {},
      },
      caption: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-caption") || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.caption ? { "data-caption": String(attrs.caption) } : {},
      },
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
    return [createAtomBlockEntryPlugin("mermaidBlock", mermaidBlockEntryKey)];
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
