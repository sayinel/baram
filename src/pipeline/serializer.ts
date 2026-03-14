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

import type { Parents, Root } from "mdast";
import type { Info, State } from "mdast-util-to-markdown";

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

  // All custom inline nodes return their pre-serialized value verbatim

  const verbatimHandler = (
    node: { value: string },
    _parent: Parents | undefined,
    state: State,
    info: Info,
  ) => state.createTracker(info).move(node.value);

  const verbatimTypes = [
    "blockReference",
    "highlight",
    "mention",
    "subscript",
    "superscript",
    "tagNode",
    "wikiLink",
  ] as const;

  list.push({
    handlers: Object.fromEntries(
      verbatimTypes.map((name) => [name, verbatimHandler]),
    ),
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
