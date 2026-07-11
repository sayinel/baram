// §5.1 SVG Block Extension — ```svg fenced block (atom:true, dual mode)
import { mergeAttributes, Node } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import {
  AtomBlockEntryState,
  createAtomBlockEntryPlugin,
} from "./atom-block-entry-plugin";
import { SvgBlockView } from "./svg-block-view";

export interface SvgBlockOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    svgBlock: {
      setSvgBlock: () => ReturnType;
    };
  }
}

export type SvgBlockEntryState = AtomBlockEntryState;

export const svgBlockEntryKey = new PluginKey<SvgBlockEntryState>(
  "svgBlockEntry",
);

const DEFAULT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="4" />\n</svg>';

export const SvgBlock = Node.create<SvgBlockOptions>({
  name: "svgBlock",
  group: "block",
  atom: true,
  defining: true,

  ...htmlAttributesOptions,

  addAttributes() {
    return {
      code: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="svgBlock"]',
        getAttrs: (el) => ({
          code: (el as HTMLElement).getAttribute("data-code") || "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "svgBlock",
        "data-code": HTMLAttributes.code as string,
        class: "svg-block",
      }),
    ];
  },

  addNodeView() {
    // trackNodeViewPosition: keep the cached NodeView position fresh when an
    // edit above shifts this atom (e.g. merging table cells / typing above).
    // Without it, @tiptap/react's stale currentPos makes handleSelectionUpdate
    // reject a valid NodeSelection, so the block can't enter edit mode on click
    // until the doc is reopened. See math-block.ts for the full explanation.
    return ReactNodeViewRenderer(SvgBlockView, { trackNodeViewPosition: true });
  },

  addProseMirrorPlugins() {
    return [createAtomBlockEntryPlugin("svgBlock", svgBlockEntryKey)];
  },

  addCommands() {
    return {
      setSvgBlock:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { code: DEFAULT_SVG } })
            .run(),
    };
  },
});
