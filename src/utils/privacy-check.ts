// §49 Privacy Mode — restrict LLM to local-only providers
// E1: Per-file privacy via frontmatter `privacy: true`

import type { Editor } from "@tiptap/core";

/**
 * Check if LLM usage is allowed given privacy settings.
 * @param privacyMode - Global privacy mode setting
 * @param provider - LLM provider name
 * @param filePrivacy - Per-file privacy flag (from frontmatter `privacy: true`)
 */
export function isLLMAllowed(
  privacyMode: boolean,
  provider: string,
  filePrivacy?: boolean,
): boolean {
  const effectivePrivacy = privacyMode || filePrivacy === true;
  if (!effectivePrivacy) return true;
  // Only local providers are allowed in privacy mode
  return provider === "ollama";
}

/** Detect per-file privacy from frontmatter `privacy: true` in the editor doc. */
export function getFilePrivacy(editor: Editor | null): boolean {
  if (!editor) return false;
  let isPrivate = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "frontmatter") {
      const text = node.textContent;
      if (/privacy:\s*true/i.test(text)) {
        isPrivate = true;
      }
      return false;
    }
    return !isPrivate;
  });
  return isPrivate;
}
