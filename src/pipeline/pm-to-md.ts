// pm-to-md.ts — §3.3 ProseMirror Document → Markdown 변환 파이프라인
//
// ProseMirror Document → custom converter → mdast → remark-stringify
//
// §7.1 Serialization Rules:
// - Bold: ** (never __), Italic: * (never _)
// - List marker: - (never * or +)
// - Horizontal rule: ---
// - Code block: fenced (```)
// - 1 blank line between block elements
// - Single newline at file end
//
import { unified } from "unified";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, Content, PhrasingContent, Text } from "mdast";
import type { Node as PmNode, Mark } from "@tiptap/pm/model";
import { pmNodeTransformers, pmMarkTransformers } from "./transformers";
import { serializeWikilink } from "./transformers/wikilink-transformer";
import { appendBlockId, serializeBlockRef, serializeBlockEmbed } from "./block-id";

/** §28 Remark plugin: serialize wikiLink + §30b blockReference mdast nodes verbatim */
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
      blockReference(node: { value: string }, _parent: any, state: any, info: any) {
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
    extensions: [{
      handlers: {
        // §5.9: Callout title — output [!type] verbatim (prevent bracket escaping)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        calloutTitle(node: { value: string }) {
          return node.value;
        },
      },
    }],
  } as Parameters<typeof remarkStringify>[0])
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkWikiLink);

/** Convert ProseMirror document to mdast tree */
export function prosemirrorToMdast(doc: PmNode): Root {
  const children = convertPmChildren(doc);
  return {
    type: "root",
    children: children as Content[],
  };
}

/** Serialize mdast tree to markdown string */
export function mdastToMarkdown(root: Root): string {
  const result = serializer.stringify(root);
  return result;
}

/** Full pipeline: ProseMirror document → markdown string */
export function prosemirrorToMarkdown(doc: PmNode): string {
  const mdast = prosemirrorToMdast(doc);
  return mdastToMarkdown(mdast);
}

/** Convert PM block children to mdast nodes */
function convertPmChildren(node: PmNode): Content[] {
  const result: Content[] = [];

  node.forEach((child) => {
    const mdastNode = convertPmNode(child);
    if (mdastNode) {
      result.push(mdastNode as Content);
    }
  });

  return result;
}

/** Convert a single PM node to mdast node */
function convertPmNode(node: PmNode): Content | null {
  const typeName = node.type.name;

  // Special handling for nodes that need inline children
  if (typeName === "paragraph" || typeName === "heading") {
    const transformer = pmNodeTransformers.get(typeName);
    if (transformer) {
      const mdastNode = transformer.pmToMdast(node, convertPmInlineChildren) as Content;

      // §30a: Append block ID to last text child
      const blockId = node.attrs.blockId as string | null;
      if (blockId && mdastNode) {
        appendBlockIdToMdast(mdastNode, blockId);
      }

      return mdastNode;
    }
  }

  // Lists — handled directly because listItem/taskItem need special conversion
  if (typeName === "bulletList" || typeName === "orderedList" || typeName === "taskList") {
    return convertListNode(node) as Content;
  }

  if (typeName === "listItem" || typeName === "taskItem") {
    return convertListItemNode(node) as Content;
  }

  // §5.1: Toggle → <details><summary>...</summary> body </details>
  if (typeName === "toggle") {
    const isOpen = node.attrs.open as boolean;
    const openTag = isOpen ? "<details open>" : "<details>";

    // First child is summary paragraph
    const summaryText =
      node.childCount > 0 ? node.child(0).textContent : "";

    // Build body from remaining children
    const bodyChildren: Content[] = [];
    for (let ci = 1; ci < node.childCount; ci++) {
      const childMdast = convertPmNode(node.child(ci));
      if (childMdast) bodyChildren.push(childMdast);
    }

    // Serialize body to markdown
    let bodyMd = "";
    if (bodyChildren.length > 0) {
      const bodyMdast: Root = { type: "root", children: bodyChildren };
      bodyMd = mdastToMarkdown(bodyMdast).trimEnd();
    }

    // Build the complete HTML block
    const parts: string[] = [];
    if (summaryText) {
      parts.push(`${openTag}\n<summary>${summaryText}</summary>`);
    } else {
      parts.push(openTag);
    }
    if (bodyMd) {
      parts.push(""); // blank line to separate HTML from markdown
      parts.push(bodyMd);
    }
    parts.push(""); // blank line before closing tag
    parts.push("</details>");

    return { type: "html", value: parts.join("\n") } as Content;
  }

  // §5.9: Callout → serialize manually to preserve [!type] without escaping
  if (typeName === "callout") {
    const cType = (node.attrs.type as string) || "info";
    const cTitle = (node.attrs.title as string) || "";
    const cCollapsed = node.attrs.collapsed as boolean;

    let header = `[!${cType}]`;
    if (cCollapsed) header += "-";
    if (cTitle) header += ` ${cTitle}`;

    // Serialize body to markdown via the normal pipeline
    const bodyMdast: Root = { type: "root", children: convertPmChildren(node) as Content[] };
    const bodyMd = mdastToMarkdown(bodyMdast).trimEnd();

    // Build blockquote lines manually
    const lines = [`> ${header}`];
    for (const line of bodyMd.split("\n")) {
      lines.push(line ? `> ${line}` : ">");
    }

    // Return as html flow node (remark-stringify passes through verbatim)
    return { type: "html", value: lines.join("\n") } as Content;
  }

  // §30b: Block embed → paragraph with embed text
  if (typeName === "blockEmbed") {
    const text = serializeBlockEmbed(node.attrs as { target: string; blockId: string });
    return {
      type: "paragraph",
      children: [{ type: "text", value: text } as PhrasingContent],
    } as Content;
  }

  // Image → wrap in paragraph for mdast (mdast image is inline)
  if (typeName === "image") {
    const transformer = pmNodeTransformers.get("image");
    if (transformer) {
      const imgNode = transformer.pmToMdast(node, () => []);
      if (imgNode) {
        return {
          type: "paragraph",
          children: [imgNode as PhrasingContent],
        } as Content;
      }
    }
    return null;
  }

  // Standard transformer lookup
  const transformer = pmNodeTransformers.get(typeName);
  if (transformer) {
    return transformer.pmToMdast(node, convertPmChildren) as Content;
  }

  // Fallback: if it has text content, convert as paragraph
  if (node.isTextblock) {
    return {
      type: "paragraph",
      children: convertPmInlineChildren(node),
    } as Content;
  }

  return null;
}

/**
 * §30a: Append ` ^{id}` to the last text child of an mdast node.
 * If the node has no text children, adds a new text node.
 */
function appendBlockIdToMdast(node: Content, blockId: string): void {
  const children = (node as { children?: PhrasingContent[] }).children;
  if (!children) return;

  if (children.length > 0) {
    const lastChild = children[children.length - 1];
    if (lastChild.type === "text") {
      (lastChild as { value: string }).value = appendBlockId(
        (lastChild as { value: string }).value,
        blockId,
      );
      return;
    }
  }

  // No text child at end — append a new text node with the block ID
  children.push({ type: "text", value: ` ^${blockId}` } as PhrasingContent);
}

/** Convert a PM list node (bulletList/orderedList/taskList) to mdast list */
function convertListNode(node: PmNode): Content {
  const children: Content[] = [];

  node.forEach((child) => {
    const item = convertListItemNode(child);
    if (item) children.push(item as Content);
  });

  if (node.type.name === "taskList") {
    return {
      type: "list",
      ordered: false,
      spread: false,
      children,
    } as Content;
  }

  if (node.type.name === "orderedList") {
    return {
      type: "list",
      ordered: true,
      start: (node.attrs.start as number) ?? 1,
      spread: false,
      children,
    } as Content;
  }

  return {
    type: "list",
    ordered: false,
    spread: false,
    children,
  } as Content;
}

/** Convert a PM listItem/taskItem to mdast listItem */
function convertListItemNode(node: PmNode): Content {
  const blockChildren = convertPmChildren(node);

  if (node.type.name === "taskItem") {
    return {
      type: "listItem",
      checked: (node.attrs.checked as boolean) ?? false,
      spread: false,
      children: blockChildren,
    } as Content;
  }

  return {
    type: "listItem",
    spread: false,
    children: blockChildren,
  } as Content;
}

/** Convert PM inline children (text nodes with marks) to mdast phrasing content */
function convertPmInlineChildren(node: PmNode): PhrasingContent[] {
  const result: PhrasingContent[] = [];

  node.forEach((child) => {
    if (child.isText) {
      const textNode = convertTextWithMarks(child.text || "", child.marks);
      result.push(...textNode);
    } else if (child.type.name === "hardBreak") {
      result.push({ type: "break" } as PhrasingContent);
    } else if (child.type.name === "mathInline") {
      const transformer = pmNodeTransformers.get("mathInline");
      if (transformer) {
        const mathNode = transformer.pmToMdast(child, () => []);
        if (mathNode) result.push(mathNode as PhrasingContent);
      }
    } else if (child.type.name === "image") {
      const transformer = pmNodeTransformers.get("image");
      if (transformer) {
        const imgNode = transformer.pmToMdast(child, () => []);
        if (imgNode) result.push(imgNode as PhrasingContent);
      }
    } else if (child.type.name === "wikilink") {
      // §28: Custom wikiLink mdast node — handler in serializer outputs verbatim
      const text = serializeWikilink(child.attrs as {
        target: string;
        display?: string | null;
        heading?: string | null;
        blockId?: string | null;
      });
      result.push({ type: "wikiLink", value: text } as unknown as PhrasingContent);
    } else if (child.type.name === "blockReference") {
      // §30b: Custom blockReference mdast node — handler in serializer outputs verbatim
      const text = serializeBlockRef(child.attrs as {
        target: string;
        blockId: string;
        display?: string | null;
      });
      result.push({ type: "blockReference", value: text } as unknown as PhrasingContent);
    }
  });

  // Coalesce adjacent </u><u> pairs
  return coalesceUnderlineTags(result);
}

/** Remove adjacent </u><u> pairs (from consecutive underlined text nodes) */
function coalesceUnderlineTags(nodes: PhrasingContent[]): PhrasingContent[] {
  const result: PhrasingContent[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const next = nodes[i + 1];

    // Skip </u> followed by <u>
    if (
      node.type === "html" &&
      (node as { value: string }).value === "</u>" &&
      next?.type === "html" &&
      (next as { value: string }).value === "<u>"
    ) {
      i++; // skip both
      continue;
    }

    result.push(node);
  }

  return result;
}

/** Convert text with marks to mdast inline structure */
function convertTextWithMarks(
  text: string,
  marks: readonly Mark[],
): PhrasingContent[] {
  if (!text) return [];

  // No marks → plain text
  if (marks.length === 0) {
    return [{ type: "text", value: text } as Text];
  }

  // Inline code mark is special — it's a leaf node in mdast
  const codeMark = marks.find((m) => m.type.name === "code");
  if (codeMark) {
    return [{ type: "inlineCode", value: text } as PhrasingContent];
  }

  // Separate underline mark — handled as raw HTML <u></u>
  const underlineMark = marks.find((m) => m.type.name === "underline");
  const otherMarks = marks.filter((m) => m.type.name !== "underline");

  // Build nested mark structure from innermost to outermost
  let current: PhrasingContent[] = [{ type: "text", value: text } as Text];

  // Process marks in consistent order for deterministic output
  const sortedMarks = [...otherMarks].sort((a, b) =>
    a.type.name.localeCompare(b.type.name),
  );

  for (const mark of sortedMarks) {
    const transformer = pmMarkTransformers.get(mark.type.name);
    if (transformer) {
      const wrapped = transformer.markToMdast(mark, current);
      current = [wrapped as PhrasingContent];
    }
  }

  // Wrap with <u></u> HTML nodes if underline is active
  if (underlineMark) {
    current = [
      { type: "html", value: "<u>" } as PhrasingContent,
      ...current,
      { type: "html", value: "</u>" } as PhrasingContent,
    ];
  }

  return current;
}
