// §41 Prompt Syntax Highlighting — decoration plugin for Skills files
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";

export const promptHighlightKey = new PluginKey("promptHighlight");

// Detect if current document is a Skills file
function isSkillsFile(doc: PmNode): boolean {
  // Check first node for frontmatter with type: skill
  const firstChild = doc.firstChild;
  if (firstChild?.type.name === "frontmatter") {
    const yaml = (firstChild.attrs?.yaml as string) || firstChild.textContent || "";
    if (/type\s*:\s*skill/i.test(yaml)) return true;
  }
  return false;
}

function buildDecorations(doc: PmNode): DecorationSet {
  if (!isSkillsFile(doc)) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  doc.descendants((node: PmNode, pos: number) => {
    if (!node.isText) return;
    const text = node.text ?? "";

    // XML tags: <tag> and </tag>
    const xmlRegex = /<\/?[a-zA-Z][\w-]*(?:\s+[^>]*)?\s*\/?>/g;
    let match;
    while ((match = xmlRegex.exec(text)) !== null) {
      decorations.push(
        Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
          class: "prompt-xml-tag",
        }),
      );
    }

    // Mustache variables: {{var}}
    const mustacheRegex = /\{\{[\w.]+\}\}/g;
    while ((match = mustacheRegex.exec(text)) !== null) {
      decorations.push(
        Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
          class: "prompt-variable",
        }),
      );
    }

    // File paths: /path/to/file or ./path
    const pathRegex = /(?:\.\/|\/)[a-zA-Z0-9_\-./]+\.[a-zA-Z]+/g;
    while ((match = pathRegex.exec(text)) !== null) {
      decorations.push(
        Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
          class: "prompt-filepath",
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

export const PromptHighlight = Extension.create({
  name: "promptHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: promptHighlightKey,
        state: {
          init(_, { doc }) {
            return buildDecorations(doc);
          },
          apply(tr, old) {
            if (tr.docChanged) {
              return buildDecorations(tr.doc);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return promptHighlightKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});
