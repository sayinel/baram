// §5.1 Cursor position mapping between ProseMirror and Markdown
// Character-level text matching for precise cursor mapping

import type { Node as PMNode } from "@tiptap/pm/model";

interface BlockInfo {
  blockIndex: number;
  textOffset: number;
  blockTextSize: number;
}

interface MarkdownBlock {
  start: number;
  end: number;
  length: number;
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
 * Split markdown into blocks by blank lines.
 * Respects fenced code blocks (```) and frontmatter (---) boundaries.
 */
function splitMarkdownBlocks(markdown: string): MarkdownBlock[] {
  if (markdown.length === 0) {
    return [{ start: 0, end: 0, length: 0 }];
  }

  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let blockStartLine = 0;
  let inFencedCode = false;
  let inFrontmatter = false;
  let htmlBlockDepth = 0; // Tracks nested <details> blocks
  let lineOffset = 0;
  const lineOffsets: number[] = [];

  // Pre-compute line start offsets
  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(lineOffset);
    lineOffset += lines[i].length + 1; // +1 for \n
  }

  // Check for frontmatter at start
  if (lines[0] === "---") {
    inFrontmatter = true;
  }

  let listType: "ordered" | "bullet" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track fenced code blocks (including indented fences inside lists/blockquotes)
    const strippedForFence = line.replace(/^\s*(?:>\s*)*/,"");
    if (!inFrontmatter && /^(`{3,}|~{3,})/.test(strippedForFence)) {
      inFencedCode = !inFencedCode;
      continue;
    }

    // Track frontmatter end
    if (inFrontmatter && i > 0 && line === "---") {
      inFrontmatter = false;
      continue;
    }

    // Track <details> HTML blocks (supports nesting)
    if (!inFencedCode && !inFrontmatter) {
      if (/^<details[\s>]/i.test(trimmed)) {
        htmlBlockDepth++;
      }
      if (/<\/details>/i.test(trimmed)) {
        htmlBlockDepth = Math.max(0, htmlBlockDepth - 1);
      }
    }

    // Skip blank-line splitting inside code blocks, frontmatter, or HTML blocks
    if (inFencedCode || inFrontmatter || htmlBlockDepth > 0) continue;

    // Track list context — loose lists have blank lines between items
    if (listType === null) {
      if (/^\s*\d+[.)]\s/.test(line)) listType = "ordered";
      else if (/^\s*[-*+]\s/.test(line)) listType = "bullet";
    }

    // Blank line — end current block, start new one
    if (line === "" && i > blockStartLine) {
      // Inside a list, check if the next non-blank line continues the SAME list
      if (listType !== null) {
        let nextNonBlank = "";
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j] !== "") { nextNonBlank = lines[j]; break; }
        }
        // List continues if next line is indented continuation
        if (/^\s+\S/.test(nextNonBlank)) {
          continue; // indented content, still in list
        }
        // List continues if next line is the same type of list item
        const nextIsOrdered = /^\s*\d+[.)]\s/.test(nextNonBlank);
        const nextIsBullet = /^\s*[-*+]\s/.test(nextNonBlank);
        if ((listType === "ordered" && nextIsOrdered) || (listType === "bullet" && nextIsBullet)) {
          continue; // same list type, loose list
        }
        listType = null;
      }

      const blockStart = lineOffsets[blockStartLine];
      const blockEnd = lineOffsets[i - 1] + lines[i - 1].length;
      blocks.push({
        start: blockStart,
        end: blockEnd,
        length: blockEnd - blockStart,
      });
      blockStartLine = i + 1;
    } else if (line === "" && i === blockStartLine) {
      // Consecutive blank lines — skip
      blockStartLine = i + 1;
    }
  }

  // Final block
  if (blockStartLine < lines.length) {
    const blockStart = lineOffsets[blockStartLine];
    const lastLine = lines.length - 1;
    const blockEnd = lineOffsets[lastLine] + lines[lastLine].length;
    blocks.push({
      start: blockStart,
      end: blockEnd,
      length: blockEnd - blockStart,
    });
  }

  if (blocks.length === 0) {
    return [{ start: 0, end: markdown.length, length: markdown.length }];
  }

  // Insert empty blocks for extra blank lines to match enrichWithEmptyParagraphs
  // in md-to-pm.ts — formula: emptyParas = floor((newlines - 2) / 2)
  const enriched: MarkdownBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    enriched.push(blocks[i]);
    if (i < blocks.length - 1) {
      const gapStart = blocks[i].end;
      const gapEnd = blocks[i + 1].start;
      const gap = markdown.substring(gapStart, gapEnd);
      const newlineCount = (gap.match(/\n/g) || []).length;
      const emptyParas = Math.max(0, Math.floor((newlineCount - 2) / 2));
      for (let j = 0; j < emptyParas; j++) {
        enriched.push({ start: gapEnd, end: gapEnd, length: 0 });
      }
    }
  }

  return enriched;
}

/**
 * Walk MD block text matching against PM block text to find the MD offset
 * for a given PM text position. Markdown syntax characters (## headings,
 * **bold**, [link](url), list prefixes, etc.) are automatically skipped.
 */
function matchPmPosInMd(
  mdBlockText: string,
  pmBlockText: string,
  pmTextPos: number,
): number {
  let pmIdx = 0;
  for (let mdIdx = 0; mdIdx < mdBlockText.length; mdIdx++) {
    if (pmIdx < pmBlockText.length && mdBlockText[mdIdx] === pmBlockText[pmIdx]) {
      // Found the next content character — if we've already consumed enough,
      // this is the target position (right before this character).
      if (pmIdx >= pmTextPos) return mdIdx;
      pmIdx++;
    }
  }
  return mdBlockText.length;
}

/**
 * Walk MD block text matching against PM block text to find the PM text position
 * for a given MD offset.
 */
function matchMdPosInPm(
  mdBlockText: string,
  pmBlockText: string,
  mdOffset: number,
): number {
  let pmIdx = 0;
  const end = Math.min(mdOffset, mdBlockText.length);
  for (let mdIdx = 0; mdIdx < end; mdIdx++) {
    if (pmIdx < pmBlockText.length && mdBlockText[mdIdx] === pmBlockText[pmIdx]) {
      pmIdx++;
    }
  }
  return pmIdx;
}

/**
 * Convert a text-level position (index into textBetween output) back to a
 * PM content offset within a compound block (lists, blockquotes, tables).
 *
 * Must account for the "\n" separator that textBetween inserts between
 * leaf blocks (paragraphs in different list items, etc.).
 * For tables, separators are not used (countSeparators=false).
 */
function textPosToPmOffset(block: PMNode, targetTextPos: number, countSeparators: boolean = true): number {
  // Collect text nodes — needed for tables where cell boundary handling
  // depends on knowing whether a text node is the last one.
  const textNodes: { pos: number; length: number; nodeSize: number }[] = [];
  block.descendants((node, pos) => {
    if (node.isText) {
      textNodes.push({ pos, length: node.text!.length, nodeSize: node.nodeSize });
    }
    return true;
  });

  let textCount = 0;
  let lastEnd = 0;
  for (let i = 0; i < textNodes.length; i++) {
    const tn = textNodes[i];
    // When crossing a block boundary (gap between text regions),
    // textBetween inserts a "\n" separator — count it (unless skipped for tables).
    if (countSeparators && i > 0 && tn.pos > lastEnd) {
      textCount++; // "\n" separator
    }
    const remaining = targetTextPos - textCount;
    // For tables (countSeparators=false), at intermediate cell boundaries prefer
    // the start of the next cell over the end of the current one, matching the
    // forward mapping. For the last text node, use <= to capture end-of-text.
    const isLast = i === textNodes.length - 1;
    const fits = (!countSeparators && !isLast)
      ? remaining < tn.length
      : remaining <= tn.length;
    if (fits) {
      return tn.pos + remaining;
    }
    textCount += tn.length;
    lastEnd = tn.pos + tn.nodeSize;
  }
  return block.content.size;
}

/**
 * PM cursor position → markdown character offset.
 * Uses character-level text matching for precise mapping.
 */
export function pmPosToMdOffset(
  doc: PMNode,
  pmPos: number,
  markdown: string,
): number {
  if (doc.childCount === 0 || markdown.length === 0) return 0;

  const { blockIndex, textOffset } = getBlockIndexAndOffset(doc, pmPos);
  const mdBlocks = splitMarkdownBlocks(markdown);
  const idx = Math.min(blockIndex, mdBlocks.length - 1);
  const mdBlock = mdBlocks[idx];

  if (mdBlock.length === 0) return mdBlock.start;

  const pmBlockIdx = Math.min(blockIndex, doc.childCount - 1);
  const pmBlock = doc.child(pmBlockIdx);
  // Tables: use empty separator — "\n" in PM text doesn't correspond to
  // any single MD character (cells on same row are separated by "|", not "\n").
  const isTable = pmBlock.type.name === "table";
  const sep = isTable ? "" : "\n";
  const pmBlockText = pmBlock.textBetween(0, pmBlock.content.size, sep);
  const mdBlockText = markdown.substring(mdBlock.start, mdBlock.end);

  if (pmBlockText.length === 0) return mdBlock.start;

  // Convert PM content offset to text position
  const clampedOffset = Math.min(textOffset, pmBlock.content.size);
  const pmTextPos = pmBlock.isTextblock
    ? Math.min(clampedOffset, pmBlockText.length)
    : pmBlock.textBetween(0, clampedOffset, sep).length;

  // Match PM text position in MD text via character walking
  const mdOffsetInBlock = matchPmPosInMd(mdBlockText, pmBlockText, pmTextPos);
  return Math.min(mdBlock.start + mdOffsetInBlock, mdBlock.end);
}

/**
 * Markdown character offset → PM cursor position.
 * Uses character-level text matching for precise mapping.
 */
export function mdOffsetToPmPos(
  doc: PMNode,
  mdOffset: number,
  markdown: string,
): number {
  if (doc.childCount === 0) return 0;

  const mdBlocks = splitMarkdownBlocks(markdown);
  const clampedOffset = Math.max(0, Math.min(mdOffset, markdown.length));

  // Find which markdown block the offset falls in
  let blockIndex = mdBlocks.length - 1;
  let offsetInBlock = mdBlocks[blockIndex].length;
  for (let i = 0; i < mdBlocks.length; i++) {
    if (clampedOffset <= mdBlocks[i].end) {
      blockIndex = i;
      offsetInBlock = Math.max(0, clampedOffset - mdBlocks[i].start);
      break;
    }
  }

  const idx = Math.min(blockIndex, doc.childCount - 1);

  // Compute PM position for the start of this block's content
  let pmBlockStart = 0;
  for (let i = 0; i < idx; i++) {
    pmBlockStart += doc.child(i).nodeSize;
  }
  const pmBlock = doc.child(idx);
  // Leaf nodes (e.g. horizontalRule) have no opening token
  pmBlockStart += pmBlock.isLeaf ? 0 : 1;

  const isTable = pmBlock.type.name === "table";
  const sep = isTable ? "" : "\n";
  const pmBlockText = pmBlock.textBetween(0, pmBlock.content.size, sep);
  const mdBlockText = markdown.substring(
    mdBlocks[Math.min(blockIndex, mdBlocks.length - 1)].start,
    mdBlocks[Math.min(blockIndex, mdBlocks.length - 1)].end,
  );

  if (pmBlockText.length === 0 || mdBlockText.length === 0) return pmBlockStart;

  // Match MD offset in PM text via character walking
  const pmTextPos = matchMdPosInPm(mdBlockText, pmBlockText, offsetInBlock);

  // Convert PM text position to PM content offset
  const pmOffset = pmBlock.isTextblock
    ? Math.min(pmTextPos, pmBlock.content.size)
    : textPosToPmOffset(pmBlock, pmTextPos, !isTable);

  return Math.min(pmBlockStart + pmOffset, pmBlockStart + pmBlock.content.size);
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

  // Build raw block structure (without enriched empty paragraphs)
  const rawBlocks: { start: number; end: number }[] = [];
  let blockStartLine = 0;
  let inFencedCode = false;
  let inFrontmatter = lines.length > 0 && lines[0] === "---";
  let htmlBlockDepth = 0;
  let lineOffset = 0;
  const lineOffsets: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(lineOffset);
    lineOffset += lines[i].length + 1;
  }

  let listType: "ordered" | "bullet" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const trimmed = l.trim();

    const strippedForFence = l.replace(/^\s*(?:>\s*)*/,"");
    if (!inFrontmatter && /^(`{3,}|~{3,})/.test(strippedForFence)) {
      inFencedCode = !inFencedCode;
      continue;
    }
    if (inFrontmatter && i > 0 && l === "---") {
      inFrontmatter = false;
      continue;
    }
    if (!inFencedCode && !inFrontmatter) {
      if (/^<details[\s>]/i.test(trimmed)) {
        htmlBlockDepth++;
      }
      if (/<\/details>/i.test(trimmed)) {
        htmlBlockDepth = Math.max(0, htmlBlockDepth - 1);
      }
    }
    if (inFencedCode || inFrontmatter || htmlBlockDepth > 0) continue;

    if (listType === null) {
      if (/^\s*\d+[.)]\s/.test(l)) listType = "ordered";
      else if (/^\s*[-*+]\s/.test(l)) listType = "bullet";
    }

    if (l === "" && i > blockStartLine) {
      if (listType !== null) {
        let nextNonBlank = "";
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j] !== "") { nextNonBlank = lines[j]; break; }
        }
        if (/^\s+\S/.test(nextNonBlank)) {
          continue;
        }
        const nextIsOrdered = /^\s*\d+[.)]\s/.test(nextNonBlank);
        const nextIsBullet = /^\s*[-*+]\s/.test(nextNonBlank);
        if ((listType === "ordered" && nextIsOrdered) || (listType === "bullet" && nextIsBullet)) {
          continue;
        }
        listType = null;
      }
      rawBlocks.push({
        start: lineOffsets[blockStartLine],
        end: lineOffsets[i - 1] + lines[i - 1].length,
      });
      blockStartLine = i + 1;
    } else if (l === "" && i === blockStartLine) {
      blockStartLine = i + 1;
    }
  }

  // Final block
  if (blockStartLine < lines.length) {
    const lastLine = lines.length - 1;
    rawBlocks.push({
      start: lineOffsets[blockStartLine],
      end: lineOffsets[lastLine] + lines[lastLine].length,
    });
  }

  if (rawBlocks.length === 0) return 1;

  // Find which raw block contains the target offset
  let rawBlockIdx = rawBlocks.length - 1;
  for (let i = 0; i < rawBlocks.length; i++) {
    if (targetOffset <= rawBlocks[i].end) {
      rawBlockIdx = i;
      break;
    }
  }

  // Count enriched empty paragraphs before this block
  let emptyParasBefore = 0;
  for (let i = 0; i < rawBlockIdx && i < rawBlocks.length - 1; i++) {
    const gap = content.substring(rawBlocks[i].end, rawBlocks[i + 1].start);
    const newlineCount = (gap.match(/\n/g) || []).length;
    emptyParasBefore += Math.max(0, Math.floor((newlineCount - 2) / 2));
  }

  // PM child index = raw block index + enriched empty paras before it
  const pmIdx = Math.min(
    rawBlockIdx + emptyParasBefore,
    doc.childCount - 1,
  );

  // Compute PM position for the start of this block's content
  let pos = 0;
  for (let i = 0; i < pmIdx; i++) {
    pos += doc.child(i).nodeSize;
  }
  return pos + 1; // +1 for opening token
}
