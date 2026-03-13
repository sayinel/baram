// Auto-resize a textarea to fit its content.
// Shared by atom-block NodeViews (math, mermaid, html, block-embed).

import { type RefObject, useEffect } from "react";

/**
 * Adjusts the textarea height to match its scrollHeight whenever
 * `content` changes or `active` becomes true.
 *
 * @param textareaRef - Ref to the textarea element
 * @param content     - Current textarea value (triggers resize on change)
 * @param active      - Whether the textarea is visible / in editing mode
 */
export function useTextareaAutoResize(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  content: string,
  active: boolean,
): void {
  useEffect(() => {
    if (active && textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }, [content, active, textareaRef]);
}
