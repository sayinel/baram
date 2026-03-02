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
import { serializeMention } from "./transformers/mention-transformer";
import { serializeTag } from "./transformers/tag-transformer";
import { appendBlockId, serializeBlockRef, serializeBlockEmbed } from "./block-id";

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blockReference(node: { value: string }, _parent: any, state: any, info: any) {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      superscript(node: { value: string }, _parent: any, state: any, info: any) {
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
    extensions: [{
      handlers: {
        // §5.9: Callout title — output [!type] verbatim (prevent bracket escaping)
        calloutTitle(node: { value: string }) {
          return node.value;
        },
      },
    }],
  } as Parameters<typeof remarkStringify>[0])
  .use(remarkGfm, { singleTilde: false })
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
  let result = serializer.stringify(root);
  // §56l: remark-stringify escapes # at line start (atBreak), but #tag (no space)
  // is never heading syntax — unescape when followed by word characters.
  result = result.replace(/\\#(?=[\w가-힣])/g, "#");
  // §56m: remark-stringify encodes trailing spaces as &#x20; when the last inline
  // node is a tagNode followed by a whitespace-only text node.  Strip at end of lines.
  result = result.replace(/&#x20;(?=\n|$)/g, "");
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

    // First child is summary (paragraph or heading)
    const summaryChild = node.childCount > 0 ? node.child(0) : null;
    let summaryText = "";
    if (summaryChild) {
      if (summaryChild.type.name === "heading") {
        // Heading summary: prefix with # marks
        const level = summaryChild.attrs.level as number;
        const prefix = "#".repeat(level);
        summaryText = summaryChild.textContent
          ? `${prefix} ${summaryChild.textContent}`
          : prefix;
      } else {
        summaryText = summaryChild.textContent;
      }
    }

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

  // Definition list → manual serialization (like callout pattern)
  if (typeName === "definitionList") {
    const groups: string[] = [];
    let currentGroup: string[] = [];

    node.forEach((child) => {
      if (child.type.name === "definitionTerm") {
        // If there's a previous group, flush it
        if (currentGroup.length > 0) {
          groups.push(currentGroup.join("\n"));
          currentGroup = [];
        }
        // Convert term inline content to markdown
        const termMdast: Root = {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: convertPmInlineChildren(child),
            } as Content,
          ],
        };
        const termMd = mdastToMarkdown(termMdast).trimEnd();
        currentGroup.push(termMd);
      } else if (child.type.name === "definitionDescription") {
        // Convert description inline content to markdown
        const descMdast: Root = {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: convertPmInlineChildren(child),
            } as Content,
          ],
        };
        const descMd = mdastToMarkdown(descMdast).trimEnd();
        currentGroup.push(`: ${descMd}`);
      }
    });

    // Flush last group
    if (currentGroup.length > 0) {
      groups.push(currentGroup.join("\n"));
    }

    return { type: "html", value: groups.join("\n\n") } as Content;
  }

  // §30b: Block embed → paragraph with embed text
  if (typeName === "blockEmbed") {
    const text = serializeBlockEmbed(node.attrs as { target: string; blockId: string });
    return {
      type: "paragraph",
      children: [{ type: "text", value: text } as PhrasingContent],
    } as Content;
  }

  // [TOC] → html flow node to prevent remark escaping [ → \[
  if (typeName === "tableOfContents") {
    return { type: "html", value: "[TOC]" } as Content;
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
    } else if (child.type.name === "footnoteRef") {
      // §footnote: footnoteReference mdast node — remark-gfm handles serialization
      result.push({
        type: "footnoteReference",
        identifier: child.attrs.identifier as string,
        label: child.attrs.identifier as string,
      } as unknown as PhrasingContent);
    } else if (child.type.name === "blockReference") {
      // §30b: Custom blockReference mdast node — handler in serializer outputs verbatim
      const text = serializeBlockRef(child.attrs as {
        target: string;
        blockId: string;
        display?: string | null;
      });
      result.push({ type: "blockReference", value: text } as unknown as PhrasingContent);
    } else if (child.type.name === "mention") {
      // §57: Custom mention mdast node — handler in serializer outputs verbatim
      const text = serializeMention(child.attrs as { type: string; value: string });
      result.push({ type: "mention", value: text } as unknown as PhrasingContent);
    } else if (child.type.name === "tagNode") {
      // §56m: Custom tagNode mdast node — handler in serializer outputs verbatim
      const text = serializeTag(child.attrs as { tag: string });
      result.push({ type: "tagNode", value: text } as unknown as PhrasingContent);
    }
  });

  // Coalesce adjacent </u><u> pairs, then adjacent custom mark nodes
  return coalesceCustomMarkNodes(coalesceUnderlineTags(result));
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

/** Coalesce adjacent custom mark nodes of the same type (highlight, subscript, superscript).
 *  Merges e.g. ==part1== + ==part2== → ==part1part2== */
function coalesceCustomMarkNodes(nodes: PhrasingContent[]): PhrasingContent[] {
  const DELIMS: Record<string, { open: string; close: string }> = {
    highlight: { open: "==", close: "==" },
    subscript: { open: "~", close: "~" },
    superscript: { open: "^", close: "^" },
  };
  const result: PhrasingContent[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const delim = DELIMS[node.type];

    if (delim) {
      // Collect adjacent nodes of the same type
      let merged = (node as unknown as { value: string }).value;
      while (i + 1 < nodes.length && nodes[i + 1].type === node.type) {
        i++;
        const next = (nodes[i] as unknown as { value: string }).value;
        // Strip close+open delimiters at boundary: ==a== + ==b== → ==ab==
        merged = merged.slice(0, -delim.close.length) + next.slice(delim.open.length);
      }
      result.push({ type: node.type, value: merged } as unknown as PhrasingContent);
    } else {
      result.push(node);
    }
  }

  return result;
}

/** Extract plain text from a phrasing content array (for wrapping in custom mark delimiters).
 *  Serializes nested standard marks (bold → **, italic → *, etc.) to markdown. */
function extractTextFromPhrasing(nodes: PhrasingContent[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return (node as Text).value;
    if (node.type === "strong") {
      const inner = extractTextFromPhrasing((node as unknown as { children: PhrasingContent[] }).children);
      return `**${inner}**`;
    }
    if (node.type === "emphasis") {
      const inner = extractTextFromPhrasing((node as unknown as { children: PhrasingContent[] }).children);
      return `*${inner}*`;
    }
    if (node.type === "delete") {
      const inner = extractTextFromPhrasing((node as unknown as { children: PhrasingContent[] }).children);
      return `~~${inner}~~`;
    }
    if (node.type === "inlineCode") return `\`${(node as { value: string }).value}\``;
    return "";
  }).join("");
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

  // Separate special marks that use custom mdast types or raw HTML
  const specialMarkNames = ["underline", "highlight", "subscript", "superscript"];
  const underlineMark = marks.find((m) => m.type.name === "underline");
  const highlightMark = marks.find((m) => m.type.name === "highlight");
  const subscriptMark = marks.find((m) => m.type.name === "subscript");
  const superscriptMark = marks.find((m) => m.type.name === "superscript");
  const otherMarks = marks.filter((m) => !specialMarkNames.includes(m.type.name));

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

  // Wrap with custom mdast types for highlight/subscript/superscript
  // Uses value-based approach (like wikiLink) to avoid remark-gfm escaping ~ chars
  if (highlightMark) {
    const inner = extractTextFromPhrasing(current);
    current = [{ type: "highlight", value: `==${inner}==` } as unknown as PhrasingContent];
  }
  if (subscriptMark) {
    const inner = extractTextFromPhrasing(current);
    current = [{ type: "subscript", value: `~${inner}~` } as unknown as PhrasingContent];
  }
  if (superscriptMark) {
    const inner = extractTextFromPhrasing(current);
    current = [{ type: "superscript", value: `^${inner}^` } as unknown as PhrasingContent];
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
