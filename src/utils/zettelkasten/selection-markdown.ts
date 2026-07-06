import type { Editor } from "@tiptap/core";

/**
 * Derive a title from the first non-empty line of (possibly multi-paragraph)
 * selection text, so a multi-paragraph selection titles from its first line
 * while the full selection — paragraph breaks intact — is kept as the body.
 */
export function firstNonEmptyLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * §95 New-from-selection: read the editor selection as block-separated text.
 * Unlike the shared `getSelectedText` (`utils/ai-commands.ts`, which calls
 * `textBetween(from, to)` with NO separator — multi-paragraph selections
 * collapse into a single run of text), this passes `"\n\n"` as the block
 * separator so paragraph breaks in the selection are preserved in the note
 * body. Zettel-local: do not use for the shared AI-commands consumers.
 */
export function getSelectionMarkdown(editor: Editor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return "";
  return editor.state.doc.textBetween(from, to, "\n\n");
}
