// §30c Block navigation utilities — find block by ^blockId
import type { Node as PmNode } from "@tiptap/pm/model";

/**
 * Find the 1-based line number of a block with the given ^blockId suffix.
 * Searches for ` ^{blockId}` at end of line (block ID suffix pattern from §30a).
 */
export function findBlockLine(content: string, blockId: string): number | null {
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
export function findBlockPosById(doc: PmNode, blockId: string): number | null {
  let found: number | null = null;
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
 * Extract the text content of a block with the given ^blockId.
 * Strips the ^blockId suffix and heading prefix (# markers).
 */
export function findBlockContent(content: string, blockId: string): string | null {
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
