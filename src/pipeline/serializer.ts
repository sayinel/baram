// serializer.ts — §3.3 mdast → Markdown string serialization
//
// Extracted from pm-to-md.ts to allow transformers to serialize sub-trees
// without circular dependency (pm-to-md → transformers → pm-to-md).
//
// §7.1 Serialization Rules:
// - Bold: ** (never __), Italic: * (never _)
// - List marker: - (never * or +)
// - Horizontal rule: ---
// - Code block: fenced (```)
// - 1 blank line between block elements
// - Single newline at file end

import type { Root } from "mdast";

import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

/** §28 Remark plugin: serialize wikiLink + §30b blockReference + custom inline marks */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function remarkWikiLink(this: any) {
  const data = this.data();
  const key = "toMarkdownExtensions";
  const list: unknown[] = data[key] || (data[key] = []);
  list.push({
    handlers: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wikiLink(node: { value: string }, _parent: any, state: any, info: any) {
        const tracker = state.createTracker(info);
        return tracker.move(node.value);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mention(node: { value: string }, _parent: any, state: any, info: any) {
        const tracker = state.createTracker(info);
        return tracker.move(node.value);
      },
      blockReference(
        node: { value: string },
        _parent: any, // eslint-disable-line @typescript-eslint/no-explicit-any
        state: any, // eslint-disable-line @typescript-eslint/no-explicit-any
        info: any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ) {
        const tracker = state.createTracker(info);
        return tracker.move(node.value);
      },
      // Custom inline marks — return pre-serialized value verbatim
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      highlight(node: { value: string }, _parent: any, state: any, info: any) {
        const tracker = state.createTracker(info);
        return tracker.move(node.value);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subscript(node: { value: string }, _parent: any, state: any, info: any) {
        const tracker = state.createTracker(info);
        return tracker.move(node.value);
      },
      superscript(
        node: { value: string },
        _parent: any, // eslint-disable-line @typescript-eslint/no-explicit-any
        state: any, // eslint-disable-line @typescript-eslint/no-explicit-any
        info: any, // eslint-disable-line @typescript-eslint/no-explicit-any
      ) {
        const tracker = state.createTracker(info);
        return tracker.move(node.value);
      },
      // §56m: Tag node — output verbatim #tag string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tagNode(node: { value: string }, _parent: any, state: any, info: any) {
        const tracker = state.createTracker(info);
        return tracker.move(node.value);
      },
    },
  });
}

/** remark serializer — mdast → markdown string */
const serializer = unified()
  .use(remarkStringify, {
    bullet: "-", // §7.1: 항상 -
    strong: "*", // §7.1: 항상 ** (remark uses strong char doubled)
    emphasis: "*", // §7.1: 항상 *
    rule: "-", // §7.1: 항상 ---
    fences: true, // §7.1: fenced code block
    listItemIndent: "one", // compact indent
    tightDefinitions: true,
  } as Parameters<typeof remarkStringify>[0])
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkWikiLink);

/** Serialize mdast tree to markdown string */
export function mdastToMarkdown(root: Root): string {
  let result = serializer.stringify(root);
  // §56l: remark-stringify escapes # at line start (atBreak), but #tag (no space)
  // is never heading syntax — unescape when followed by word characters.
  result = result.replace(/\\#(?=[\w가-힣])/g, "#");
  // §56m: remark-stringify encodes trailing spaces as &#x20; when the last inline
  // node is a tagNode followed by a whitespace-only text node.  Strip at end of lines.
  result = result.replace(/&#x20;(?=\n|$)/g, "");
  return result;
}
