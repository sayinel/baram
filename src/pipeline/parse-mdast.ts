// §perf-large-file B1: Pure mdast parsing — no ProseMirror deps, safe for Web Worker
//
// Extracted from md-to-pm.ts so this module can be imported by both
// the main thread and a Web Worker without pulling in DOM/PM dependencies.

import type { Content, Root } from "mdast";

import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** remark parser — markdown string → mdast */
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"]);

/**
 * Detect extra blank lines between top-level blocks in the original markdown
 * and insert empty paragraph nodes into the mdast tree to preserve them.
 *
 * Markdown collapses multiple blank lines into one separator, but WYSIWYG
 * editors need to preserve empty paragraphs for the user's formatting.
 *
 * Formula: between two blocks, if the gap has N newlines,
 * empty paragraphs = floor((N - 2) / 2).
 * (2 newlines = standard separator, each additional pair = 1 empty paragraph)
 */
export function enrichWithEmptyParagraphs(root: Root, markdown: string): Root {
  const children = root.children;
  if (children.length === 0) return root;

  const enriched: Content[] = [];

  for (let i = 0; i < children.length; i++) {
    enriched.push(children[i]);

    if (i < children.length - 1) {
      const gapStart = children[i].position?.end?.offset;
      const gapEnd = children[i + 1].position?.start?.offset;

      if (gapStart != null && gapEnd != null && gapEnd > gapStart) {
        const gap = markdown.substring(gapStart, gapEnd);
        const newlineCount = (gap.match(/\n/g) || []).length;
        const emptyParas = Math.max(0, Math.floor((newlineCount - 2) / 2));

        for (let j = 0; j < emptyParas; j++) {
          enriched.push({
            type: "paragraph",
            children: [],
          } as Content);
        }
      }
    }
  }

  return { ...root, children: enriched };
}

/** Parse markdown string to mdast tree */
export function parseMdast(markdown: string): Root {
  return parser.parse(markdown) as Root;
}
