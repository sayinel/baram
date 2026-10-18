// §394 spec 0073 D10 · D8 ⑥ · D17 — the element a plugin-rendered block draws into. The host sits
// inside the block's root, outside the plugin's reach (its CSS cannot select the host — `:host` is
// refused by `sanitize-css.ts`); the plugin's sanitized markup and CSS go into the host's open
// shadow root. Open, because export reads `host.shadowRoot` to write declarative shadow DOM (D12).

/** A sanitized result, as the render cache keeps it. */
export interface DrawableContent {
  /** Sanitized CSS — `""` when the result had none. */
  css: string;
  /** Sanitized markup. Never appended itself: `drawRendered` appends a clone. */
  fragment: DocumentFragment;
}

/**
 * A new shadow host: not editable (D17 — ProseMirror must not put a caret in it), a vim island
 * (`src/extensions/CLAUDE.md` requires the marker on a shadow-DOM NodeView's host; a `<button>`
 * in the result can hold focus, and vim must not read its keys as commands), and its own paint
 * containment as a defence behind the root's (`plugin-blocks.css`).
 */
export function createRenderedHost(): {
  host: HTMLElement;
  shadow: ShadowRoot;
} {
  const host = document.createElement("div");
  host.className = "plugin-block-host";
  host.setAttribute("contenteditable", "false");
  host.setAttribute("data-vim-suspend", "");
  return { host, shadow: host.attachShadow({ mode: "open" }) };
}

/**
 * Replace what `shadow` shows with `content`: a `<style>` holding its CSS (none when empty) and a
 * CLONE of its fragment — appending the fragment itself would empty it, and the cache draws one
 * result into every block that shares its key. The CSS goes in as text, never parsed as markup.
 */
export function drawRendered(
  shadow: ShadowRoot,
  content: DrawableContent,
): void {
  const nodes: Node[] = [];
  if (content.css !== "") {
    const style = document.createElement("style");
    style.textContent = content.css;
    nodes.push(style);
  }
  nodes.push(content.fragment.cloneNode(true));
  shadow.replaceChildren(...nodes);
}
