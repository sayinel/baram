// md-to-pm.ts — §3.3 Markdown → ProseMirror Document 변환 파이프라인
//
// remark-parse → mdast → custom converter → ProseMirror Document
//
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, Content, PhrasingContent, Text } from "mdast";
import type { Node as PmNode, Schema, Mark } from "@tiptap/pm/model";
import { nodeTransformers, markTransformers, pmNodeTransformers } from "./transformers";
import { isStandaloneImage } from "./transformers/image-transformer";
import { parseCalloutHeader } from "./transformers/callout-transformer";
import {
  WIKILINK_RE,
  parseWikilinkMatch,
} from "./transformers/wikilink-transformer";
import {
  parseDetailsOpening,
  isDetailsClosing,
  isDetailsOpening,
} from "./transformers/toggle-transformer";
import { extractBlockId, BLOCK_REF_RE, parseBlockRefMatch, BLOCK_EMBED_RE, parseBlockEmbedMatch } from "./block-id";

/** remark parser — markdown string → mdast */
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm, { singleTilde: false })
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"]);

/** Parse markdown string to mdast tree */
export function parseMdast(markdown: string): Root {
  return parser.parse(markdown) as Root;
}

/** Convert mdast tree to ProseMirror document */
export function mdastToProsemirror(root: Root, schema: Schema): PmNode {
  const children = convertBlockChildren(root.children, schema);
  // Ensure at least one block node (doc content spec is "block+")
  if (children.length === 0) {
    children.push(schema.nodes.paragraph.create());
  }
  return schema.nodes.doc.create(null, children);
}

/** Full pipeline: markdown string → ProseMirror document */
export function markdownToProsemirror(
  markdown: string,
  schema: Schema,
): PmNode {
  const mdast = parseMdast(markdown);
  const enriched = enrichWithEmptyParagraphs(mdast, markdown);
  return mdastToProsemirror(enriched, schema);
}

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
function enrichWithEmptyParagraphs(root: Root, markdown: string): Root {
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

/** Convert block-level mdast children to PM nodes */
function convertBlockChildren(
  children: Content[],
  schema: Schema,
): PmNode[] {
  const result: PmNode[] = [];
  let i = 0;

  while (i < children.length) {
    const child = children[i];

    // §5.1: Detect <details> html pattern → toggle node
    if (child.type === "html" && schema.nodes.toggle) {
      const htmlVal = (child as { value: string }).value;
      if (isDetailsOpening(htmlVal)) {
        const toggleResult = tryConvertToggle(children, i, schema);
        if (toggleResult) {
          result.push(toggleResult.node);
          i = toggleResult.endIndex + 1;
          continue;
        }
      }
    }

    const node = convertBlockNode(child, schema);
    if (node) {
      if (Array.isArray(node)) {
        result.push(...node);
      } else {
        result.push(node);
      }
    }
    i++;
  }

  return result;
}

/**
 * §5.1: Try to convert a sequence of html(<details>...) + block* + html(</details>)
 * into a toggle PM node. Returns null if pattern not matched.
 */
function tryConvertToggle(
  children: Content[],
  startIndex: number,
  schema: Schema,
): { node: PmNode; endIndex: number } | null {
  const openHtml = (children[startIndex] as { value: string }).value;
  const parsed = parseDetailsOpening(openHtml);
  if (!parsed) return null;

  // Find matching </details>, handling nesting
  let depth = 1;
  let endIndex = -1;
  for (let j = startIndex + 1; j < children.length; j++) {
    if (children[j].type === "html") {
      const val = (children[j] as { value: string }).value;
      if (isDetailsOpening(val)) depth++;
      if (isDetailsClosing(val)) {
        depth--;
        if (depth === 0) {
          endIndex = j;
          break;
        }
      }
    }
  }

  if (endIndex === -1) return null; // No matching closing tag

  // Collect body children (between opening and closing html nodes)
  const bodyMdastChildren = children.slice(startIndex + 1, endIndex);

  // Recursively convert body children (handles nested toggles)
  const bodyPmNodes =
    bodyMdastChildren.length > 0
      ? convertBlockChildren(bodyMdastChildren, schema)
      : [];

  // Create summary node (first child of toggle)
  // Detect heading prefix: "## Title" → heading level 2
  const headingMatch = parsed.summary.match(/^(#{1,6})\s+(.*)$/);
  let summaryNode;
  if (headingMatch && schema.nodes.heading) {
    const level = headingMatch[1].length;
    const text = headingMatch[2];
    summaryNode = schema.nodes.heading.create(
      { level },
      text ? [schema.text(text)] : undefined,
    );
  } else {
    summaryNode = parsed.summary
      ? schema.nodes.paragraph.create(null, [schema.text(parsed.summary)])
      : schema.nodes.paragraph.create();
  }

  // Build toggle node: summary (paragraph or heading) + body blocks
  const toggleNode = schema.nodes.toggle.create(
    { open: parsed.isOpen },
    [summaryNode, ...bodyPmNodes],
  );

  return { node: toggleNode, endIndex };
}

/** Convert a single block-level mdast node to PM node(s) */
function convertBlockNode(
  node: Content,
  schema: Schema,
): PmNode | PmNode[] | null {
  // Special handling: paragraph with single image → block-level image
  if (isStandaloneImage(node)) {
    const imgNode = (node as { children: Content[] }).children[0];
    const transformer = nodeTransformers.get("image");
    if (transformer) {
      return transformer.mdastToPm(imgNode, schema, (parent) =>
        convertInlineChildren(
          (parent as { children: PhrasingContent[] }).children,
          schema,
          [],
        ),
      );
    }
  }

  // Lists — handle directly (bulletList/orderedList/taskList all share mdast type "list")
  if (node.type === "list") {
    return convertListNode(node, schema);
  }

  // List items
  if (node.type === "listItem") {
    const transformer = nodeTransformers.get("listItem");
    if (transformer) {
      return transformer.mdastToPm(node, schema, (parent) =>
        convertBlockChildren(
          (parent as { children: Content[] }).children,
          schema,
        ),
      );
    }
  }

  // Table — needs special child conversion: cell inline content → wrapped in paragraph
  if (node.type === "table") {
    return convertTableNode(node, schema);
  }

  // §5.5 Mermaid: code block with lang="mermaid" → mermaidBlock (if schema supports it)
  if (
    node.type === "code" &&
    (node as { lang?: string }).lang === "mermaid" &&
    schema.nodes.mermaidBlock
  ) {
    const mermaidTransformer = nodeTransformers.get("mermaid");
    if (mermaidTransformer) {
      return mermaidTransformer.mdastToPm(node, schema, () => []);
    }
  }

  // §30b: Detect block embed — paragraph with single text child matching {{embed ((...))}}
  if (node.type === "paragraph" && schema.nodes.blockEmbed) {
    const children = (node as { children?: Content[] }).children;
    if (children?.length === 1 && children[0].type === "text") {
      const text = (children[0] as Text).value;
      const embedMatch = BLOCK_EMBED_RE.exec(text);
      if (embedMatch) {
        const parsed = parseBlockEmbedMatch(embedMatch);
        return schema.nodes.blockEmbed.create({
          target: parsed.target,
          blockId: parsed.blockId,
        });
      }
    }
  }

  // [TOC]: Detect table of contents — paragraph with single text child "[TOC]" or "[toc]"
  if (node.type === "paragraph" && schema.nodes.tableOfContents) {
    const children = (node as { children?: Content[] }).children;
    if (children?.length === 1 && children[0].type === "text") {
      const text = (children[0] as Text).value.trim();
      if (text === "[TOC]" || text === "[toc]") {
        return schema.nodes.tableOfContents.create();
      }
    }
  }

  // §5.9: Detect callout — blockquote whose first paragraph starts with [!type]
  if (node.type === "blockquote" && schema.nodes.callout) {
    const bqChildren = (node as { children: Content[] }).children;
    const firstChild = bqChildren[0];
    if (firstChild?.type === "paragraph") {
      const firstText = ((firstChild as { children: Content[] }).children[0] as Text | undefined)?.value || "";
      const firstLine = firstText.split("\n")[0];
      if (parseCalloutHeader(firstLine)) {
        const calloutT = pmNodeTransformers.get("callout");
        if (calloutT) {
          return calloutT.mdastToPm(node, schema, (parent) => {
            const children = (parent as { children?: Content[] }).children;
            if (!children) return [];
            const first = children[0];
            if (first && isInlineNode(first)) {
              return convertInlineChildren(children as PhrasingContent[], schema, []);
            }
            return convertBlockChildren(children, schema);
          });
        }
      }
    }
  }

  // §30a: Extract block ID from paragraph/heading before conversion
  let blockId: string | null = null;
  if (node.type === "paragraph" || node.type === "heading") {
    blockId = extractBlockIdFromMdast(node);
  }

  // Standard node transformer lookup
  const transformer = nodeTransformers.get(node.type);
  if (transformer) {
    const result = transformer.mdastToPm(node, schema, (parent) => {
      // If parent has inline children (heading, paragraph), use inline conversion
      const children = (parent as { children?: Content[] }).children;
      if (!children) return [];

      const firstChild = children[0];
      if (firstChild && isInlineNode(firstChild)) {
        return convertInlineChildren(
          children as PhrasingContent[],
          schema,
          [],
        );
      }
      // Otherwise block-level
      return convertBlockChildren(children, schema);
    });

    // §30a: Inject blockId attribute if extracted and schema supports it
    if (blockId && result && !Array.isArray(result)) {
      if (result.type.spec.attrs && "blockId" in result.type.spec.attrs) {
        return result.type.create(
          { ...result.attrs, blockId },
          result.content,
          result.marks,
        );
      }
    }

    return result;
  }

  // Fallback: unknown node type → skip
  return null;
}

/** Convert an mdast list node to PM list node (bulletList/orderedList/taskList) */
function convertListNode(
  node: Content,
  schema: Schema,
): PmNode {
  const list = node as {
    ordered?: boolean;
    start?: number;
    children: Content[];
  };

  // Check if any child has a checked property → task list
  const hasTaskItems = list.children.some(
    (child) =>
      child.type === "listItem" &&
      (child as { checked?: boolean | null }).checked != null,
  );

  if (hasTaskItems) {
    const items = list.children.map((child) => {
      const item = child as { checked?: boolean | null; children: Content[] };
      const innerChildren = convertBlockChildren(item.children, schema);
      return schema.nodes.taskItem.create(
        { checked: item.checked ?? false },
        innerChildren,
      );
    });
    return schema.nodes.taskList.create(null, items);
  }

  // Ordered or bullet list
  const items = convertListItemChildren(list.children, schema);

  if (list.ordered) {
    return schema.nodes.orderedList.create(
      { start: list.start ?? 1 },
      items,
    );
  }

  return schema.nodes.bulletList.create(null, items);
}

/** Convert an mdast table node to PM table node */
function convertTableNode(node: Content, schema: Schema): PmNode {
  const table = node as {
    align?: (string | null)[];
    children: { type: string; children: { type: string; children: Content[] }[] }[];
  };
  const align = table.align || [];
  const rows: PmNode[] = [];

  table.children.forEach((row, rowIndex) => {
    const cells: PmNode[] = [];

    row.children.forEach((cell, colIndex) => {
      // Convert cell's inline children to PM nodes, then wrap in paragraph
      const inlineContent = convertInlineChildren(
        cell.children as PhrasingContent[],
        schema,
        [],
      );
      const paragraph = schema.nodes.paragraph.create(null, inlineContent);

      const cellAttrs = {
        colspan: 1,
        rowspan: 1,
        alignment: align[colIndex] || null,
      };

      if (rowIndex === 0) {
        cells.push(schema.nodes.tableHeader.create(cellAttrs, [paragraph]));
      } else {
        cells.push(schema.nodes.tableCell.create(cellAttrs, [paragraph]));
      }
    });

    rows.push(schema.nodes.tableRow.create(null, cells));
  });

  return schema.nodes.table.create(null, rows);
}

/** Convert list item children (ensure listItem wrapping) */
function convertListItemChildren(
  children: Content[],
  schema: Schema,
): PmNode[] {
  const result: PmNode[] = [];

  for (const child of children) {
    if (child.type === "listItem") {
      const item = child as { checked?: boolean | null; children: Content[] };

      if (item.checked != null) {
        // Task item
        const innerChildren = convertBlockChildren(item.children, schema);
        result.push(
          schema.nodes.taskItem.create(
            { checked: item.checked ?? false },
            innerChildren,
          ),
        );
      } else {
        // Regular list item
        const innerChildren = convertBlockChildren(item.children, schema);
        result.push(schema.nodes.listItem.create(null, innerChildren));
      }
    }
  }

  return result;
}

/** Convert inline mdast children to PM nodes with marks */
function convertInlineChildren(
  children: PhrasingContent[],
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  const result: PmNode[] = [];

  // Track HTML tag-based marks: <u>, <mark>, <sub>, <sup>
  let underlineActive = false;
  let highlightActive = false;
  let subscriptActive = false;
  let superscriptActive = false;

  for (const child of children) {
    if (child.type === "html") {
      const val = (child as { value: string }).value.trim().toLowerCase();
      if (val === "<u>") { underlineActive = true; continue; }
      if (val === "</u>") { underlineActive = false; continue; }
      if (val === "<mark>") { highlightActive = true; continue; }
      if (val === "</mark>") { highlightActive = false; continue; }
      if (val === "<sub>") { subscriptActive = true; continue; }
      if (val === "</sub>") { subscriptActive = false; continue; }
      if (val === "<sup>") { superscriptActive = true; continue; }
      if (val === "</sup>") { superscriptActive = false; continue; }
    }

    let marks = parentMarks;
    if (underlineActive && schema.marks.underline)
      marks = [...marks, schema.marks.underline.create()];
    if (highlightActive && schema.marks.highlight)
      marks = [...marks, schema.marks.highlight.create()];
    if (subscriptActive && schema.marks.subscript)
      marks = [...marks, schema.marks.subscript.create()];
    if (superscriptActive && schema.marks.superscript)
      marks = [...marks, schema.marks.superscript.create()];
    const nodes = convertInlineNode(child, schema, marks);
    result.push(...nodes);
  }

  return result;
}

/** Convert a single inline mdast node to PM node(s) */
function convertInlineNode(
  node: PhrasingContent,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  // Text node — split on [[wikilink]] patterns
  if (node.type === "text") {
    const text = node as Text;
    if (!text.value) return [];

    // Check for wikilink patterns and split if schema supports it
    if (schema.nodes.wikilink && text.value.includes("[[")) {
      const nodes = splitTextWithWikilinks(text.value, schema, parentMarks);
      if (nodes.length > 0) return nodes;
    }

    // §30b: Check for block reference patterns and split if schema supports it
    if (schema.nodes.blockReference && text.value.includes("((")) {
      const nodes = splitTextWithBlockRefs(text.value, schema, parentMarks);
      if (nodes.length > 0) return nodes;
    }

    // Custom inline marks: ==highlight==, ^superscript^, ~subscript~
    const customMarkNodes = splitTextWithCustomInlineMarks(text.value, schema, parentMarks);
    if (customMarkNodes.length > 0) return customMarkNodes;

    return [schema.text(text.value, parentMarks)];
  }

  // Inline code (leaf node in mdast, text with code mark in PM)
  if (node.type === "inlineCode") {
    const code = node as { value: string };
    const codeMark = schema.marks.code?.create();
    const marks = codeMark ? [...parentMarks, codeMark] : parentMarks;
    return [schema.text(code.value, marks)];
  }

  // Hard break
  if (node.type === "break") {
    return [schema.nodes.hardBreak.create()];
  }

  // Mark nodes (strong, emphasis, delete, link)
  const markTransformer = markTransformers.get(node.type);
  if (markTransformer) {
    const mark = markTransformer.mdastToMark(node, schema);
    if (mark) {
      const newMarks = [...parentMarks, mark];
      const children = (node as { children?: PhrasingContent[] }).children;
      if (children) {
        return convertInlineChildren(children, schema, newMarks);
      }
    }
  }

  // Inline math — §5.3
  if (node.type === "inlineMath") {
    const transformer = nodeTransformers.get("inlineMath");
    if (transformer) {
      const result = transformer.mdastToPm(node, schema, () => []);
      if (result && !Array.isArray(result)) return [result];
    }
  }

  // Footnote reference — §footnote
  if (node.type === "footnoteReference") {
    const fnRef = node as { identifier: string };
    if (schema.nodes.footnoteRef) {
      return [schema.nodes.footnoteRef.create({ identifier: fnRef.identifier })];
    }
  }

  // Image inline (rare, but possible)
  if (node.type === "image") {
    const transformer = nodeTransformers.get("image");
    if (transformer) {
      const result = transformer.mdastToPm(node, schema, () => []);
      if (result && !Array.isArray(result)) return [result];
    }
  }

  return [];
}

/**
 * §30a: Extract block ID from the last text child of an mdast node.
 * Mutates the node in-place (strips ` ^{id}` from text).
 * Returns the block ID string, or null if not found.
 */
function extractBlockIdFromMdast(node: Content): string | null {
  const children = (node as { children?: Content[] }).children;
  if (!children || children.length === 0) return null;

  // Find the last text node (block ID must be at the very end of block content)
  const lastChild = children[children.length - 1];
  if (lastChild.type !== "text") return null;

  const text = (lastChild as Text).value;
  const result = extractBlockId(text);
  if (!result) return null;

  // Mutate the text node to strip the block ID suffix
  if (result.strippedText) {
    (lastChild as Text).value = result.strippedText;
  } else {
    // If stripping leaves empty text, remove the node
    children.pop();
  }

  return result.blockId;
}

/** Check if an mdast node is inline-level */
function isInlineNode(node: Content): boolean {
  return [
    "text",
    "emphasis",
    "strong",
    "inlineCode",
    "link",
    "image",
    "break",
    "delete",
    "html",
    "inlineMath",
  ].includes(node.type);
}

/** Split a text string at [[wikilink]] boundaries into mixed text + wikilink PM nodes */
function splitTextWithWikilinks(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  const result: PmNode[] = [];
  const re = new RegExp(WIKILINK_RE.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    // Text before the wikilink
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      result.push(schema.text(before, parentMarks));
    }

    // Wikilink node
    const parsed = parseWikilinkMatch(match);
    result.push(
      schema.nodes.wikilink.create({
        target: parsed.target,
        display: parsed.display,
        heading: parsed.heading,
        blockId: parsed.blockId,
      }),
    );

    lastIndex = re.lastIndex;
  }

  // Text after the last wikilink
  if (lastIndex < text.length) {
    result.push(schema.text(text.slice(lastIndex), parentMarks));
  }

  return result;
}

/** §30b: Split text at ((block-ref)) boundaries into mixed text + blockReference PM nodes */
function splitTextWithBlockRefs(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  const result: PmNode[] = [];
  const re = new RegExp(BLOCK_REF_RE.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    // Text before the block reference
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      result.push(schema.text(before, parentMarks));
    }

    // Block reference node
    const parsed = parseBlockRefMatch(match);
    result.push(
      schema.nodes.blockReference.create({
        target: parsed.target,
        blockId: parsed.blockId,
        display: parsed.display,
      }),
    );

    lastIndex = re.lastIndex;
  }

  // Text after the last block reference
  if (lastIndex < text.length) {
    result.push(schema.text(text.slice(lastIndex), parentMarks));
  }

  return result;
}

/** Custom inline mark patterns: ==highlight==, ^superscript^, ~subscript~ */
const CUSTOM_MARK_PATTERNS: { markName: string; re: RegExp; fastCheck: string }[] = [
  { markName: "highlight",   re: /==((?:[^=]|=[^=])+)==/g, fastCheck: "==" },
  { markName: "superscript", re: /\^([^^]+)\^/g,           fastCheck: "^" },
  { markName: "subscript",   re: /(?<![~])~([^~]+)~(?!~)/g, fastCheck: "~" },
];

/**
 * Split text at custom inline mark boundaries (==highlight==, ^super^, ~sub~).
 * Processes each mark pattern in order; returns empty array if no matches.
 */
function splitTextWithCustomInlineMarks(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  // Try each pattern; first match wins
  for (const { markName, re, fastCheck } of CUSTOM_MARK_PATTERNS) {
    if (!schema.marks[markName]) continue;
    if (!text.includes(fastCheck)) continue;

    const nodes = splitTextWithSingleCustomMark(text, schema, parentMarks, markName, re);
    if (nodes.length > 0) return nodes;
  }
  return [];
}

/** Split text on a single custom mark regex, returning PM nodes with the mark applied */
function splitTextWithSingleCustomMark(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
  markName: string,
  regex: RegExp,
): PmNode[] {
  const result: PmNode[] = [];
  const re = new RegExp(regex.source, regex.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      // Recursively check remaining patterns on the "before" text
      const beforeNodes = splitTextWithCustomInlineMarks(before, schema, parentMarks);
      if (beforeNodes.length > 0) {
        result.push(...beforeNodes);
      } else {
        result.push(schema.text(before, parentMarks));
      }
    }

    // The matched content with the mark applied
    const mark = schema.marks[markName]?.create();
    if (mark) {
      result.push(schema.text(match[1], [...parentMarks, mark]));
    }

    lastIndex = re.lastIndex;
  }

  if (result.length === 0) return [];

  // Text after the last match
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex);
    const afterNodes = splitTextWithCustomInlineMarks(after, schema, parentMarks);
    if (afterNodes.length > 0) {
      result.push(...afterNodes);
    } else {
      result.push(schema.text(after, parentMarks));
    }
  }

  return result;
}
