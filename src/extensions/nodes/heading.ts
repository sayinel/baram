// §5.1 Heading Extension (H1-H6)
import { Node, mergeAttributes } from "@tiptap/core";
import { textblockTypeInputRule } from "@tiptap/core";

export interface HeadingOptions {
  levels: number[];
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    heading: {
      setHeading: (attributes: { level: number }) => ReturnType;
      toggleHeading: (attributes: { level: number }) => ReturnType;
    };
  }
}

export const Heading = Node.create<HeadingOptions>({
  name: "heading",
  group: "block",
  content: "inline*",
  defining: true,

  addOptions() {
    return {
      levels: [1, 2, 3, 4, 5, 6],
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      level: { default: 1, rendered: false },
    };
  },

  parseHTML() {
    return this.options.levels.map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    }));
  },

  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level as number;
    return [
      `h${level}`,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setHeading:
        (attributes) =>
        ({ commands }) =>
          commands.setNode(this.name, attributes),
      toggleHeading:
        (attributes) =>
        ({ commands }) =>
          commands.toggleNode(this.name, "paragraph", attributes),
    };
  },

  addKeyboardShortcuts() {
    return this.options.levels.reduce(
      (shortcuts, level) => ({
        ...shortcuts,
        [`Mod-${level}`]: () =>
          this.editor.commands.toggleHeading({ level }),
      }),
      {} as Record<string, () => boolean>,
    );
  },

  addInputRules() {
    return this.options.levels.map((level) =>
      textblockTypeInputRule({
        find: new RegExp(`^(#{${level}})\\s$`),
        type: this.type,
        getAttributes: () => ({ level }),
      }),
    );
  },
});
