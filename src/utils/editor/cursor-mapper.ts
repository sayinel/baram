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
  blockTextSize: number;
  textOffset: number;
}

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
 * 마크다운 줄 번호(1-based) → 그 줄이 만든 내용의 PM 위치.
 *
 * ‼️ 계약은 "그 줄을 품은 **최상위** 블록의 시작"이 아니라 "그 줄 자체"다. 목록·인용문·
 * 표·코드 펜스는 여러 줄이면서 최상위 노드는 하나라, 블록 시작으로는 "이 목록의 세 번째
 * 항목"을 표현할 수 없다 — 항목 세 개가 전부 첫 항목으로 접혔다. 그래서 컨테이너 안으로
 * **내려간다**: 최상위에서 시작해 각 자식의 마크다운 구간을 재고, 목표 줄을 품은 자식으로
 * 한 단계씩 들어가 잎 텍스트블록에 닿으면 그 안에서의 문자 위치까지 짚는다.
 *
 * 표만은 행에서 멈춘다. 마크다운의 한 줄은 셀이 아니라 **행** 하나이므로, 셀까지 내려가는
 * 것은 없는 정보를 지어내는 일이다.
 */
export function mdLineToPmPos(
  doc: PMNode,
  content: string,
  line: number,
): number {
  if (doc.childCount === 0) return 0;

  const lines = content.split("\n");

  // Character offset of the start of the target line
  let targetOffset = 0;
  for (let i = 0; i < Math.min(Math.max(line - 1, 0), lines.length); i++) {
    targetOffset += lines[i].length + 1;
  }

  return descendToOffset(
    doc,
    0,
    content,
    0,
    content.length,
    targetOffset,
    false,
  );
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
 * 노드가 차지하는 마크다운 구간의 끝.
 *
 * ‼️ 글자 맞추기만으로는 부족하다. 그것은 노드의 **PM 텍스트**가 끝난 자리를 줄 뿐이라,
 * 텍스트보다 마크다운이 긴 노드 — 내용이 전부 인라인 atom인 항목(`- [ ] #work`), 위키링크만
 * 든 항목 — 은 구간이 첫 줄에서 끝나고 나머지 줄이 **다음 형제**로 새어 나간다. 사용자가
 * 본 "세 번째 항목을 눌렀더니 목록 아래 문단으로 갔다"가 정확히 이것이다.
 *
 * 그래서 바닥을 깐다: 노드가 가진 "줄을 차지하는 잎"의 수만큼은 내용 줄을 반드시 먹는다.
 */
function advanceRegion(
  markdown: string,
  start: number,
  node: PMNode,
  inTable: boolean,
): number {
  // 표 안에서는 셀 경계가 줄바꿈이 아니다 — 구분자를 넣으면 행 텍스트가 마크다운에
  // 없는 "\n"을 찾아 문서 끝까지 달린다.
  const sep = inTable || node.type.name === "table" ? "" : "\n";
  const matched = advancePastBlock(markdown, start, blockMatchText(node, sep));
  return Math.max(matched, nthLineEnd(markdown, start, lineOwningLeaves(node)));
}

/**
 * Text used to align a PM block against the markdown string. Same as
 * block.textBetween(), except for text-less atom blocks (e.g. mermaid) whose
 * content lives in an attribute — those return the attribute value so the
 * matcher can advance through their markdown region.
 */
function blockMatchText(block: PMNode, sep: string): string {
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
 * `parent`의 자식들을 마크다운 구간과 나란히 걸으며 `target`을 품은 자식으로 내려간다.
 *
 * `parentContentStart`는 `parent`의 **내용 시작** PM 위치이고, `[regionStart, regionEnd]`는
 * 그 내용이 차지하는 마크다운 구간이다. 마지막 자식은 남은 구간을 전부 가져간다 —
 * 구간 계산이 조금 짧게 끝났을 때 목표가 아무 자식에도 속하지 않는 일을 막는다.
 */
function descendToOffset(
  parent: PMNode,
  parentContentStart: number,
  markdown: string,
  regionStart: number,
  regionEnd: number,
  target: number,
  inTable: boolean,
): number {
  let childPos = parentContentStart;
  let cursor = regionStart;

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const isLast = i === parent.childCount - 1;
    const childEnd = isLast
      ? regionEnd
      : Math.min(advanceRegion(markdown, cursor, child, inTable), regionEnd);

    if (target <= childEnd || isLast) {
      const contentStart = childPos + (child.isLeaf ? 0 : 1);
      if (child.isTextblock) {
        return offsetWithinTextblock(
          child,
          contentStart,
          markdown,
          cursor,
          target,
        );
      }
      // 표는 행에서 멈춘다 — 줄 하나가 행 하나이지 셀 하나가 아니다.
      if (child.isLeaf || child.type.name === "tableRow") return contentStart;
      return descendToOffset(
        child,
        contentStart,
        markdown,
        cursor,
        childEnd,
        target,
        inTable || child.type.name === "table",
      );
    }

    cursor = childEnd;
    childPos += child.nodeSize;
  }

  return parentContentStart;
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

/** 이 노드가 반드시 차지하는 마크다운 **내용 줄**의 수(하한). */
function lineOwningLeaves(node: PMNode): number {
  // 표 = 행들 + 구분자 줄 하나. 셀까지 세면 한 줄에 여러 개가 앉아 과대 계산된다.
  if (node.type.name === "table") return node.childCount + 1;
  if (node.type.name === "tableRow") return 1;
  if (node.isTextblock) return node.content.size > 0 ? 1 : 0;
  if (node.isLeaf) return 1;
  let count = 0;
  node.forEach((child) => {
    count += lineOwningLeaves(child);
  });
  return count;
}

/**
 * `start`에서 시작해 빈 줄을 건너뛰고 내용 줄 `count`개를 지난 지점(그 마지막 줄의 끝).
 *
 * `start`가 줄 중간이면(앞 블록의 글자 맞추기가 그 줄 안에서 끝났다) 그 줄은 이 노드의
 * 것이 아니므로 다음 줄부터 센다.
 */
function nthLineEnd(markdown: string, start: number, count: number): number {
  if (count <= 0) return start;

  let i = start;
  if (i > 0 && markdown[i - 1] !== "\n") {
    while (i < markdown.length && markdown[i] !== "\n") i++;
    if (i < markdown.length) i++;
  }

  let seen = 0;
  let end = start;
  while (i <= markdown.length && seen < count) {
    let lineEnd = i;
    while (lineEnd < markdown.length && markdown[lineEnd] !== "\n") lineEnd++;
    if (markdown.slice(i, lineEnd).trim().length > 0) {
      seen++;
      end = lineEnd;
    }
    if (lineEnd >= markdown.length) break;
    i = lineEnd + 1;
  }

  return Math.max(end, start);
}

/**
 * 잎 텍스트블록 안에서의 위치. 블록 구간의 시작부터 목표까지 마크다운을 걸으며 이 블록의
 * 텍스트와 맞은 글자 수를 세고, 그 텍스트 위치를 PM 오프셋으로 되돌린다. 코드 펜스나
 * 소프트 줄바꿈이 든 문단처럼 **한 텍스트블록이 여러 줄**인 경우에 그 줄로 내려 준다.
 */
function offsetWithinTextblock(
  block: PMNode,
  contentStart: number,
  markdown: string,
  regionStart: number,
  target: number,
): number {
  const text = blockMatchText(block, "\n");
  if (text.length === 0) return contentStart;

  let pmCount = 0;
  for (let i = regionStart; i < target && i < markdown.length; i++) {
    if (pmCount < text.length && markdown[i] === text[pmCount]) pmCount++;
  }
  if (pmCount === 0) return contentStart;

  const offset = textPosToPmOffset(block, pmCount, false, true);
  return Math.min(contentStart + offset, contentStart + block.content.size);
}

/**
 * Convert a text-level position (index into textBetween output) back to a
 * PM content offset within a compound block (lists, blockquotes, tables).
 *
 * Must account for the "\n" separator that textBetween inserts between
 * ALL leaf blocks (textblocks), including those containing only atom nodes.
 * For tables, separators are not used (countSeparators=false).
 */
function textPosToPmOffset(
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
