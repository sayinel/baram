// §5.12 HTML Export — turn same-document references (block refs, footnotes)
// into real, clickable/PDF-linkable anchors.

/**
 * A fragment-safe anchor name.
 *
 * ‼️ Both the `id` and the `href` are built from this one function, so they
 * cannot disagree. A block id is user-authored text — a space or a `#` in it
 * makes a raw `#block-my id` fragment point nowhere, and a space is not even
 * legal in an `id`. Encoding both sides keeps the link resolvable whatever the
 * author typed.
 */
function anchorFor(prefix: string, id: string): string {
  return `${prefix}-${encodeURIComponent(id)}`;
}

/**
 * Turn same-document references into real links.
 *
 * User report (2026-08-23): "블록참조 등 참조 링크 사라짐". They do not vanish —
 * the chip and the superscript number both print. What vanishes is the ABILITY
 * TO FOLLOW them: a block reference is navigated by a Cmd+click handler
 * (block-reference-view.tsx) and a footnote by an onClick, and an exported
 * document runs no JavaScript. So the reader sees a reference and cannot use
 * it. Chrome emits a PDF link annotation for a same-document anchor, so giving
 * the export the ids and hrefs the editor never needed makes both work.
 *
 * ‼️ Only same-document targets. A reference into another note (`data-target`
 * non-empty) has no destination inside a single exported file, and a footnote
 * reference whose definition was not exported has none either — those keep the
 * chip and stay unlinked. A link that resolves to nothing is not a lesser
 * version of a working link: it invites a click and silently does nothing,
 * which is the exact complaint §301 answered for local video.
 *
 * `isAuthoredMarkup` is injected rather than imported from export-html.ts: it
 * has to stay co-located there with the two code-block loops it keeps aligned
 * (see that file), and importing it back here would pull this module into a
 * cycle with the orchestrator for no benefit.
 */
export function linkInternalReferences(
  clone: HTMLElement,
  isAuthoredMarkup: (el: Element) => boolean,
): void {
  // ── Block references ──────────────────────────────────────────────
  // ‼️ `.block-reference` carries `data-block-id` too — it names the block it
  // POINTS AT. Without this guard every reference would also claim to BE its
  // own target, and `#block-intro` would resolve to the chip rather than to
  // the paragraph.
  const blockTargets = new Set<string>();
  for (const el of clone.querySelectorAll("[data-block-id]")) {
    if (el.classList.contains("block-reference")) continue;
    // An author can write `data-block-id` in a raw HTML block; that is their
    // markup, not a Baram block id, and minting an anchor on it would let it
    // shadow a real target.
    if (isAuthoredMarkup(el)) continue;
    const id = el.getAttribute("data-block-id");
    // First wins: a duplicate id in the document would make the anchor
    // ambiguous, and the earlier block is the one the reader reaches by
    // reading forward.
    if (!id || blockTargets.has(id)) continue;
    blockTargets.add(id);
    el.setAttribute("id", anchorFor("block", id));
  }
  for (const el of clone.querySelectorAll(".block-reference")) {
    const id = el.getAttribute("data-block-id");
    const target = el.getAttribute("data-target");
    if (!id || target || !blockTargets.has(id)) continue;
    retag(el, "a").setAttribute("href", `#${anchorFor("block", id)}`);
  }

  // ── Footnotes, in both directions ─────────────────────────────────
  const definitions = new Set<string>();
  for (const el of clone.querySelectorAll(
    ".footnote-definition[data-identifier]",
  )) {
    const id = el.getAttribute("data-identifier");
    if (!id || definitions.has(id)) continue;
    definitions.add(id);
    el.setAttribute("id", anchorFor("fn", id));
  }

  const firstRef = new Set<string>();
  for (const el of clone.querySelectorAll(".footnote-ref[data-identifier]")) {
    const id = el.getAttribute("data-identifier");
    if (!id || !definitions.has(id)) continue;
    const link = retag(el, "a");
    link.setAttribute("href", `#${anchorFor("fn", id)}`);
    // The back-link needs somewhere to land, and only the FIRST occurrence can
    // own the id — the same note may be referenced several times.
    if (!firstRef.has(id)) {
      firstRef.add(id);
      link.setAttribute("id", anchorFor("fnref", id));
    }
  }

  for (const el of clone.querySelectorAll(
    ".footnote-definition[data-identifier]",
  )) {
    const id = el.getAttribute("data-identifier");
    const label = el.querySelector(".footnote-definition-label");
    if (!id || !label || !firstRef.has(id)) continue;
    retag(label, "a").setAttribute("href", `#${anchorFor("fnref", id)}`);
  }
}

/** Replace `el` with the same content and attributes under a different tag. */
export function retag(el: Element, tagName: string): HTMLElement {
  const next = document.createElement(tagName);
  for (const attr of Array.from(el.attributes)) {
    next.setAttribute(attr.name, attr.value);
  }
  next.append(...el.childNodes);
  el.replaceWith(next);
  return next;
}
