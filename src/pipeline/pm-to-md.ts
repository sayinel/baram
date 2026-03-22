import type {
  HighlightNode,
  MentionNode,
  SubscriptNode,
  SuperscriptNode,
  TagNode,
  WikiLinkNode,
} from "./types";
import type { Mark, Node as PmNode } from "@tiptap/pm/model";
import type {
  Content,
  Delete,
  Emphasis,
  FootnoteReference,
  Link,
  PhrasingContent,
  Root,
  Strong,
  Text,
} from "mdast";
import type { InlineMath } from "mdast-util-math";

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
import { appendBlockId, serializeBlockRef } from "./block-id";
import { mdastToMarkdown } from "./serializer";
import { pmMarkTransformers, pmNodeTransformers } from "./transformers";
import { serializeMention } from "./transformers/mention-transformer";
import { serializeTag } from "./transformers/tag-transformer";
import { serializeWikilink } from "./transformers/wikilink-transformer";

// Re-export mdastToMarkdown so existing imports from pm-to-md continue to work
export { mdastToMarkdown } from "./serializer";

// ---------------------------------------------------------------------------
// INLINE_SERIALIZERS — map-based dispatch for inline PM node types
// ---------------------------------------------------------------------------

// Deliberate: attrs is Record<string, any> from ProseMirror, so the generic is erased at
// map level. Each entry's serialize() still receives typed attrs via its own generic param.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InlineSerializerEntry = InlineTransformerEntry | InlineValueNodeEntry<any>;

interface InlineTransformerEntry {
  kind: "transformer";
}

interface InlineValueNodeEntry<TAttrs> {
  kind: "value-node";
  mdastType: string;
  serialize: (attrs: TAttrs) => string;
}

const INLINE_SERIALIZERS = new Map<string, InlineSerializerEntry>([
  [
    "blockReference",
    {
      kind: "value-node",
      mdastType: "blockReference",
      serialize: (attrs: {
        blockId: string;
        display?: null | string;
        target: string;
      }) => serializeBlockRef(attrs),
    },
  ],
  ["image", { kind: "transformer" }],
  ["mathInline", { kind: "transformer" }],
  [
    "mention",
    {
      kind: "value-node",
      mdastType: "mention",
      serialize: (attrs: { type: string; value: string }) =>
        serializeMention(attrs),
    },
  ],
  [
    "tagNode",
    {
      kind: "value-node",
      mdastType: "tagNode",
      serialize: (attrs: { tag: string }) => serializeTag(attrs),
    },
  ],
  [
    "wikilink",
    {
      kind: "value-node",
      mdastType: "wikiLink",
      serialize: (attrs: {
        blockId?: null | string;
        display?: null | string;
        heading?: null | string;
        target: string;
      }) => serializeWikilink(attrs),
    },
  ],
]);

/** Full pipeline: ProseMirror document → markdown string */
export function prosemirrorToMarkdown(doc: PmNode): string {
  const mdast = prosemirrorToMdast(doc);
  return mdastToMarkdown(mdast);
}

/** Convert ProseMirror document to mdast tree */
export function prosemirrorToMdast(doc: PmNode): Root {
  const children = convertPmChildren(doc);
  return {
    type: "root",
    children: children as Content[],
  };
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

/** Coalesce adjacent custom mark nodes of the same type (highlight, subscript, superscript).
 *  Merges e.g. ==part1== + ==part2== → ==part1part2== */
function coalesceCustomMarkNodes(nodes: PhrasingContent[]): PhrasingContent[] {
  const DELIMS: Record<string, { close: string; open: string }> = {
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
      // Custom mark nodes (highlight, subscript, superscript) are Literal nodes with value
      let merged = (node as HighlightNode | SubscriptNode | SuperscriptNode)
        .value;
      while (i + 1 < nodes.length && nodes[i + 1].type === node.type) {
        i++;
        const next = (
          nodes[i] as HighlightNode | SubscriptNode | SuperscriptNode
        ).value;
        // Strip close+open delimiters at boundary: ==a== + ==b== → ==ab==
        merged =
          merged.slice(0, -delim.close.length) + next.slice(delim.open.length);
      }
      result.push({
        type: node.type,
        value: merged,
      } as HighlightNode | SubscriptNode | SuperscriptNode);
    } else {
      result.push(node);
    }
  }

  return result;
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

/** Convert PM block children to mdast nodes */
function convertPmChildren(node: PmNode): Content[] {
  const result: Content[] = [];

  node.forEach((child) => {
    // §5.5: Emit colwidths HTML comment before tables with user-resized columns
    if (child.type.name === "table") {
      const colwidths = extractTableColwidths(child);
      if (colwidths) {
        result.push({
          type: "html",
          value: `<!-- colwidths:${colwidths.join(",")} -->`,
        } as Content);
      }
    }

    const mdastNode = convertPmNode(child);
    if (mdastNode) {
      result.push(mdastNode as Content);
    }
  });

  return result;
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
    } else if (child.type.name === "footnoteRef") {
      // §footnote: footnoteReference mdast node — remark-gfm handles serialization
      result.push({
        type: "footnoteReference",
        identifier: child.attrs.identifier as string,
        label: child.attrs.identifier as string,
      } satisfies FootnoteReference);
    } else {
      const entry = INLINE_SERIALIZERS.get(child.type.name);
      if (entry?.kind === "transformer") {
        const transformer = pmNodeTransformers.get(child.type.name);
        if (transformer) {
          const node = transformer.pmToMdast(child, () => []);
          if (node) result.push(node as PhrasingContent);
        }
      } else if (entry?.kind === "value-node") {
        result.push({
          type: entry.mdastType,
          value: entry.serialize(child.attrs),
        } as PhrasingContent);
      }
    }
  });

  // Coalesce adjacent </u><u> pairs, then adjacent custom mark nodes
  return coalesceCustomMarkNodes(coalesceUnderlineTags(result));
}

/** Convert a single PM node to mdast node */
// Intentional special cases below — these nodes need custom converter callbacks
// or post-processing that the standard transformer.pmToMdast(node, convertPmChildren)
// path cannot express. Unifying these into the registry would require extending the
// NodeTransformer interface with metadata (converterType, wrapInParagraph, appendBlockId).
// See refactoring-plan.md C6 for the full design rationale.
function convertPmNode(node: PmNode): Content | null {
  const typeName = node.type.name;

  // paragraph/heading: needs convertPmInlineChildren (not convertPmChildren) + blockId append
  if (typeName === "paragraph" || typeName === "heading") {
    const transformer = pmNodeTransformers.get(typeName);
    if (transformer) {
      const mdastNode = transformer.pmToMdast(
        node,
        convertPmInlineChildren,
      ) as Content;

      // §30a: Append block ID to last text child
      const blockId = node.attrs.blockId as null | string;
      if (blockId && mdastNode) {
        appendBlockIdToMdast(mdastNode, blockId);
      }

      return mdastNode;
    }
  }

  // Definition list → manual serialization (needs convertPmInlineChildren)
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

  // Image → wrap in paragraph for mdast (mdast image is inline)
  // When widthPercent !== 100, transformer returns html node → return directly
  if (typeName === "image") {
    const transformer = pmNodeTransformers.get("image");
    if (transformer) {
      const imgNode = transformer.pmToMdast(node, () => []);
      if (imgNode) {
        if ((imgNode as { type: string }).type === "html") {
          return imgNode as Content;
        }
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
  const specialMarkNames = [
    "underline",
    "highlight",
    "subscript",
    "superscript",
  ];
  const underlineMark = marks.find((m) => m.type.name === "underline");
  const highlightMark = marks.find((m) => m.type.name === "highlight");
  const subscriptMark = marks.find((m) => m.type.name === "subscript");
  const superscriptMark = marks.find((m) => m.type.name === "superscript");
  const otherMarks = marks.filter(
    (m) => !specialMarkNames.includes(m.type.name),
  );

  // Build nested mark structure from innermost to outermost
  let current: PhrasingContent[] = [{ type: "text", value: text } as Text];

  // Process marks in consistent order for deterministic output
  const sortedMarks = [...otherMarks].sort((a, b) =>
    a.type.name < b.type.name ? -1 : a.type.name > b.type.name ? 1 : 0,
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
    current = [
      {
        type: "highlight",
        value: `==${inner}==`,
      } satisfies HighlightNode,
    ];
  }
  if (subscriptMark) {
    const inner = extractTextFromPhrasing(current);
    current = [
      { type: "subscript", value: `~${inner}~` } satisfies SubscriptNode,
    ];
  }
  if (superscriptMark) {
    const inner = extractTextFromPhrasing(current);
    current = [
      {
        type: "superscript",
        value: `^${inner}^`,
      } satisfies SuperscriptNode,
    ];
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

/**
 * §5.5: Extract colwidths from a table PM node if any cell has userResized: true.
 * Returns the colwidths array (from the first row) or null if no user resize.
 */
function extractTableColwidths(tableNode: PmNode): null | number[] {
  const firstRow = tableNode.firstChild;
  if (!firstRow) return null;

  let hasUserResize = false;
  const colwidths: number[] = [];

  for (let i = 0; i < firstRow.childCount; i++) {
    const cell = firstRow.child(i);
    if (cell.attrs.userResized && cell.attrs.colwidth) {
      hasUserResize = true;
    }
    const cw = cell.attrs.colwidth as null | number[];
    const colspan = (cell.attrs.colspan as number) || 1;
    if (cw) {
      colwidths.push(...cw);
    } else {
      for (let j = 0; j < colspan; j++) colwidths.push(0);
    }
  }

  if (hasUserResize && colwidths.length > 0 && colwidths.some((w) => w > 0)) {
    return colwidths;
  }
  return null;
}

/** Extract plain text from a phrasing content array (for wrapping in custom mark delimiters).
 *  Serializes nested standard marks (bold → **, italic → *, etc.) to markdown. */
function extractTextFromPhrasing(nodes: PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return (node as Text).value;
      if (node.type === "strong") {
        const inner = extractTextFromPhrasing((node as Strong).children);
        return `**${inner}**`;
      }
      if (node.type === "emphasis") {
        const inner = extractTextFromPhrasing((node as Emphasis).children);
        return `*${inner}*`;
      }
      if (node.type === "delete") {
        const inner = extractTextFromPhrasing((node as Delete).children);
        return `~~${inner}~~`;
      }
      if (node.type === "inlineCode")
        return `\`${(node as { value: string }).value}\``;
      if (node.type === "link")
        return extractTextFromPhrasing((node as Link).children);
      if (node.type === "inlineMath") return (node as InlineMath).value || "";
      if (node.type === "wikiLink") return (node as WikiLinkNode).value || "";
      if (node.type === "mention") return (node as MentionNode).value || "";
      if (node.type === "tagNode") return (node as TagNode).value || "";
      return "";
    })
    .join("");
}
