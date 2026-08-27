// §5.1 마크다운 ↔ ProseMirror 정렬의 바닥돌 — 글자 맞추기.
//
// PM 블록의 텍스트를 마크다운 문자열에 **순서대로** 맞춰 걷는다. 마크다운 문법
// (## 제목, **굵게**, [링크](url), #태그, 목록 접두, 펜스 구분자, frontmatter ---)은
// PM 텍스트에 나타나지 않으므로 저절로 건너뛰어진다. 이 전제 — PM 텍스트는 그 블록
// 마크다운의 부분수열이다 — 가 이 디렉터리의 세 매퍼가 공유하는 유일한 규칙이다.
import type { Node as PMNode } from "@tiptap/pm/model";

// Atom blocks that store their serialized content in an attribute rather than
// as ProseMirror text (so block.textBetween() returns ""). The char-matching
// mapper has nothing to anchor on for these, so it can't advance the markdown
// cursor into the block's fenced region — the caret then maps to the line
// ABOVE the block. Supplying the attribute (which appears verbatim in the
// fenced markdown) restores correct alignment in both directions.
const ATTR_CONTENT_BLOCKS: Record<string, string> = {
  mermaidBlock: "code",
};

/**
 * Walk markdown from `mdStart`, consuming all characters that match `pmText`.
 * Returns the position in `markdown` after the last matched character.
 * Non-matching characters (markdown syntax) are skipped automatically.
 */
export function advancePastBlock(
  markdown: string,
  mdStart: number,
  pmText: string,
): number {
  let pmIdx = 0;
  let mdCursor = mdStart;
  while (mdCursor < markdown.length && pmIdx < pmText.length) {
    if (markdown[mdCursor] === pmText[pmIdx]) {
      pmIdx++;
    }
    mdCursor++;
  }
  return mdCursor;
}

/**
 * Text used to align a PM block against the markdown string. Same as
 * block.textBetween(), except for text-less atom blocks (e.g. mermaid) whose
 * content lives in an attribute — those return the attribute value so the
 * matcher can advance through their markdown region.
 */
export function blockMatchText(block: PMNode, sep: string): string {
  const text = block.textBetween(0, block.content.size, sep);
  if (text.length > 0) return text;
  const attr = ATTR_CONTENT_BLOCKS[block.type.name];
  if (attr) {
    const value = block.attrs[attr];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return text;
}

/**
 * Convert a text-level position (index into textBetween output) back to a
 * PM content offset within a compound block (lists, blockquotes, tables).
 *
 * Must account for the "\n" separator that textBetween inserts between
 * ALL leaf blocks (textblocks), including those containing only atom nodes.
 * For tables, separators are not used (countSeparators=false).
 */
export function textPosToPmOffset(
  block: PMNode,
  targetTextPos: number,
  countSeparators: boolean = true,
  preferBeforeAtom: boolean = true,
): number {
  // Collect leaf blocks (textblocks like paragraphs within list items).
  // textBetween inserts separators between ALL leaf blocks, not just those
  // with text — atom-only paragraphs (e.g. tagNode list items) also get
  // separators. Walking only text nodes would miss these separators.
  interface LeafBlock {
    contentStart: number; // PM offset of the textblock's content start
    textNodes: { length: number; pos: number }[];
    totalText: number;
  }
  const leaves: LeafBlock[] = [];
  block.descendants((node, pos) => {
    if (node.isTextblock) {
      const textNodes: { length: number; pos: number }[] = [];
      let totalText = 0;
      node.forEach((child, offset) => {
        if (child.isText) {
          textNodes.push({ pos: pos + 1 + offset, length: child.text!.length });
          totalText += child.text!.length;
        }
      });
      leaves.push({ contentStart: pos + 1, textNodes, totalText });
      return false; // don't descend further into this textblock
    }
    return true;
  });

  // For textblocks and tables (countSeparators=false), fall back to
  // text-node walking. No separators are counted — atom gaps between
  // text nodes within a single textblock are NOT textBetween separators.
  if (!countSeparators) {
    const textNodes: { length: number; nodeSize: number; pos: number }[] = [];
    block.descendants((node, pos) => {
      if (node.isText) {
        textNodes.push({
          pos,
          length: node.text!.length,
          nodeSize: node.nodeSize,
        });
      }
      return true;
    });
    let textCount = 0;
    for (let i = 0; i < textNodes.length; i++) {
      const tn = textNodes[i];
      const remaining = targetTextPos - textCount;
      const isLast = i === textNodes.length - 1;
      // At text-node boundaries where remaining equals node length:
      // - preferBeforeAtom=true (no gap): use <= to return end of current node
      //   (before any atom gap that follows)
      // - preferBeforeAtom=false (gap detected): use < to fall through to next
      //   node (after the atom gap) — original behavior
      const fits =
        isLast || preferBeforeAtom
          ? remaining <= tn.length
          : remaining < tn.length;
      if (fits) {
        return tn.pos + remaining;
      }
      textCount += tn.length;
    }
    return block.content.size;
  }

  // Walk leaf blocks with separators between ALL of them
  let textCount = 0;
  for (let i = 0; i < leaves.length; i++) {
    if (i > 0) {
      textCount++; // "\n" separator between leaf blocks
    }

    const leaf = leaves[i];
    const remaining = targetTextPos - textCount;

    if (remaining <= leaf.totalText || i === leaves.length - 1) {
      // Target is within this leaf block's text
      let innerCount = 0;
      for (const tn of leaf.textNodes) {
        if (remaining - innerCount <= tn.length) {
          return tn.pos + (remaining - innerCount);
        }
        innerCount += tn.length;
      }
      // Past all text (or atom-only block) — return content start
      return leaf.contentStart;
    }
    textCount += leaf.totalText;
  }
  return block.content.size;
}
