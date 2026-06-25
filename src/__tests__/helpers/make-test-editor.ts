// Test helper — creates a full Tiptap Editor with all Baram extensions.
// Mirrors the pattern used in src/extensions/__tests__/heading-shortcuts.test.ts.
import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";

/**
 * Creates a Tiptap Editor instance pre-loaded with all Baram extensions.
 * Pass an HTML string for `content` (e.g. "<p>A</p><p>B</p>").
 * Destroy the editor after the test if you care about cleanup.
 */
export function makeTestEditor(content: string): Editor {
  return new Editor({
    extensions: createBaramExtensions(),
    content,
  });
}
