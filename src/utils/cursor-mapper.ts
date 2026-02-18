// §5.1 Cursor position mapping between ProseMirror and Markdown
// Block-index based mapping with proportional intra-block offset

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
    const start = pos + 1; // +1 for the opening token
    const end = start + child.content.size;
    // Next block starts after closing token
    const nextPos = end + 1;

    if (pmPos <= end) {
      const textOffset = Math.max(0, pmPos - start);
      return {
        blockIndex: i,
        textOffset,
        blockTextSize: child.content.size,
      };
    }
    pos = nextPos;
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track fenced code blocks
    if (!inFrontmatter && /^(`{3,}|~{3,})/.test(line)) {
      inFencedCode = !inFencedCode;
      continue;
    }

    // Track frontmatter end
    if (inFrontmatter && i > 0 && line === "---") {
      inFrontmatter = false;
      continue;
    }

    // Skip blank-line splitting inside code blocks or frontmatter
    if (inFencedCode || inFrontmatter) continue;

    // Blank line — end current block, start new one
    if (line === "" && i > blockStartLine) {
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
 * PM cursor position → markdown character offset.
 * Maps via block index + proportional intra-block offset.
 */
export function pmPosToMdOffset(
  doc: PMNode,
  pmPos: number,
  markdown: string,
): number {
  if (doc.childCount === 0 || markdown.length === 0) return 0;

  const { blockIndex, textOffset, blockTextSize } = getBlockIndexAndOffset(
    doc,
    pmPos,
  );
  const mdBlocks = splitMarkdownBlocks(markdown);

  // Clamp blockIndex to available markdown blocks
  const idx = Math.min(blockIndex, mdBlocks.length - 1);
  const block = mdBlocks[idx];

  if (blockTextSize === 0) return block.start;

  // Proportional offset within the block
  const ratio = textOffset / blockTextSize;
  const offsetInBlock = Math.round(ratio * block.length);
  return Math.min(block.start + offsetInBlock, block.end);
}

/**
 * Markdown character offset → PM cursor position.
 * Maps via block index + proportional intra-block offset.
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
  let offsetInBlock = mdBlocks[blockIndex].length; // default: end of last block
  for (let i = 0; i < mdBlocks.length; i++) {
    if (clampedOffset <= mdBlocks[i].end) {
      blockIndex = i;
      offsetInBlock = Math.max(0, clampedOffset - mdBlocks[i].start);
      break;
    }
  }

  // Clamp blockIndex to PM doc children
  const idx = Math.min(blockIndex, doc.childCount - 1);

  // Compute PM position for the start of this block
  let pmBlockStart = 0;
  for (let i = 0; i < idx; i++) {
    pmBlockStart += doc.child(i).nodeSize;
  }
  pmBlockStart += 1; // Opening token of target block

  const blockNode = doc.child(idx);
  const blockTextSize = blockNode.content.size;
  const mdBlock = mdBlocks[Math.min(blockIndex, mdBlocks.length - 1)];

  if (mdBlock.length === 0 || blockTextSize === 0) return pmBlockStart;

  // Proportional offset
  const ratio = offsetInBlock / mdBlock.length;
  const pmOffset = Math.round(ratio * blockTextSize);
  return Math.min(pmBlockStart + pmOffset, pmBlockStart + blockTextSize);
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
  let lineOffset = 0;
  const lineOffsets: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(lineOffset);
    lineOffset += lines[i].length + 1;
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    if (!inFrontmatter && /^(`{3,}|~{3,})/.test(l)) {
      inFencedCode = !inFencedCode;
      continue;
    }
    if (inFrontmatter && i > 0 && l === "---") {
      inFrontmatter = false;
      continue;
    }
    if (inFencedCode || inFrontmatter) continue;

    if (l === "" && i > blockStartLine) {
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
