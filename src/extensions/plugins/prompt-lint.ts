// §46 Prompt Lint — ProseMirror decoration plugin for Skill prompt analysis
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";
import { lintPrompt } from "../../utils/prompt-linter";

export const promptLintKey = new PluginKey("promptLint");

/**
 * Check if the current document is a Skills file (frontmatter type: skill).
 */
function isSkillsFile(doc: PmNode): boolean {
  const firstChild = doc.firstChild;
  if (firstChild?.type.name === "frontmatter") {
    const yaml = (firstChild.attrs?.yaml as string) || firstChild.textContent || "";
    if (/type\s*:\s*skill/i.test(yaml)) return true;
  }
  return false;
}

/**
 * Extract plain text from the ProseMirror doc with approximate character offsets.
 * Returns the full text and a mapping from text offset to PM position.
 */
function extractDocText(doc: PmNode): { text: string; offsetMap: number[] } {
  let text = "";
  const offsetMap: number[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "frontmatter") {
      // Include frontmatter content
      const yaml = (node.attrs?.yaml as string) || node.textContent || "";
      const frontmatterText = `---\n${yaml}\n---\n`;
      for (let i = 0; i < frontmatterText.length; i++) {
        offsetMap.push(pos);
      }
      text += frontmatterText;
      return false;
    }
    if (node.isText) {
      const nodeText = node.text ?? "";
      for (let i = 0; i < nodeText.length; i++) {
        offsetMap.push(pos + i);
      }
      text += nodeText;
    } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      offsetMap.push(pos);
      text += "\n";
    }
    return true;
  });

  return { text, offsetMap };
}

/**
 * Build decorations from lint results.
 */
function buildLintDecorations(doc: PmNode): DecorationSet {
  if (!isSkillsFile(doc)) return DecorationSet.empty;

  const { text, offsetMap } = extractDocText(doc);
  const results = lintPrompt(text);

  if (results.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  for (const result of results) {
    // Map text offsets to PM positions
    const from = result.from < offsetMap.length ? offsetMap[result.from] : 0;
    const to = result.to < offsetMap.length ? offsetMap[Math.min(result.to - 1, offsetMap.length - 1)] + 1 : from + 1;

    if (from >= to || from < 0) continue;

    const cssClass = result.severity === "error" ? "prompt-lint-error" : "prompt-lint-warning";

    decorations.push(
      Decoration.inline(from, to, {
        class: cssClass,
        title: result.message,
      }),
    );
  }

  return DecorationSet.create(doc, decorations);
}

export const PromptLint = Extension.create({
  name: "promptLint",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: promptLintKey,
        state: {
          init(_, { doc }) {
            return buildLintDecorations(doc);
          },
          apply(tr, old) {
            if (tr.docChanged) {
              return buildLintDecorations(tr.doc);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return promptLintKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});
