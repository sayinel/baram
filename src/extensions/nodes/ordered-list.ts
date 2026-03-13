// §5.1 Ordered List Extension
import { mergeAttributes, Node, wrappingInputRule } from "@tiptap/core";

export interface OrderedListOptions {
  HTMLAttributes: Record<string, string>;
  itemTypeName: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    orderedList: {
      toggleOrderedList: () => ReturnType;
    };
  }
}

export const OrderedList = Node.create<OrderedListOptions>({
  name: "orderedList",
  group: "block",
  content: "listItem+",

  addOptions() {
    return {
      HTMLAttributes: {},
      itemTypeName: "listItem",
    };
  },

  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (el) => parseInt(el.getAttribute("start") || "1", 10),
      },
    };
  },

  parseHTML() {
    return [{ tag: "ol" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs =
      node.attrs.start === 1
        ? HTMLAttributes
        : { ...HTMLAttributes, start: node.attrs.start };
    return ["ol", mergeAttributes(this.options.HTMLAttributes, attrs), 0];
  },

  addCommands() {
    return {
      toggleOrderedList:
        () =>
        ({ commands }) =>
          commands.toggleList(this.name, this.options.itemTypeName),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-7": () => this.editor.commands.toggleOrderedList(),
    };
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*(\d+)\.\s$/,
        type: this.type,
        getAttributes: (match) => ({ start: parseInt(match[1], 10) }),
      }),
    ];
  },
});
