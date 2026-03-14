// §5.8 YAML Frontmatter Extension — ---\nyaml\n---
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { FrontmatterView } from "./frontmatter-view";

export interface FrontmatterOptions {
  HTMLAttributes: Record<string, string>;
}

export const Frontmatter = Node.create<FrontmatterOptions>({
  name: "frontmatter",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  ...htmlAttributesOptions,

  addAttributes() {
    return {
      yaml: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="frontmatter"]',
        preserveWhitespace: "full" as const,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "frontmatter",
        class: "frontmatter",
      }),
      ["pre", ["code", 0]],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FrontmatterView);
  },
});
