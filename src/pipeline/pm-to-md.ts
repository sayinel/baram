import type { HighlightNode, SubscriptNode, SuperscriptNode } from "./types";
import type { Mark, Node as PmNode } from "@tiptap/pm/model";
import type {
  Content,
  FootnoteReference,
  Link,
  PhrasingContent,
  Root,
  Text,
} from "mdast";

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
import { isMediaAtom } from "../utils/media-src";
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
        // §276.6 — width is appended as `|w=NN` by serializeBlockRef.
        width?: null | number;
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
        vaultAlias?: null | string;
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

/** 커스텀 인라인 마크와 밑줄이 쓰는 HTML 태그 토큰 */
const INLINE_TAG_TOKENS = new Set([
  "</mark>",
  "</sub>",
  "</sup>",
  "</u>",
  "<mark>",
  "<sub>",
  "<sup>",
  "<u>",
]);

/**
 * `</tag>` 와 그 뒤의 `<tag>` 짝을 제거해 끊긴 구간을 하나로 잇는다.
 *
 * `convertTextWithMarks`는 **텍스트 노드마다** 따로 태그를 두르므로, 한 구간이 여러
 * 노드에 걸치면 경계마다 닫고 다시 여는 토큰이 생긴다.
 *
 * **바로 붙어 있는 짝만 지우면 부족하다.** 사이에 다른 태그가 끼면 (`==a <u>b</u> c==`
 * 는 `</mark> <u> <mark>` 처럼 나온다) 이음매가 인접하지 않아 구간이 끊긴 채 남고,
 * 조각마다 따로 단축 구문으로 굳어 `==a ==<u>==b==</u>== c==` 라는 쓰레기가 나왔다.
 * 그래서 **사이에 태그 토큰만 있으면** 짝으로 본다. 사이의 태그들은 제자리에 두므로
 * 중첩이 유지된다.
 */
function coalesceInlineTagPairs(nodes: PhrasingContent[]): PhrasingContent[] {
  const isTagToken = (n: PhrasingContent | undefined): boolean =>
    n?.type === "html" &&
    INLINE_TAG_TOKENS.has((n as { value: string }).value.trim());

  let current = nodes;
  // 짝을 하나 지우면 새 인접이 생기므로 변화가 없을 때까지 돈다.
  for (let pass = 0; pass <= nodes.length; pass++) {
    let removedAt = -1;
    let partnerAt = -1;
    for (let i = 0; i < current.length && removedAt === -1; i++) {
      const node = current[i];
      if (!isTagToken(node)) continue;
      const value = (node as { value: string }).value.trim();
      if (!value.startsWith("</")) continue;
      const wantOpen = `<${value.slice(2)}`;
      for (let j = i + 1; j < current.length; j++) {
        const candidate = current[j];
        if (!isTagToken(candidate)) break; // 태그가 아닌 내용이 끼면 진짜 경계다
        if ((candidate as { value: string }).value.trim() === wantOpen) {
          removedAt = i;
          partnerAt = j;
          break;
        }
      }
    }
    if (removedAt === -1) return current;
    current = current.filter((_, i) => i !== removedAt && i !== partnerAt);
  }
  return current;
}

/** HTML 태그 ↔ 단축 구문 구분자 */
const CUSTOM_MARK_TAG_DELIMITERS: Record<
  string,
  { delim: string; type: string }
> = {
  mark: { delim: "==", type: "highlight" },
  sub: { delim: "~", type: "subscript" },
  sup: { delim: "^", type: "superscript" },
};

/**
 * `<mark>평문</mark>` 을 `==평문==` 단축 구문으로 되돌린다.
 *
 * 대부분의 하이라이트·첨자는 평문이고, 사용자 파일에도 단축 구문으로 적혀 있다.
 * 태그로 내보내면 그 파일들이 **열고 저장만 해도** 전부 다시 쓰이므로, 되읽기가
 * 확실한 경우에는 원래 형태를 유지한다.
 *
 * 판정은 파서의 정규식보다 **일부러 더 엄격하다** — 내용에 구분자 문자가 하나도 없고
 * 앞뒤가 공백이 아닐 때만 되돌린다. 정규식을 여기서 흉내 내면 둘이 갈라질 수 있고,
 * 갈라지는 쪽이 곧 데이터 손실이다. 엄격해서 손해 보는 것은 `<mark>` 가 조금 더
 * 자주 나오는 것뿐이다.
 */
function collapsePlainCustomMarkTags(
  nodes: PhrasingContent[],
): PhrasingContent[] {
  const result: PhrasingContent[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const shape =
      node.type === "html"
        ? CUSTOM_MARK_TAG_DELIMITERS[
            (node as { value: string }).value.replace(/[<>]/g, "")
          ]
        : undefined;
    const inner = nodes[i + 1];
    const closer = nodes[i + 2];
    if (
      shape &&
      (node as { value: string }).value.startsWith("<") &&
      !(node as { value: string }).value.startsWith("</") &&
      inner?.type === "text" &&
      closer?.type === "html" &&
      (closer as { value: string }).value ===
        `</${(node as { value: string }).value.slice(1)}`
    ) {
      const text = (inner as Text).value;
      // `==`는 파서가 앞뒤 공백을 허용한다(`/==((?:[^=]|=[^=])+)==/`). `~`·`^`만
      // 내용이 구분자에 붙어 있기를 요구하므로 그 둘에만 공백 조건을 건다.
      const needsHug = shape.delim !== "==";
      // 구분자 **문자**가 양 끝에 붙어도 안 된다. `==` 는 두 글자라 `includes` 만
      // 보면 `a=` 가 통과하는데, 그러면 `==a===` 가 되어 되읽을 때 끝의 `=` 가
      // 마크 밖으로 떨어진다(바이트는 안정이라 마크를 봐야만 보인다).
      const edge = shape.delim[0];
      const safe =
        text.length > 0 &&
        !text.includes(shape.delim) &&
        !text.startsWith(edge) &&
        !text.endsWith(edge) &&
        (!needsHug || (!/^\s/.test(text) && !/\s$/.test(text)));
      if (safe) {
        result.push({
          type: shape.type,
          value: `${shape.delim}${text}${shape.delim}`,
        } as PhrasingContent);
        i += 2;
        continue;
      }
    }
    result.push(node);
  }

  return result;
}

const MERGEABLE_WRAPPER_TYPES = new Set(["delete", "emphasis", "strong"]);

function canMergeWrapperNodes(a: PhrasingContent, b: PhrasingContent): boolean {
  if (a.type !== b.type) return false;
  if (MERGEABLE_WRAPPER_TYPES.has(a.type)) return true;
  if (a.type === "link") {
    const la = a as Link;
    const lb = b as Link;
    return la.url === lb.url && (la.title || null) === (lb.title || null);
  }
  return false;
}

/**
 * Merge adjacent sibling mdast wrapper nodes (strong/emphasis/delete/link) of
 * the same identity, concatenating their children into one node.
 *
 * Why this exists: convertPmInlineChildren converts one PM text node at a
 * time. Inline code must be an mdast LEAF (no children), so a single PM mark
 * run that has code on only part of its text (e.g. a bold span that reads
 * `text `code` more`) becomes MULTIPLE adjacent PM text nodes — one run per
 * distinct mark set — each independently wrapped in its own "strong" mdast
 * node by convertTextWithMarks. Left unmerged, remark-stringify serializes
 * each wrapper with its own delimiters (`**text****code**** more**`) instead
 * of one continuous span (`**text `code` more**`), corrupting the file on
 * save. Custom marks (highlight/subscript/superscript) already get the same
 * treatment via coalesceCustomMarkNodes — this covers the standard ones.
 */
function coalesceAdjacentWrapperNodes(
  nodes: PhrasingContent[],
): PhrasingContent[] {
  const result: PhrasingContent[] = [];

  for (const node of nodes) {
    const prev = result[result.length - 1];
    if (prev && canMergeWrapperNodes(prev, node)) {
      (prev as { children: PhrasingContent[] }).children.push(
        ...(node as { children: PhrasingContent[] }).children,
      );
      continue;
    }
    result.push(node);
  }

  // Recurse into children so nested combinations (e.g. a merged strong node
  // whose children themselves need coalescing) are handled too.
  for (const node of result) {
    const children = (node as { children?: PhrasingContent[] }).children;
    if (children) {
      (node as { children: PhrasingContent[] }).children =
        coalesceAdjacentWrapperNodes(children);
    }
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

  // 태그 짝을 먼저 합쳐 구간을 하나로 만든 뒤, 평문 구간만 단축 구문으로 되돌리고,
  // 남은 값 노드와 wrapper 노드를 합친다. 순서가 뜻을 가진다 — 합치기 전에 되돌리면
  // 여러 노드에 걸친 구간이 조각마다 다른 형태로 굳는다.
  return coalesceAdjacentWrapperNodes(
    coalesceCustomMarkNodes(
      collapsePlainCustomMarkTags(coalesceInlineTagPairs(result)),
    ),
  );
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

  // §294: Image/Video → wrap in paragraph for mdast (mdast image is inline).
  // When widthPercent !== 100 (or widthPixel is set), the transformer returns
  // an html node instead → return that directly, unwrapped.
  //
  // ‼️ Both media atoms go through isMediaAtom(), not a hardcoded
  // typeName === "image" check — a bare mdast `image`/video-as-`image` node
  // is phrasing content, and returning it unwrapped as block-level Content
  // (the old video codepath, before this branch existed) lets remark-stringify
  // glue it to its neighbors with no blank-line separator, silently corrupting
  // any multi-block document on save (§294 C1).
  if (isMediaAtom(typeName)) {
    const transformer = pmNodeTransformers.get(typeName);
    if (transformer) {
      const mediaNode = transformer.pmToMdast(node, () => []);
      if (mediaNode) {
        if ((mediaNode as { type: string }).type === "html") {
          return mediaNode as Content;
        }
        return {
          type: "paragraph",
          children: [mediaNode as PhrasingContent],
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

  // Inline code mark is special — it's a leaf node in mdast (no children), so
  // it must be the INNERMOST node. But any other marks on the same text node
  // (bold, italic, link, ...) must still wrap it — `**`x`**` is valid GFM, and a
  // document can carry code alongside other marks whatever path it arrived by
  // (disk, paste, the toolbar), so dropping them here loses formatting on save.
  const codeMark = marks.find((m) => m.type.name === "code");

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
  // "code" is excluded here too — its leaf inlineCode node (below) already
  // represents it, so the registered `code` mark transformer must not wrap
  // it a second time.
  const otherMarks = marks.filter(
    (m) => !specialMarkNames.includes(m.type.name) && m.type.name !== "code",
  );

  // Build nested mark structure from innermost to outermost. Start from the
  // inlineCode leaf when a code mark is present, otherwise from plain text.
  let current: PhrasingContent[] = codeMark
    ? [{ type: "inlineCode", value: text } as PhrasingContent]
    : [{ type: "text", value: text } as Text];

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

  // Wrap highlight/subscript/superscript in HTML tag tokens. The `==`/`~`/`^`
  // shorthand is restored later, once the whole run is visible — see
  // wrapCustomInlineMarkAsTags and collapsePlainCustomMarkTags.
  if (highlightMark) current = wrapCustomInlineMarkAsTags(current, "mark");
  if (subscriptMark) current = wrapCustomInlineMarkAsTags(current, "sub");
  if (superscriptMark) current = wrapCustomInlineMarkAsTags(current, "sup");

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

/**
 * §5.1 커스텀 인라인 마크(`==`, `~`, `^`)를 **항상 HTML 태그 토큰으로** 감싼다.
 *
 * `underline`이 처음부터 이 방식이었고, 그래서 커스텀 마크 넷 중 유일하게 멀쩡했다.
 * 단축 구문 복원은 `collapsePlainCustomMarkTags`가 **구간 전체를 보고** 뒤에서 한다 —
 * 여기서 텍스트 노드 하나만 보고 정하면 `==x **y** z==`처럼 한 구간이 여러 텍스트
 * 노드에 걸칠 때 조각마다 다른 형태가 나와 `==x ==<mark>**y**</mark>== z==`가 된다.
 */
function wrapCustomInlineMarkAsTags(
  current: PhrasingContent[],
  htmlTag: string,
): PhrasingContent[] {
  return [
    { type: "html", value: `<${htmlTag}>` } as PhrasingContent,
    ...current,
    { type: "html", value: `</${htmlTag}>` } as PhrasingContent,
  ];
}
