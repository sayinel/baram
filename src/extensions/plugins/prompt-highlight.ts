import type { Node as PmNode } from "@tiptap/pm/model";

// §41 Prompt Syntax Highlighting — decoration plugin for Skills files
// §72 Cmd+click file path navigation
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { changedRanges } from "../../utils/editor/changed-ranges";

export const promptHighlightKey = new PluginKey("promptHighlight");

export interface FilePathMatch {
  end: number;
  path: string;
  start: number;
}

/** Extract file path references from text (exported for testing) */
export function extractFilePaths(text: string): FilePathMatch[] {
  // Match: ./path, ../path, /path, or bare relative paths like agents/executor.md
  // Bare paths must follow a colon, whitespace, or be at line start to avoid URL false positives
  const regex =
    /(?:\.\.?\/[a-zA-Z0-9_./-]+\.[a-zA-Z]+|\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[a-zA-Z]+|(?:(?<=[:\s])|^)[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+\.[a-zA-Z]+)/gm;
  const matches: FilePathMatch[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      path: match[0].trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return matches;
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
        Decoration.inline(
          pos + match.index,
          pos + match.index + match[0].length,
          {
            class: "prompt-xml-tag",
          },
        ),
      );
    }

    // Mustache variables: {{var}}
    const mustacheRegex = /\{\{[\w.]+\}\}/g;
    while ((match = mustacheRegex.exec(text)) !== null) {
      decorations.push(
        Decoration.inline(
          pos + match.index,
          pos + match.index + match[0].length,
          {
            class: "prompt-variable",
          },
        ),
      );
    }

    // File paths: ./path, ../path, /path, or bare relative paths like agents/executor.md
    const filePaths = extractFilePaths(text);
    for (const fp of filePaths) {
      decorations.push(
        Decoration.inline(pos + fp.start, pos + fp.end, {
          class: "prompt-filepath",
          nodeName: "span",
          "data-filepath": fp.path,
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Collect fresh decorations for a range of the doc (expanded to textblock
 * boundaries) and return them for incremental merging.
 * Patterns are per-text-node so they never span block boundaries.
 */
function collectDecosInRange(
  doc: PmNode,
  from: number,
  to: number,
): Decoration[] {
  const fresh: Decoration[] = [];
  doc.nodesBetween(from, to, (node: PmNode, pos: number) => {
    if (!node.isText) return true;
    const text = node.text ?? "";

    const xmlRegex = /<\/?[a-zA-Z][\w-]*(?:\s+[^>]*)?\s*\/?>/g;
    let match;
    while ((match = xmlRegex.exec(text)) !== null) {
      fresh.push(
        Decoration.inline(
          pos + match.index,
          pos + match.index + match[0].length,
          { class: "prompt-xml-tag" },
        ),
      );
    }

    const mustacheRegex = /\{\{[\w.]+\}\}/g;
    while ((match = mustacheRegex.exec(text)) !== null) {
      fresh.push(
        Decoration.inline(
          pos + match.index,
          pos + match.index + match[0].length,
          { class: "prompt-variable" },
        ),
      );
    }

    const filePaths = extractFilePaths(text);
    for (const fp of filePaths) {
      fresh.push(
        Decoration.inline(pos + fp.start, pos + fp.end, {
          class: "prompt-filepath",
          nodeName: "span",
          "data-filepath": fp.path,
        }),
      );
    }
    return true;
  });
  return fresh;
}

// Detect if current document is a Skills file
function isSkillsFile(doc: PmNode): boolean {
  // Check first node for frontmatter with name + description
  const firstChild = doc.firstChild;
  if (firstChild?.type.name === "frontmatter") {
    const yaml =
      (firstChild.attrs?.yaml as string) || firstChild.textContent || "";
    if (/^name\s*:/m.test(yaml) && /^description\s*:/m.test(yaml)) return true;
  }
  return false;
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
            if (!tr.docChanged) return old;
            if (!isSkillsFile(tr.doc)) return DecorationSet.empty;
            // §perf-large-file C3.1: incremental update over changed ranges
            let decos = old.map(tr.mapping, tr.doc);
            const ranges = changedRanges(tr);
            for (const range of ranges) {
              // Expand to enclosing textblock boundaries
              let { from, to } = range;
              const $from = tr.doc.resolve(Math.max(0, from));
              const $to = tr.doc.resolve(Math.min(tr.doc.content.size, to));
              from = $from.start($from.depth > 0 ? $from.depth : 0);
              to = $to.end($to.depth > 0 ? $to.depth : 0);
              from = Math.max(0, from);
              to = Math.min(tr.doc.content.size, to);

              const stale = decos.find(from, to);
              if (stale.length > 0) decos = decos.remove(stale);
              const fresh = collectDecosInRange(tr.doc, from, to);
              if (fresh.length > 0) decos = decos.add(tr.doc, fresh);
            }
            return decos;
          },
        },
        props: {
          decorations(state) {
            return promptHighlightKey.getState(state) as DecorationSet;
          },
          handleClick(_view, _pos, event) {
            if (!(event.metaKey || event.ctrlKey)) return false;
            const target = event.target as HTMLElement;
            const el = target.closest("[data-filepath]");
            const filepath = el?.getAttribute("data-filepath");
            if (!filepath) return false;

            window.dispatchEvent(
              new CustomEvent("baram:open-filepath", {
                detail: { path: filepath },
              }),
            );
            return true;
          },
        },
      }),
    ];
  },
});
