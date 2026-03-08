// §46 Prompt Lint — ProseMirror decoration plugin for Skill prompt analysis
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";
import { lintPrompt } from "../../utils/prompt-linter";
import type { LintResult } from "../../utils/prompt-linter";
import { useSkillStore } from "../../stores/skill-store";

export const promptLintKey = new PluginKey("promptLint");

/** Lint result with positions mapped to ProseMirror document coordinates. */
export interface PmLintResult extends LintResult {
  pmFrom: number;
  pmTo: number;
}

interface PromptLintState {
  decorations: DecorationSet;
  results: PmLintResult[];
}

/**
 * Check if the current document is a Skills file (frontmatter with name + description).
 */
function isSkillsFile(doc: PmNode): boolean {
  const firstChild = doc.firstChild;
  if (firstChild?.type.name === "frontmatter") {
    const yaml = (firstChild.attrs?.yaml as string) || firstChild.textContent || "";
    if (/^name\s*:/m.test(yaml) && /^description\s*:/m.test(yaml)) return true;
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
 * Build decorations and mapped lint results from the document.
 */
function buildLintState(doc: PmNode): PromptLintState {
  if (!isSkillsFile(doc)) {
    useSkillStore.getState().setLintResults([]);
    return { decorations: DecorationSet.empty, results: [] };
  }

  const { text, offsetMap } = extractDocText(doc);
  const rawResults = lintPrompt(text);

  if (rawResults.length === 0) {
    useSkillStore.getState().setLintResults([]);
    return { decorations: DecorationSet.empty, results: [] };
  }

  const decorations: Decoration[] = [];
  const results: PmLintResult[] = [];

  for (const result of rawResults) {
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

    results.push({
      ...result,
      pmFrom: from,
      pmTo: to,
    });
  }

  // §72c Push lint results to skill store for shared access
  useSkillStore.getState().setLintResults(
    results.map((r) => ({
      rule: r.rule,
      message: r.message,
      from: r.pmFrom,
      to: r.pmTo,
      severity: r.severity,
    })),
  );

  return {
    decorations: DecorationSet.create(doc, decorations),
    results,
  };
}

/**
 * Get the current prompt lint results (with PM positions) from editor state.
 */
export function getPromptLintResults(state: EditorState): PmLintResult[] {
  const pluginState = promptLintKey.getState(state) as PromptLintState | undefined;
  return pluginState?.results ?? [];
}

export const PromptLint = Extension.create({
  name: "promptLint",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: promptLintKey,
        state: {
          init(_, { doc }): PromptLintState {
            return buildLintState(doc);
          },
          apply(tr, old: PromptLintState): PromptLintState {
            if (tr.docChanged) {
              return buildLintState(tr.doc);
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            const pluginState = promptLintKey.getState(state) as PromptLintState | undefined;
            return pluginState?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
