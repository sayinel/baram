// §5.1 + §3.3 Syntax Reveal — expand functions (mark, link, image, wikilink)

import type { Mark, Node as PmNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

import {
  escapedLabelLength,
  serializeRevealResource,
} from "./syntax-reveal-resource-codec";
import {
  MARK_DELIMITERS,
  syntaxRevealKey,
  tagSyntaxRevealEphemeral,
} from "./syntax-reveal-state";

// ── Link expansion ────────────────────────────────────────────────────

export function expandLink(
  view: EditorView,
  mark: Mark,
  range: { from: number; to: number },
): void {
  const { state } = view;
  const href = (mark.attrs.href as string) || "";
  const title = mark.attrs.title as null | string;
  const cursorPos = state.selection.from;

  // §384 fix (B): stash every non-href/title attr (e.g. `target`) so both
  // collapse implementations can restore it — see ExpandedRange.linkAttrs.
  const linkAttrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mark.attrs)) {
    if (key === "href" || key === "title") continue;
    linkAttrs[key] = value;
  }

  const openDelim = "[";
  // §384 fix (B2): route the destination/title through the shared reveal
  // codec (angle-bracket form + escaping) so a destination containing
  // whitespace — e.g. href="a b" parsed from `[x](<a b>)` — round-trips
  // through collapse instead of being left as literal, uncollapsible text.
  // label is left empty and the leading "[" sliced off: the real label is
  // live doc text (kept, with its own marks, untouched) between openDelim
  // and closeDelim — not a plain string we serialize ourselves.
  const closeDelim = serializeRevealResource({
    kind: "link",
    label: "",
    destination: href,
    title,
  }).slice(1);

  const { tr } = state;

  tr.removeMark(range.from, range.to, state.schema.marks.link);
  tr.insert(range.to, state.schema.text(closeDelim));
  tr.insert(range.from, state.schema.text(openDelim));

  const newTo = range.to + openDelim.length + closeDelim.length;

  let newCursorPos: number;
  if (cursorPos <= range.from) {
    newCursorPos = range.from;
  } else if (cursorPos >= range.to) {
    newCursorPos = newTo;
  } else {
    newCursorPos = cursorPos + openDelim.length;
  }

  tr.setSelection(TextSelection.create(tr.doc, newCursorPos));
  tr.setMeta(syntaxRevealKey, {
    expanded: {
      kind: "link",
      from: range.from,
      to: newTo,
      openCheck: "[",
      linkAttrs,
      // §384 fix (F1 round 2): doc-absolute position of the `]` that opens
      // `](destination…)` — the label is the untouched, still-live
      // [range.from, range.to) content, now shifted right by openDelim's
      // insertion, so its close sits exactly one "[" past the original
      // range.to. See ExpandedRange.labelEnd.
      labelEnd: range.to + openDelim.length,
    },
  });
  tagSyntaxRevealEphemeral(tr);

  view.dispatch(tr);
}

// ── Mark expansion ────────────────────────────────────────────────────

export function expandMark(
  view: EditorView,
  mark: Mark,
  range: { from: number; to: number },
): void {
  const delim = MARK_DELIMITERS[mark.type.name];
  if (!delim) return;

  const { state } = view;
  const cursorPos = state.selection.from;
  const markType = state.schema.marks[mark.type.name];
  if (!markType) return;

  const { tr } = state;

  // Step 1: Remove mark from range
  tr.removeMark(range.from, range.to, markType);

  // Step 2: Insert close delimiter FIRST (keeps positions for step 3 stable)
  tr.insert(range.to, state.schema.text(delim.close));

  // Step 3: Insert open delimiter
  tr.insert(range.from, state.schema.text(delim.open));

  const newTo = range.to + delim.open.length + delim.close.length;

  // Cursor placement depends on which boundary triggered expansion:
  // - Left boundary: before opening delimiter  → |**hello**
  // - Right boundary: after closing delimiter  → **hello**|
  // - Inside: shift by opening delimiter length → **hel|lo**
  // checkCursorOut uses strict inequality so boundaries are inside the range.
  let newCursorPos: number;
  if (cursorPos <= range.from) {
    newCursorPos = range.from;
  } else if (cursorPos >= range.to) {
    newCursorPos = newTo;
  } else {
    newCursorPos = cursorPos + delim.open.length;
  }

  tr.setSelection(TextSelection.create(tr.doc, newCursorPos));
  tr.setMeta(syntaxRevealKey, {
    expanded: {
      kind: "mark",
      markName: mark.type.name,
      from: range.from,
      to: newTo,
      openCheck: delim.open,
      closeCheck: delim.close,
    },
  });
  tagSyntaxRevealEphemeral(tr);

  view.dispatch(tr);
}

// ── Media expansion (image/video, §295) ─────────────────────────────────

export function expandMediaAtom(
  view: EditorView,
  node: PmNode,
  pos: number,
): void {
  const src = (node.attrs.src as string) || "";
  const alt = (node.attrs.alt as string) || "";
  const title = node.attrs.title as null | string;

  // §384 fix (B2): route through the shared reveal codec — see expandLink.
  const text = serializeRevealResource({
    kind: "image",
    label: alt,
    destination: src,
    title,
  });

  const { tr } = view.state;

  // Media atoms are block-level → replace with paragraph containing markdown text
  const textNode = view.state.schema.text(text);
  const para = view.state.schema.nodes.paragraph.create(null, textNode);
  tr.replaceWith(pos, pos + node.nodeSize, para);

  // Content starts at pos+1 (inside paragraph)
  const contentStart = pos + 1;
  // Place cursor right after "![" for natural alt-text editing
  const cursorPos = contentStart + 2;

  // §294 fix (C1): `![alt](src)` cannot represent width — stash every attr
  // besides src/alt/title so collapse can restore it. Both image and video
  // atoms go through this path, and since §294's image-parity round BOTH also
  // carry widthPixel (this comment used to say only video did). Copying
  // whatever the node actually has — rather than naming widthPercent
  // specifically — is why that change needed nothing here: a schema/node-type
  // mismatch on collapse (image ↔
  // video, keyed off the edited src) still gets whichever fields the target
  // type reads and silently ignores the rest — see ExpandedRange.mediaAttrs.
  const mediaAttrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.attrs)) {
    if (key === "src" || key === "alt" || key === "title") continue;
    mediaAttrs[key] = value;
  }

  tr.setSelection(TextSelection.create(tr.doc, cursorPos));
  tr.setMeta(syntaxRevealKey, {
    expanded: {
      kind: "image",
      from: contentStart,
      to: contentStart + text.length,
      openCheck: "![",
      mediaAttrs,
      // §384 fix (F1 round 2): doc-absolute position of the `]` that opens
      // `](destination…)`. Unlike a link label, alt is written into `text`
      // literally (escaped, per serializeRevealResource) rather than kept as
      // live doc content — see ExpandedRange.labelEnd, escapedLabelLength.
      labelEnd: contentStart + 2 + escapedLabelLength(alt),
    },
  });
  tagSyntaxRevealEphemeral(tr);

  view.dispatch(tr);
}

// ── Wikilink expansion ────────────────────────────────────────────────

export function expandWikilink(
  view: EditorView,
  node: PmNode,
  pos: number,
  cursorAt: "back" | "front" = "front",
): void {
  const target = (node.attrs.target as string) || "";
  const heading = node.attrs.heading as null | string;
  const blockId = node.attrs.blockId as null | string;
  const display = node.attrs.display as null | string;
  const vaultAlias = node.attrs.vaultAlias as null | string;

  // §87 Build [[alias::target#heading^blockId|display]] text
  let inner = "";
  if (vaultAlias) inner += `${vaultAlias}::`;
  inner += target;
  if (heading) inner += `#${heading}`;
  if (blockId) inner += `^${blockId}`;
  if (display) inner += `|${display}`;
  const text = `[[${inner}]]`;

  const { tr } = view.state;

  // Wikilink is inline atom (nodeSize=1) — replace with text in same paragraph
  const textNode = view.state.schema.text(text);
  tr.replaceWith(pos, pos + node.nodeSize, textNode);

  // from = pos, to = pos + text.length
  const from = pos;
  const to = pos + text.length;
  // Place cursor based on entry direction
  const cursorPos = cursorAt === "back" ? to - 2 : pos + 2;

  tr.setSelection(TextSelection.create(tr.doc, cursorPos));
  tr.setMeta(syntaxRevealKey, {
    expanded: {
      kind: "wikilink",
      from,
      to,
      openCheck: "[[",
      closeCheck: "]]",
    },
  });
  tagSyntaxRevealEphemeral(tr);

  view.dispatch(tr);
}
