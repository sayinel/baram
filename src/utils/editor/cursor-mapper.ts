// §5.1 Cursor position mapping between ProseMirror and Markdown
//
// Sequential block matching — uses PM doc structure as the single source of
// truth for block alignment. Walks through PM blocks one-by-one, matching
// each block's text against the markdown string via character comparison.
// Markdown syntax (## headings, **bold**, [link](url), #tags, list prefixes,
// fenced code delimiters, frontmatter ---) is automatically skipped because
// those characters don't appear in the PM text.

import type { Node as PMNode } from "@tiptap/pm/model";

import {
  advancePastBlock,
  blockMatchText,
  textPosToPmOffset,
} from "./cursor-match";

interface BlockInfo {
  blockIndex: number;
  blockTextSize: number;
  textOffset: number;
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
    const pmText = blockMatchText(block, sep);
    const contentStart = pmBlockStart + (block.isLeaf ? 0 : 1);

    // Match this block's full text against markdown
    const mdSaveStart = mdCursor;
    mdCursor = advancePastBlock(markdown, mdCursor, pmText);

    // If target falls within this block's markdown region, or this is the last block
    if (target <= mdCursor || bi === doc.childCount - 1) {
      // Re-walk from block's md start to target, counting PM text matches
      let pmCount = 0;
      let lastMatchMdIdx = -1;
      for (
        let mdIdx = mdSaveStart;
        mdIdx < target && mdIdx < markdown.length;
        mdIdx++
      ) {
        if (pmCount < pmText.length && markdown[mdIdx] === pmText[pmCount]) {
          pmCount++;
          lastMatchMdIdx = mdIdx;
        }
      }

      // When no text was matched before target, the cursor is at the block's
      // content start — before any leading atoms. Distinguish "before atom"
      // (target at atom syntax like '#') from "after atom" (target at first
      // matching text char) by checking whether non-separator characters
      // (atom syntax) appear between block start and target.
      if (pmCount === 0 && block.isTextblock && block.content.size > 0) {
        let firstContentChar = mdSaveStart;
        while (
          firstContentChar < markdown.length &&
          markdown[firstContentChar] === "\n"
        ) {
          firstContentChar++;
        }
        if (target <= firstContentChar) {
          // Target is at or before atom syntax start → block content start
          return contentStart;
        }
        // Target is past atom syntax → "after atom": skip leading atoms
        // to find the first text node's offset within the block.
        let atomOffset = 0;
        for (let ci = 0; ci < block.childCount; ci++) {
          const child = block.child(ci);
          if (child.isText) break;
          atomOffset += child.nodeSize;
        }
        return Math.min(
          contentStart + atomOffset,
          contentStart + block.content.size,
        );
      }

      // Detect if target is past a non-matching gap (atom's markdown region).
      // Gap means cursor was positioned after the atom in markdown → prefer
      // the "after atom" PM position. No gap → prefer "before atom" position.
      const hasGapBeforeTarget =
        lastMatchMdIdx >= mdSaveStart && target > lastMatchMdIdx + 1;
      const preferBeforeAtom = !hasGapBeforeTarget;

      // When ALL text has been consumed and there's a trailing gap, the
      // cursor is after trailing atom(s) at the end of the block content.
      // textPosToPmOffset can't distinguish this because it only knows about
      // text positions, not atoms. Return content end directly.
      if (
        pmCount === pmText.length &&
        hasGapBeforeTarget &&
        block.isTextblock
      ) {
        return contentStart + block.content.size;
      }

      // Convert PM text count to PM content offset.
      // preferBeforeAtom only applies to textblocks (paragraphs with inline atoms).
      // For compound blocks (tables, lists), text-node boundaries represent structural
      // boundaries (cell edges, list item separators), not atom gaps.
      const pmOffset = block.isTextblock
        ? textPosToPmOffset(block, pmCount, false, preferBeforeAtom)
        : textPosToPmOffset(block, pmCount, !isTable, false);

      return Math.min(
        contentStart + pmOffset,
        contentStart + block.content.size,
      );
    }

    pmBlockStart += block.nodeSize;
  }

  return doc.content.size;
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
    const pmText = blockMatchText(block, sep);
    mdCursor = advancePastBlock(markdown, mdCursor, pmText);
  }

  // Match within the target block
  const block = doc.child(targetBlockIdx);
  const isTable = block.type.name === "table";
  const sep = isTable ? "" : "\n";
  const pmText = blockMatchText(block, sep);

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

  // Detect if cursor is right after a trailing atom node.
  // When clampedOffset === block.content.size and the last child is an atom,
  // pmTextPos equals the full text length, which is indistinguishable from
  // "before the trailing atom" without this flag. We need to scan past the
  // atom's markdown syntax in the output.
  let isAfterTrailingAtom = false;
  if (
    block.isTextblock &&
    !isBeforeAtom &&
    clampedOffset === block.content.size &&
    block.childCount > 0
  ) {
    const lastChild = block.child(block.childCount - 1);
    if (!lastChild.isText) {
      isAfterTrailingAtom = true;
    }
  }

  // Atom-only block (no text at all): distinguish before vs after.
  if (pmText.length === 0) {
    if (isAfterTrailingAtom) {
      // Scan past the atom's markdown syntax in this block region.
      // Find the end of the block's markdown line from mdCursor.
      let mdEnd = mdCursor;
      while (mdEnd < markdown.length && markdown[mdEnd] !== "\n") {
        mdEnd++;
      }
      return mdEnd;
    }
    return mdCursor;
  }

  // Walk markdown matching pmTextPos characters of PM text
  let pmIdx = 0;
  let lastMatchEnd = mdCursor;
  for (let mdIdx = mdCursor; mdIdx < markdown.length; mdIdx++) {
    if (pmIdx < pmText.length && markdown[mdIdx] === pmText[pmIdx]) {
      // If we've already consumed enough text chars, this is the target position
      if (pmIdx >= pmTextPos) {
        if (isBeforeAtom) {
          if (pmTextPos > 0) return lastMatchEnd;
          // pmTextPos=0: cursor before a leading atom at block start.
          // Return first non-newline position in block's markdown region,
          // so the reverse mapper assigns target to THIS block (not the
          // previous block whose boundary equals mdCursor).
          for (let scan = mdCursor; scan < mdIdx; scan++) {
            if (markdown[scan] !== "\n") return scan;
          }
        }
        return mdIdx;
      }
      pmIdx++;
      lastMatchEnd = mdIdx + 1;
    }
  }
  // All PM text was matched — cursor at or past end of block
  if (pmIdx >= pmTextPos) {
    if (isAfterTrailingAtom) {
      // Scan from lastMatchEnd past the trailing atom's markdown syntax.
      // Stop at newline (block boundary) or end of string.
      let mdEnd = lastMatchEnd;
      while (mdEnd < markdown.length && markdown[mdEnd] !== "\n") {
        mdEnd++;
      }
      return mdEnd;
    }
    return lastMatchEnd;
  }
  return markdown.length;
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
