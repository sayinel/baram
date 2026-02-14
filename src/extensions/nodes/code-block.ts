// §5.1 Code Block Extension (fenced code blocks)
import { Node, mergeAttributes, textblockTypeInputRule } from "@tiptap/core";

export interface CodeBlockOptions {
  HTMLAttributes: Record<string, string>;
  languageClassPrefix: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    codeBlock: {
      setCodeBlock: (attributes?: { language: string }) => ReturnType;
      toggleCodeBlock: (attributes?: { language: string }) => ReturnType;
    };
  }
}

export const CodeBlock = Node.create<CodeBlockOptions>({
  name: "codeBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      languageClassPrefix: "language-",
    };
  },

  addAttributes() {
    return {
      language: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full" as const,
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "pre",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      [
        "code",
        node.attrs.language
          ? { class: `${this.options.languageClassPrefix}${node.attrs.language}` }
          : {},
        0,
      ],
    ];
  },

  addCommands() {
    return {
      setCodeBlock:
        (attributes) =>
        ({ commands }) =>
          commands.setNode(this.name, attributes),
      toggleCodeBlock:
        (attributes) =>
        ({ commands }) =>
          commands.toggleNode(this.name, "paragraph", attributes),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-c": () => this.editor.commands.toggleCodeBlock(),
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^```([a-z]*)\s$/,
        type: this.type,
        getAttributes: (match) => ({ language: match[1] || null }),
      }),
    ];
  },
});
