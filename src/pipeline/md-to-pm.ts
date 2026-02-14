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
import { nodeTransformers, markTransformers } from "./transformers";
import { isStandaloneImage } from "./transformers/image-transformer";

/** remark parser — markdown string → mdast */
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"]);

/** Parse markdown string to mdast tree */
export function parseMdast(markdown: string): Root {
  return parser.parse(markdown) as Root;
}

/** Convert mdast tree to ProseMirror document */
export function mdastToProsemirror(root: Root, schema: Schema): PmNode {
  const children = convertBlockChildren(root.children, schema);
  return schema.nodes.doc.create(null, children);
}

/** Full pipeline: markdown string → ProseMirror document */
export function markdownToProsemirror(
  markdown: string,
  schema: Schema,
): PmNode {
  const mdast = parseMdast(markdown);
  return mdastToProsemirror(mdast, schema);
}

/** Convert block-level mdast children to PM nodes */
function convertBlockChildren(
  children: Content[],
  schema: Schema,
): PmNode[] {
  const result: PmNode[] = [];

  for (const child of children) {
    const node = convertBlockNode(child, schema);
    if (node) {
      if (Array.isArray(node)) {
        result.push(...node);
      } else {
        result.push(node);
      }
    }
  }

  return result;
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

  // Standard node transformer lookup
  const transformer = nodeTransformers.get(node.type);
  if (transformer) {
    return transformer.mdastToPm(node, schema, (parent) => {
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

  for (const child of children) {
    const nodes = convertInlineNode(child, schema, parentMarks);
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
  // Text node
  if (node.type === "text") {
    const text = node as Text;
    if (!text.value) return [];
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
