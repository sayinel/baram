// §43 Ghost Text — 3-tier context prompt builder
// Tier 1: Current paragraph text before cursor
// Tier 2: Previous 2 paragraphs for context
// Tier 3: Document title (first heading)

import type { Editor } from "@tiptap/core";

export function buildGhostTextPrompt(
  editor: Editor,
  cursorPos: number,
): string {
  const { state } = editor;
  const $pos = state.doc.resolve(cursorPos);

  // Tier 1: Current paragraph text before cursor
  const currentText = $pos.parent.textBetween(
    0,
    $pos.parentOffset,
    undefined,
    "\ufffc",
  );

  // Tier 2: Previous paragraphs (up to 2)
  const prevBlocks: string[] = [];
  const parentNode = $pos.depth > 1 ? $pos.node($pos.depth - 1) : state.doc;
  const currentIndex = $pos.index($pos.depth > 1 ? $pos.depth - 1 : 0);
  let nodesBefore = 0;

  for (let i = currentIndex - 1; i >= 0 && nodesBefore < 2; i--) {
    const child = parentNode.child(i);
    const text = child.textContent;
    if (text.trim()) {
      prevBlocks.unshift(text);
      nodesBefore++;
    }
  }

  // Tier 3: Document title (first heading)
  let title = "";
  state.doc.descendants((node) => {
    if (!title && node.type.name === "heading") {
      title = node.textContent;
      return false;
    }
    return !title;
  });

  // Build prompt
  const parts: string[] = [];
  if (title) parts.push(`Document: "${title}"`);
  if (prevBlocks.length > 0)
    parts.push(`Context:\n${prevBlocks.join("\n")}`);
  parts.push(`Continue this text: ${currentText}`);

  return parts.join("\n\n");
}
