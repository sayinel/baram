// §5.1 HTML Block Extension — raw HTML block preservation (atom:true)
import { mergeAttributes, Node } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { HtmlBlockView } from "./html-block-view";

export interface HtmlBlockOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    htmlBlock: {
      setHtmlBlock: () => ReturnType;
    };
  }
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

  addCommands() {
    return {
      // Insert an empty HTML block and select it so its source editor opens
      // immediately (the view shows the textarea while the node is selected).
      setHtmlBlock:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { content: "" } })
            .command(({ tr, dispatch }) => {
              if (dispatch) {
                // insertContent leaves the cursor just after the atom (size 1).
                const nodePos = tr.selection.from - 1;
                const inserted = tr.doc.nodeAt(nodePos);
                if (inserted?.type.name === this.name) {
                  tr.setSelection(NodeSelection.create(tr.doc, nodePos));
                }
              }
              return true;
            })
            .run(),
    };
  },
});
