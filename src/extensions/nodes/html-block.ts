// §5.1 HTML Block Extension — raw HTML block preservation (atom:true)
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { HtmlBlockView } from "./html-block-view";

export interface HtmlBlockOptions {
  HTMLAttributes: Record<string, string>;
}

export const HtmlBlock = Node.create<HtmlBlockOptions>({
  name: "htmlBlock",
  group: "block",
  atom: true,
  defining: true,

  ...htmlAttributesOptions,

  addAttributes() {
    return {
      content: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="htmlBlock"]',
        getAttrs: (el) => ({
          content: (el as HTMLElement).getAttribute("data-content") || "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "htmlBlock",
        "data-content": HTMLAttributes.content as string,
        class: "html-block",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(HtmlBlockView);
  },
});
