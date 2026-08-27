// §56m Tag Inline Atom Node — #tag as ProseMirror inline atom
import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { TAG_BODY } from "../../utils/tags/tag-lexicon";
import { htmlAttributesOptions } from "../utils/html-attributes-options";
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

  ...htmlAttributesOptions,

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
    // Match #tag followed by space — convert typed #tag into atom node.
    // 글자 어휘는 `tag-lexicon.ts`가 갖는다: 여기서 다시 적으면 친 것(입력 규칙)과
    // 연 것(`TAG_NODE_RE`)이 서로 다른 태그를 만든다.
    return [
      new InputRule({
        find: new RegExp(`#(${TAG_BODY})\\s$`),
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
