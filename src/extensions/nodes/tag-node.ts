// §56m Tag Inline Atom Node — #tag as ProseMirror inline atom
import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { TagNodeView } from "./tag-node-view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tagNode: {
      insertTag: (attrs: { tag: string }) => ReturnType;
    };
  }
}

export interface TagNodeOptions {
  HTMLAttributes: Record<string, string>;
}

export const TagNode = Node.create<TagNodeOptions>({
  name: "tagNode",
  group: "inline",
  inline: true,
  atom: true,
  marks: "",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      tag: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="tag"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "tag",
        "data-tag": node.attrs.tag,
        class: "tag-node",
      }),
      `#${node.attrs.tag}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TagNodeView);
  },

  addCommands() {
    return {
      insertTag:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addInputRules() {
    // Match #tag followed by space — convert typed #tag into atom node
    // Regex: # then word chars (including Korean, /) then space at end
    return [
      new InputRule({
        find: /#([\w\uAC00-\uD7A3]+(?:\/[\w\uAC00-\uD7A3]+)*)\s$/,
        handler: ({ state, range, match }) => {
          const tag = match[1];
          const { tr } = state;
          // Replace the #tag + space with tagNode + space
          tr.replaceWith(range.from, range.to, [
            this.type.create({ tag }),
            state.schema.text(" "),
          ]);
        },
      }),
    ];
  },
});
