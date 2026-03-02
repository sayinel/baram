// §5.1 Cursor position mapping between ProseMirror and Markdown
//
// Sequential block matching — uses PM doc structure as the single source of
// truth for block alignment. Walks through PM blocks one-by-one, matching
// each block's text against the markdown string via character comparison.
// Markdown syntax (## headings, **bold**, [link](url), #tags, list prefixes,
// fenced code delimiters, frontmatter ---) is automatically skipped because
// those characters don't appear in the PM text.

import type { Node as PMNode } from "@tiptap/pm/model";

interface BlockInfo {
  blockIndex: number;
  textOffset: number;
  blockTextSize: number;
}

/**
 * Get the block index and text offset within that block for a PM position.
 */
function getBlockIndexAndOffset(doc: PMNode, pmPos: number): BlockInfo {
  const childCount = doc.childCount;
  if (childCount === 0) {
    return { blockIndex: 0, textOffset: 0, blockTextSize: 0 };
  }

  let pos = 0;
  for (let i = 0; i < childCount; i++) {
    const child = doc.child(i);
    // Leaf nodes (e.g. horizontalRule) have nodeSize=1 with no opening/closing tokens.
    // Non-leaf nodes have nodeSize = content.size + 2 (opening + content + closing).
    const start = pos + (child.isLeaf ? 0 : 1);
    const end = start + child.content.size;

    if (pmPos <= end) {
      const textOffset = Math.max(0, pmPos - start);
      return {
        blockIndex: i,
        textOffset,
        blockTextSize: child.content.size,
      };
    }
    pos += child.nodeSize;
  }

  // Past the end — return last block
  const lastChild = doc.child(childCount - 1);
  return {
    blockIndex: childCount - 1,
    textOffset: lastChild.content.size,
    blockTextSize: lastChild.content.size,
  };
}

/**
 * Convert a text-level position (index into textBetween output) back to a
 * PM content offset within a compound block (lists, blockquotes, tables).
 *
 * Must account for the "\n" separator that textBetween inserts between
 * ALL leaf blocks (textblocks), including those containing only atom nodes.
 * For tables, separators are not used (countSeparators=false).
 */
function textPosToPmOffset(block: PMNode, targetTextPos: number, countSeparators: boolean = true, preferBeforeAtom: boolean = true): number {
  // Collect leaf blocks (textblocks like paragraphs within list items).
  // textBetween inserts separators between ALL leaf blocks, not just those
  // with text — atom-only paragraphs (e.g. tagNode list items) also get
  // separators. Walking only text nodes would miss these separators.
  interface LeafBlock {
    contentStart: number;  // PM offset of the textblock's content start
    textNodes: { pos: number; length: number }[];
    totalText: number;
  }
  const leaves: LeafBlock[] = [];
  block.descendants((node, pos) => {
    if (node.isTextblock) {
      const textNodes: { pos: number; length: number }[] = [];
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
    const textNodes: { pos: number; length: number; nodeSize: number }[] = [];
    block.descendants((node, pos) => {
      if (node.isText) {
        textNodes.push({ pos, length: node.text!.length, nodeSize: node.nodeSize });
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
      const fits = (isLast || preferBeforeAtom) ? remaining <= tn.length : remaining < tn.length;
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

/**
 * Walk markdown from `mdStart`, consuming all characters that match `pmText`.
 * Returns the position in `markdown` after the last matched character.
 * Non-matching characters (markdown syntax) are skipped automatically.
 */
function advancePastBlock(
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
 * PM cursor position → markdown character offset.
 *
 * Walks PM doc blocks sequentially, matching each block's textBetween output
 * against the markdown string. This eliminates the need for independent
 * markdown block splitting, guaranteeing perfect block alignment.
 */
export function pmPosToMdOffset(
  doc: PMNode,
  pmPos: number,
  markdown: string,
): number {
  if (doc.childCount === 0 || markdown.length === 0) return 0;

  const { blockIndex, textOffset } = getBlockIndexAndOffset(doc, pmPos);
  const targetBlockIdx = Math.min(blockIndex, doc.childCount - 1);

  // Advance mdCursor past all blocks before the target
  let mdCursor = 0;
  for (let bi = 0; bi < targetBlockIdx; bi++) {
    const block = doc.child(bi);
    const isTable = block.type.name === "table";
    const sep = isTable ? "" : "\n";
    const pmText = block.textBetween(0, block.content.size, sep);
    mdCursor = advancePastBlock(markdown, mdCursor, pmText);
  }

  // Match within the target block
  const block = doc.child(targetBlockIdx);
  const isTable = block.type.name === "table";
  const sep = isTable ? "" : "\n";
  const pmText = block.textBetween(0, block.content.size, sep);

  if (pmText.length === 0) return mdCursor;

  // Convert PM content offset to text position.
  // Must use textBetween — inline atom nodes (e.g. tagNode) occupy 1 PM position
  // but contribute 0 text characters, so offset ≠ textPos.
  const clampedOffset = Math.min(textOffset, block.content.size);
  const pmTextPos = block.textBetween(0, clampedOffset, sep).length;

  // Detect if cursor is right before an inline atom node.
  // Atom nodes occupy PM positions but contribute 0 text characters, so
  // before-atom and after-atom positions produce the same pmTextPos.
  // When before an atom, return lastMatchEnd (before atom's markdown syntax)
  // instead of searching past it to the next matching character.
  let isBeforeAtom = false;
  if (block.isTextblock && clampedOffset < block.content.size) {
    let childOffset = 0;
    for (let ci = 0; ci < block.childCount; ci++) {
      const child = block.child(ci);
      if (childOffset === clampedOffset && !child.isText) {
        isBeforeAtom = true;
        break;
      }
      if (childOffset > clampedOffset) break;
      childOffset += child.nodeSize;
    }
  }

  // Walk markdown matching pmTextPos characters of PM text
  let pmIdx = 0;
  let lastMatchEnd = mdCursor;
  for (let mdIdx = mdCursor; mdIdx < markdown.length; mdIdx++) {
    if (pmIdx < pmText.length && markdown[mdIdx] === pmText[pmIdx]) {
      // If we've already consumed enough text chars, this is the target position
      if (pmIdx >= pmTextPos) {
        // Before an atom: return position right after last matched text char
        // (before the atom's markdown syntax like "#tag").
        // Skip when pmTextPos=0 (block start) — lastMatchEnd equals mdCursor
        // which is indistinguishable from previous block's boundary in reverse.
        if (isBeforeAtom && pmTextPos > 0) return lastMatchEnd;
        return mdIdx;
      }
      pmIdx++;
      lastMatchEnd = mdIdx + 1;
    }
  }
  // All PM text was matched — cursor at or past end of block
  if (pmIdx >= pmTextPos) return lastMatchEnd;
  return markdown.length;
}

/**
 * Markdown character offset → PM cursor position.
 *
 * Walks PM doc blocks sequentially, matching each block's textBetween output
 * against the markdown string. When the target offset falls within a block's
 * markdown region, re-walks that region to count matched PM text characters
 * and convert back to a PM document position.
 */
export function mdOffsetToPmPos(
  doc: PMNode,
  mdOffset: number,
  markdown: string,
): number {
  if (doc.childCount === 0) return 0;

  const target = Math.max(0, Math.min(mdOffset, markdown.length));
  let mdCursor = 0;
  let pmBlockStart = 0;

  for (let bi = 0; bi < doc.childCount; bi++) {
    const block = doc.child(bi);
    const isTable = block.type.name === "table";
    const sep = isTable ? "" : "\n";
    const pmText = block.textBetween(0, block.content.size, sep);
    const contentStart = pmBlockStart + (block.isLeaf ? 0 : 1);

    // Match this block's full text against markdown
    const mdSaveStart = mdCursor;
    mdCursor = advancePastBlock(markdown, mdCursor, pmText);

    // If target falls within this block's markdown region, or this is the last block
    if (target <= mdCursor || bi === doc.childCount - 1) {
      // Re-walk from block's md start to target, counting PM text matches
      let pmCount = 0;
      let lastMatchMdIdx = -1;
      for (let mdIdx = mdSaveStart; mdIdx < target && mdIdx < markdown.length; mdIdx++) {
        if (pmCount < pmText.length && markdown[mdIdx] === pmText[pmCount]) {
          pmCount++;
          lastMatchMdIdx = mdIdx;
        }
      }

      // Detect if target is past a non-matching gap (atom's markdown region).
      // Gap means cursor was positioned after the atom in markdown → prefer
      // the "after atom" PM position. No gap → prefer "before atom" position.
      const hasGapBeforeTarget = lastMatchMdIdx >= mdSaveStart && target > lastMatchMdIdx + 1;
      const preferBeforeAtom = !hasGapBeforeTarget;

      // Convert PM text count to PM content offset.
      // preferBeforeAtom only applies to textblocks (paragraphs with inline atoms).
      // For compound blocks (tables, lists), text-node boundaries represent structural
      // boundaries (cell edges, list item separators), not atom gaps.
      const pmOffset = block.isTextblock
        ? textPosToPmOffset(block, pmCount, false, preferBeforeAtom)
        : textPosToPmOffset(block, pmCount, !isTable, false);

      return Math.min(contentStart + pmOffset, contentStart + block.content.size);
    }

    pmBlockStart += block.nodeSize;
  }

  return doc.content.size;
}

/**
 * Markdown line number (1-based) → PM block start position.
 * Directly maps line to the containing PM block, bypassing proportional offset.
 * Handles fenced code blocks, frontmatter, and enriched empty paragraphs.
 */
export function mdLineToPmBlockStart(
  doc: PMNode,
  content: string,
  line: number,
): number {
  if (doc.childCount === 0) return 0;

  const lines = content.split("\n");

  // Compute character offset of the start of the target line
  let targetOffset = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
    targetOffset += lines[i].length + 1;
  }

  // Use sequential block matching to find which PM block contains the target
  let mdCursor = 0;
  let pmBlockStart = 0;

  for (let bi = 0; bi < doc.childCount; bi++) {
    const block = doc.child(bi);
    const sep = block.type.name === "table" ? "" : "\n";
    const pmText = block.textBetween(0, block.content.size, sep);
    mdCursor = advancePastBlock(content, mdCursor, pmText);

    if (targetOffset <= mdCursor || bi === doc.childCount - 1) {
      // Target line is in this block's region
      return pmBlockStart + (block.isLeaf ? 0 : 1);
    }

    pmBlockStart += block.nodeSize;
  }

  return pmBlockStart + 1;
}
