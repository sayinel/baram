// §35 Quick Switcher — heading extraction/lookup against a ProseMirror doc
import type { Editor } from "@tiptap/react";

/** Heading with ProseMirror position for direct navigation. */
export interface HeadingResult {
  level: number;
  /** ProseMirror doc position (start of heading content) */
  pmPos: number;
  text: string;
}

/** Extract headings directly from ProseMirror doc with positions. */
export function extractHeadingsFromDoc(editor: Editor): HeadingResult[] {
  const headings: HeadingResult[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({
        level: node.attrs.level,
        text: node.textContent,
        pmPos: pos + 1, // inside the heading (after opening tag)
      });
    }
  });
  return headings;
}

/** Find the Nth heading in ProseMirror doc matching level + text. */
export function findHeadingPos(
  editor: Editor,
  level: number,
  text: string,
  targetIndex: number,
): null | number {
  let matchCount = 0;
  let found: null | number = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "heading" && node.attrs.level === level) {
      // For markdown-extracted headings, text may include formatting markers.
      // Use textContent (plain) for comparison — strip markdown from search text too.
      const nodeText = node.textContent;
      if (nodeText === text || text.includes(nodeText)) {
        if (matchCount === targetIndex) {
          found = pos + 1;
          return false;
        }
        matchCount++;
      }
    }
  });
  return found;
}
