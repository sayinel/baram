// §30c Block navigation utilities — find block by ^blockId
import type { Node as PmNode } from "@tiptap/pm/model";

/**
 * Extract the text content of a block with the given ^blockId.
 * Strips the ^blockId suffix and heading prefix (# markers).
 */
export function findBlockContent(
  content: string,
  blockId: string,
): null | string {
  const lines = content.split("\n");
  const suffix = ` ^${blockId}`;
  for (const line of lines) {
    if (line.endsWith(suffix)) {
      // Remove ^blockId suffix
      let text = line.slice(0, line.length - suffix.length);
      // Remove heading prefix (# markers)
      text = text.replace(/^#{1,6}\s+/, "");
      return text.trim();
    }
  }
  return null;
}

/**
 * Find the 1-based line number of a block with the given ^blockId suffix.
 * Searches for ` ^{blockId}` at end of line (block ID suffix pattern from §30a).
 */
export function findBlockLine(content: string, blockId: string): null | number {
  const lines = content.split("\n");
  const suffix = ` ^${blockId}`;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].endsWith(suffix)) {
      return i + 1; // 1-based
    }
  }
  return null;
}

/**
 * Find ProseMirror position of a block node with attrs.blockId === blockId.
 * Returns the position of the node (suitable for setTextSelection).
 */
export function findBlockPosById(doc: PmNode, blockId: string): null | number {
  let found: null | number = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (
      (node.type.name === "paragraph" || node.type.name === "heading") &&
      node.attrs.blockId === blockId
    ) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Find ProseMirror position of the first heading node matching the given text.
 * Comparison is case-insensitive. Returns the node position (not +1 inside).
 */
export function findHeadingPosByText(
  doc: PmNode,
  heading: string,
): null | number {
  const headingLower = heading.toLowerCase();
  let found: null | number = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (
      node.type.name === "heading" &&
      node.textContent.toLowerCase() === headingLower
    ) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}
