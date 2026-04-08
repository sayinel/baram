// §5.1 + §3.3 Syntax Reveal — expand functions (mark, link, image, wikilink)

import type { Mark, Node as PmNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

import { MARK_DELIMITERS, syntaxRevealKey } from "./syntax-reveal-state";

// ── Mark expansion ────────────────────────────────────────────────────

export function expandImage(view: EditorView, node: PmNode, pos: number): void {
  const src = (node.attrs.src as string) || "";
  const alt = (node.attrs.alt as string) || "";
  const title = node.attrs.title as null | string;

  const text = title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;

  const { tr } = view.state;

  // Image is block-level → replace with paragraph containing markdown text
  const textNode = view.state.schema.text(text);
  const para = view.state.schema.nodes.paragraph.create(null, textNode);
  tr.replaceWith(pos, pos + node.nodeSize, para);

  // Content starts at pos+1 (inside paragraph)
  const contentStart = pos + 1;
  // Place cursor right after "![" for natural alt-text editing
  const cursorPos = contentStart + 2;

  tr.setSelection(TextSelection.create(tr.doc, cursorPos));
  tr.setMeta(syntaxRevealKey, {
    expanded: {
      kind: "image",
      from: contentStart,
      to: contentStart + text.length,
      openCheck: "![",
    },
  });

  view.dispatch(tr);
}

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

  const openDelim = "[";
  const closeDelim = title ? `](${href} "${title}")` : `](${href})`;

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
    },
  });

  view.dispatch(tr);
}

// ── Image expansion ───────────────────────────────────────────────────

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

  view.dispatch(tr);
}
