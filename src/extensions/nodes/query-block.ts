// §5.13 Query Block Extension — ```query (atom:true)
import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    queryBlock: {
      setQueryBlock: () => ReturnType;
    };
  }
}

export const QueryBlock = Node.create({
  name: "queryBlock",
  group: "block",
  atom: true,
  defining: true,

  addAttributes() {
    return {
      query: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="queryBlock"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "queryBlock",
        class: "query-block",
      }),
    ];
  },

  addCommands() {
    return {
      setQueryBlock:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { query: "" } })
            .run(),
    };
  },
});
