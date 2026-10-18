// §5.1 Code Block Extension (fenced code blocks)
import { mergeAttributes, Node, textblockTypeInputRule } from "@tiptap/core";

import { codeBlockRendererFor } from "../../plugins/rendered/code-block-registry";
import { resolveShortcut } from "../utils/shortcut-resolver";
import { JournalBlockNodeView } from "./journal-block-node-view";
import { CodeBlockNodeView } from "./views/code-block-node-view";
import { codeBlockRenderGenerationPlugin } from "./views/code-block-render-generation";
import { RenderedCodeBlockView } from "./views/rendered-code-block-view";

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
          ? {
              class: `${this.options.languageClassPrefix}${node.attrs.language}`,
            }
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
    const key = resolveShortcut("formatting.codeBlock", "Mod-Alt-c");
    return { [key]: () => this.editor.commands.toggleCodeBlock() };
  },

  addNodeView() {
    return ({ node, view, getPos, editor }) => {
      const lang = (node.attrs.language as string) ?? "";
      if (lang.startsWith("journal-")) {
        return new JournalBlockNodeView(
          node,
          view,
          getPos as () => number | undefined,
        );
      }
      // §394 spec 0073 D6 — a language a plugin renderer is bound to draws through the plugin; the
      // node and its markdown are unchanged. A file-mode window loads no plugins, so its registry is
      // empty and every block stays CodeMirror (D17).
      const binding = codeBlockRendererFor(lang);
      if (binding !== null) {
        return new RenderedCodeBlockView(
          node,
          view,
          getPos as () => number | undefined,
          editor,
          binding,
        );
      }
      return new CodeBlockNodeView(
        node,
        view,
        getPos as () => number | undefined,
        editor,
      );
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        // §394 spec 0073 D5 — `[a-z0-9-]`, the grammar of a plugin's language name, so one can be typed.
        find: /^```([a-z0-9-]*)\s$/,
        type: this.type,
        getAttributes: (match) => ({ language: match[1] || null }),
      }),
    ];
  },

  // §394 spec 0073 D6 — carries renderer-registry changes to the views as node decorations.
  addProseMirrorPlugins() {
    return [codeBlockRenderGenerationPlugin()];
  },
});
