// §5.4 The code block header's copy button — the `📋` the design draws at the right end of the
// header, beside the language select (dev/design/part5-core-features.md, `5.4 코드 블록`).
//
// Plain DOM for the same reason as the ✨ button next to it: CodeBlockNodeView is a class
// NodeView with CodeMirror inside, so there is no React tree to render `<MediaToolbarButton>` in.

import type { Locale } from "../../../i18n";

import { attachTooltip } from "../../../components/tooltip-core";
import { t } from "../../../i18n";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";

/** lucide `copy` — the glyph the Mermaid and SVG blocks' copy buttons draw. */
const COPY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

export interface CodeBlockCopyButton {
  button: HTMLButtonElement;
  /** Detach the label. The view calls it from its own `destroy`. */
  destroy: () => void;
}

/**
 * Build the button. `getCode` is called at every press, so it must return the block's text as
 * it is then — the view passes a reader of its current node, not a string.
 */
export function createCodeBlockCopyButton(
  getCode: () => string,
): CodeBlockCopyButton {
  const locale = () => useSettingsStore.getState().locale as Locale;

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("code-block-copy-btn");
  button.contentEditable = "false";
  button.innerHTML = COPY_ICON;

  // Read at every show, like the ✨ label: this view is not rebuilt when the locale changes.
  const detachTooltip = attachTooltip(button, {
    label: () => t("blockChrome.copyCode", locale()),
  });

  // Copying changes nothing in the document, so a press must leave focus and the caret where
  // the user had them — inside this block's CodeMirror, or anywhere else.
  button.addEventListener("mousedown", (e) => e.preventDefault());

  button.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const code = getCode();
    if (code === "") return;
    // ‼️ `navigator.clipboard` is undefined outside a secure context, and then the call throws
    // before any promise exists. Caught here so that case reaches the same toast as a refused
    // write instead of escaping the handler unreported. The call stays synchronous inside the
    // click rather than moving into a promise chain: WebKit's Async Clipboard API accepts a
    // write only in response to a user gesture (webkit.org, "Async Clipboard API", 2020).
    let written: Promise<void>;
    try {
      written = navigator.clipboard.writeText(code);
    } catch (err) {
      written = Promise.reject(err);
    }
    const { showToast } = useUIStore.getState();
    void written.then(
      () => showToast(t("blockChrome.codeCopied", locale()), "info"),
      () => showToast(t("blockChrome.copyFailed", locale()), "error"),
    );
  });

  return { button, destroy: detachTooltip };
}
