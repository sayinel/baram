// §5.1 + §3.3 Syntax Reveal — Typora-style focus-based syntax exposure
// Expansion-based: When cursor enters a mark/link/image range, the markdown
// delimiters are inserted as real editable text. When cursor leaves, they
// collapse back to marks/nodes. Follows the math-inline-edit pattern (§5.3).
import { Extension } from "@tiptap/core";
import {
  Plugin,
  PluginKey,
  TextSelection,
  NodeSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PmNode, Mark } from "@tiptap/pm/model";

// ── Plugin state ──────────────────────────────────────────────────────

interface ExpandedRange {
  kind: "mark" | "link" | "image" | "wikilink";
  markName?: string; // for marks: "bold", "italic", etc.
  from: number; // start of expanded text (for images: inside paragraph)
  to: number; // end of expanded text
  openCheck: string; // opening delimiter to validate
  closeCheck?: string; // closing delimiter to validate (marks only)
}

interface SyntaxRevealState {
  expanded: ExpandedRange | null;
}

const INACTIVE: SyntaxRevealState = { expanded: null };
const syntaxRevealKey = new PluginKey<SyntaxRevealState>("syntaxReveal");

// ── Mark delimiter definitions ────────────────────────────────────────

const MARK_DELIMITERS: Record<string, { open: string; close: string }> = {
  bold: { open: "**", close: "**" },
  italic: { open: "*", close: "*" },
  strike: { open: "~~", close: "~~" },
  code: { open: "`", close: "`" },
  underline: { open: "<u>", close: "</u>" },
};

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Compute the content length (text between delimiters) of an expanded range.
 */
function computeContentLen(state: EditorState, expanded: ExpandedRange): number {
  const { from, to, kind, openCheck, closeCheck } = expanded;
  if (kind === "mark" && closeCheck) {
    return (to - closeCheck.length) - (from + openCheck.length);
  }
  if (kind === "link") {
    try {
      const fullText = state.doc.textBetween(from, to);
      const bracketIdx = fullText.indexOf("](");
      return bracketIdx >= 0 ? bracketIdx - 1 : 0;
    } catch {
      return 0;
    }
  }
  if (kind === "wikilink") {
    // Wikilink atom node = 1 position when collapsed
    return 0;
  }
  return 0;
}

/**
 * Find the contiguous range of a specific mark that contains the cursor.
 */
function findMarkRange(
  parentNode: PmNode,
  parentPos: number,
  markType: string,
  cursorPos: number,
): { from: number; to: number } | null {
  const ranges: { from: number; to: number }[] = [];

  parentNode.forEach((child, childOffset) => {
    const childFrom = parentPos + childOffset;
    const childTo = childFrom + child.nodeSize;
    if (child.marks.some((m) => m.type.name === markType)) {
      const last = ranges[ranges.length - 1];
      if (last && last.to === childFrom) {
        last.to = childTo;
      } else {
        ranges.push({ from: childFrom, to: childTo });
      }
    }
  });

  for (const range of ranges) {
    if (cursorPos >= range.from && cursorPos <= range.to) {
      return range;
    }
  }
  return null;
}

// ── Mark expansion ────────────────────────────────────────────────────

function expandMark(
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

// ── Link expansion ────────────────────────────────────────────────────

function expandLink(
  view: EditorView,
  mark: Mark,
  range: { from: number; to: number },
): void {
  const { state } = view;
  const href = (mark.attrs.href as string) || "";
  const title = mark.attrs.title as string | null;
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

function expandImage(
  view: EditorView,
  node: PmNode,
  pos: number,
): void {
  const src = (node.attrs.src as string) || "";
  const alt = (node.attrs.alt as string) || "";
  const title = node.attrs.title as string | null;

  const text = title
    ? `![${alt}](${src} "${title}")`
    : `![${alt}](${src})`;

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

// ── Wikilink expansion ───────────────────────────────────────────────

function expandWikilink(
  view: EditorView,
  node: PmNode,
  pos: number,
  cursorAt: "front" | "back" = "front",
): void {
  const target = (node.attrs.target as string) || "";
  const heading = node.attrs.heading as string | null;
  const blockId = node.attrs.blockId as string | null;
  const display = node.attrs.display as string | null;

  // Build [[target#heading^blockId|display]] text
  let inner = target;
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

// Regex to parse expanded wikilink text: [[target#heading^blockId|display]]
const WIKILINK_REGEX =
  /^\[\[([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]$/;

// ── Collapse expanded range ───────────────────────────────────────────

/**
 * Collapse expanded delimiters back to marks/nodes.
 * @param cursorTarget — if provided, place cursor here in the collapsed doc.
 *   Otherwise ProseMirror's default position mapping through the replace steps
 *   determines the final cursor position.
 */
function collapseExpanded(
  view: EditorView,
  expanded: ExpandedRange,
  cursorTarget?: number,
): void {
  const { state } = view;
  const { tr } = state;
  const { from, to, kind, openCheck, closeCheck, markName } = expanded;

  // Validate open delimiter still exists
  try {
    const openText = state.doc.textBetween(from, from + openCheck.length);
    if (openText !== openCheck) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }
  } catch {
    tr.setMeta(syntaxRevealKey, INACTIVE);
    view.dispatch(tr);
    return;
  }

  let contentLen = 0;

  if (kind === "mark" && markName) {
    const markType = state.schema.marks[markName];
    if (!markType || !closeCheck) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    try {
      const closeText = state.doc.textBetween(to - closeCheck.length, to);
      if (closeText !== closeCheck) {
        tr.setMeta(syntaxRevealKey, INACTIVE);
        view.dispatch(tr);
        return;
      }
    } catch {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    const contentFrom = from + openCheck.length;
    const contentTo = to - closeCheck.length;
    contentLen = contentTo - contentFrom;

    if (contentLen <= 0) {
      tr.delete(from, to);
    } else {
      const content = state.doc.slice(contentFrom, contentTo).content;
      tr.replaceWith(from, to, content);
      tr.addMark(from, from + contentLen, markType.create());
    }
  } else if (kind === "link") {
    const fullText = state.doc.textBetween(from, to);
    const linkMatch = fullText.match(
      /^\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/,
    );
    if (!linkMatch) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    const [, , href, title] = linkMatch;
    const bracketIdx = fullText.indexOf("](");
    if (bracketIdx < 0) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    const contentFrom = from + 1;
    const contentTo = from + bracketIdx;
    contentLen = bracketIdx - 1;

    const linkMark = state.schema.marks.link.create({
      href,
      title: title || null,
    });

    if (contentLen <= 0) {
      tr.delete(from, to);
    } else {
      const content = state.doc.slice(contentFrom, contentTo).content;
      tr.replaceWith(from, to, content);
      tr.addMark(from, from + contentLen, linkMark);
    }
  } else if (kind === "image") {
    const fullText = state.doc.textBetween(from, to);
    const imgMatch = fullText.match(
      /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/,
    );
    if (!imgMatch) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    const [, alt, src, title] = imgMatch;
    const imageNode = state.schema.nodes.image.create({
      src,
      alt: alt || null,
      title: title || null,
    });
    const imgFrom = from - 1;
    const imgTo = to + 1;
    tr.replaceWith(imgFrom, imgTo, imageNode);
  } else if (kind === "wikilink") {
    const fullText = state.doc.textBetween(from, to);
    const wlMatch = fullText.match(WIKILINK_REGEX);
    if (!wlMatch) {
      // Invalid syntax — just deactivate, keep as text (lenient)
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    const [, wlTarget, wlHeading, wlBlockId, wlDisplay] = wlMatch;
    const wikilinkNode = state.schema.nodes.wikilink.create({
      target: wlTarget,
      heading: wlHeading || null,
      blockId: wlBlockId || null,
      display: wlDisplay || null,
    });
    tr.replaceWith(from, to, wikilinkNode);
    contentLen = 0; // atom node = 1 position after collapse
  }

  // Set explicit cursor position if requested
  if (cursorTarget !== undefined) {
    try {
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          Math.max(0, Math.min(cursorTarget, tr.doc.content.size)),
        ),
      );
    } catch {
      // fallback: let ProseMirror's default mapping handle it
    }
  }

  tr.setMeta(syntaxRevealKey, INACTIVE);
  view.dispatch(tr);
}

// ── Build delimiter decorations for expanded range ────────────────────

function buildExpandedDecorations(
  state: EditorState,
  expanded: ExpandedRange,
): Decoration[] {
  const { from, to, kind, openCheck, closeCheck } = expanded;
  const decos: Decoration[] = [];

  try {
    if (kind === "mark" && closeCheck) {
      // Style opening delimiter
      decos.push(
        Decoration.inline(from, from + openCheck.length, {
          class: "syntax-delimiter-inline",
        }),
      );
      // Style closing delimiter
      decos.push(
        Decoration.inline(to - closeCheck.length, to, {
          class: "syntax-delimiter-inline",
        }),
      );
    } else if (kind === "link" || kind === "image") {
      const text = state.doc.textBetween(from, to);
      const closeBracket = text.indexOf("](");
      const openLen = kind === "image" ? 2 : 1;

      if (closeBracket >= 0) {
        // Style opening delimiter
        decos.push(
          Decoration.inline(from, from + openLen, {
            class: "syntax-delimiter-inline",
          }),
        );
        // Style "](url)" portion
        decos.push(
          Decoration.inline(from + closeBracket, to, {
            class: "syntax-delimiter-inline",
          }),
        );
      }
    } else if (kind === "wikilink" && closeCheck) {
      // Style [[ and ]]
      decos.push(
        Decoration.inline(from, from + openCheck.length, {
          class: "syntax-delimiter-inline",
        }),
      );
      decos.push(
        Decoration.inline(to - closeCheck.length, to, {
          class: "syntax-delimiter-inline",
        }),
      );
    }
  } catch {
    // Position out of range, skip
  }

  return decos;
}

// ── Plugin factory ────────────────────────────────────────────────────

function createSyntaxRevealPlugin(): Plugin<SyntaxRevealState> {
  let pendingRaf: number | null = null;

  return new Plugin<SyntaxRevealState>({
    key: syntaxRevealKey,

    // ── State management ────────────────────────────────────────────
    state: {
      init(): SyntaxRevealState {
        return INACTIVE;
      },

      apply(
        tr: Transaction,
        value: SyntaxRevealState,
        _old: EditorState,
        newState: EditorState,
      ): SyntaxRevealState {
        const meta = tr.getMeta(syntaxRevealKey) as
          | SyntaxRevealState
          | undefined;
        if (meta !== undefined) return meta;
        if (!value.expanded) return value;

        // Map positions through the transaction.
        // Bias 1 for from: inserts AT from push it right (typing at left boundary).
        // Bias -1 for to: inserts AT to don't grow the range (typing at right boundary).
        const from = tr.mapping.map(value.expanded.from, 1);
        const to = tr.mapping.map(value.expanded.to, -1);

        // Validate open delimiter
        try {
          const openText = newState.doc.textBetween(
            from,
            from + value.expanded.openCheck.length,
          );
          if (openText !== value.expanded.openCheck) return INACTIVE;
        } catch {
          return INACTIVE;
        }

        // For marks, also validate close delimiter
        if (value.expanded.closeCheck) {
          try {
            const closeText = newState.doc.textBetween(
              to - value.expanded.closeCheck.length,
              to,
            );
            if (closeText !== value.expanded.closeCheck) return INACTIVE;
          } catch {
            return INACTIVE;
          }
        }

        return {
          expanded: { ...value.expanded, from, to },
        };
      },
    },

    // ── appendTransaction: cursor-out collapse ───────────────────────
    // Using appendTransaction instead of dispatching from view.update()
    // ensures collapse is batched with the cursor-move transaction into
    // a single DOM render, preventing visual cursor jumps.
    appendTransaction(_transactions, _oldState, newState) {
      const es = syntaxRevealKey.getState(newState);
      if (!es?.expanded) return null;

      const cursorPos = newState.selection.from;
      // Strict inequality: cursor AT boundary stays expanded
      if (cursorPos >= es.expanded.from && cursorPos <= es.expanded.to) {
        return null;
      }

      // Cursor moved outside → build collapse transaction with explicit cursor
      const { from, to, kind, openCheck, closeCheck, markName } = es.expanded;
      const tr = newState.tr;

      // Validate open delimiter
      try {
        const openText = newState.doc.textBetween(from, from + openCheck.length);
        if (openText !== openCheck) {
          tr.setMeta(syntaxRevealKey, INACTIVE);
          return tr;
        }
      } catch {
        tr.setMeta(syntaxRevealKey, INACTIVE);
        return tr;
      }

      // Compute content length for cursor mapping
      let contentLen = 0;
      if (kind === "mark" && markName && closeCheck) {
        const markType = newState.schema.marks[markName];
        if (!markType) { tr.setMeta(syntaxRevealKey, INACTIVE); return tr; }

        try {
          const closeText = newState.doc.textBetween(to - closeCheck.length, to);
          if (closeText !== closeCheck) { tr.setMeta(syntaxRevealKey, INACTIVE); return tr; }
        } catch { tr.setMeta(syntaxRevealKey, INACTIVE); return tr; }

        const contentFrom = from + openCheck.length;
        const contentTo = to - closeCheck.length;
        contentLen = contentTo - contentFrom;

        if (contentLen <= 0) {
          tr.delete(from, to);
        } else {
          const content = newState.doc.slice(contentFrom, contentTo).content;
          tr.replaceWith(from, to, content);
          tr.addMark(from, from + contentLen, markType.create());
        }
      } else if (kind === "link") {
        const fullText = newState.doc.textBetween(from, to);
        const linkMatch = fullText.match(
          /^\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/,
        );
        if (!linkMatch) { tr.setMeta(syntaxRevealKey, INACTIVE); return tr; }

        const [, , href, title] = linkMatch;
        const bracketIdx = fullText.indexOf("](");
        if (bracketIdx < 0) { tr.setMeta(syntaxRevealKey, INACTIVE); return tr; }

        contentLen = bracketIdx - 1;
        const linkMark = newState.schema.marks.link.create({
          href, title: title || null,
        });

        if (contentLen <= 0) {
          tr.delete(from, to);
        } else {
          const content = newState.doc.slice(from + 1, from + bracketIdx).content;
          tr.replaceWith(from, to, content);
          tr.addMark(from, from + contentLen, linkMark);
        }
      } else if (kind === "image") {
        const fullText = newState.doc.textBetween(from, to);
        const imgMatch = fullText.match(
          /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/,
        );
        if (!imgMatch) { tr.setMeta(syntaxRevealKey, INACTIVE); return tr; }

        const [, alt, src, title2] = imgMatch;
        const imageNode = newState.schema.nodes.image.create({
          src, alt: alt || null, title: title2 || null,
        });
        tr.replaceWith(from - 1, to + 1, imageNode);
      } else if (kind === "wikilink") {
        const fullText = newState.doc.textBetween(from, to);
        const wlMatch = fullText.match(WIKILINK_REGEX);
        if (!wlMatch) { tr.setMeta(syntaxRevealKey, INACTIVE); return tr; }

        const [, wlTarget, wlHeading, wlBlockId, wlDisplay] = wlMatch;
        const wikilinkNode = newState.schema.nodes.wikilink.create({
          target: wlTarget,
          heading: wlHeading || null,
          blockId: wlBlockId || null,
          display: wlDisplay || null,
        });
        tr.replaceWith(from, to, wikilinkNode);
        contentLen = 0;
      }

      // Map cursor through the collapse operations (handles all kinds correctly,
      // including image where replaceWith spans from-1..to+1 for paragraph wrapper)
      try {
        const mapped = tr.mapping.map(cursorPos);
        const clamped = Math.max(0, Math.min(mapped, tr.doc.content.size));
        tr.setSelection(TextSelection.create(tr.doc, clamped));
      } catch {
        // fallback: let ProseMirror's default mapping handle it
      }

      tr.setMeta(syntaxRevealKey, INACTIVE);
      return tr;
    },

    // ── Props ────────────────────────────────────────────────────────
    props: {
      decorations(state) {
        const es = syntaxRevealKey.getState(state);
        if (!es?.expanded) return DecorationSet.empty;

        const decos = buildExpandedDecorations(state, es.expanded);
        if (decos.length === 0) return DecorationSet.empty;

        return DecorationSet.create(state.doc, decos);
      },

      // ── Click handling ──────────────────────────────────────────
      handleClick(view, pos, event) {
        const es = syntaxRevealKey.getState(view.state);

        // Active: let appendTransaction handle collapse if cursor outside
        if (es?.expanded) {
          return false;
        }

        const $pos = view.state.doc.resolve(pos);
        const nodeAfter = $pos.nodeAfter;

        // Click on image atom → expand to editable markdown
        if (nodeAfter && nodeAfter.type.name === "image") {
          expandImage(view, nodeAfter, pos);
          return true;
        }

        // Click on wikilink atom → expand (but not Cmd+Click which navigates)
        if (
          nodeAfter &&
          nodeAfter.type.name === "wikilink" &&
          !event.metaKey &&
          !event.ctrlKey
        ) {
          expandWikilink(view, nodeAfter, pos);
          return true;
        }

        return false;
      },

      // ── Keyboard handling ───────────────────────────────────────
      handleKeyDown(view, event) {
        const es = syntaxRevealKey.getState(view.state);

        // ── Re-edit: Enter or character typed on NodeSelection of image or wikilink ──
        if (!es?.expanded) {
          const { selection } = view.state;
          if (selection instanceof NodeSelection) {
            const nodeName = selection.node.type.name;
            if (nodeName === "image" || nodeName === "wikilink") {
              if (event.key === "Backspace" || event.key === "Delete")
                return false;

              // Enter or printable character → expand to markdown for editing
              const isEnter = event.key === "Enter";
              const isPrintable =
                event.key.length === 1 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey;

              if (isEnter || isPrintable) {
                if (isEnter) event.preventDefault();
                if (pendingRaf) {
                  cancelAnimationFrame(pendingRaf);
                  pendingRaf = null;
                }
                if (nodeName === "image") {
                  expandImage(view, selection.node, selection.from);
                } else {
                  expandWikilink(view, selection.node, selection.from);
                }
                return true;
              }
            }
          }
          return false;
        }

        // ── Active expanded mode ──────────────────────────────────

        // Enter / Escape → collapse
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          collapseExpanded(view, es.expanded);
          return true;
        }

        // ArrowRight at right boundary → collapse + advance cursor past mark
        if (
          event.key === "ArrowRight" &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          const selFrom = view.state.selection.from;
          if (selFrom === es.expanded.to) {
            event.preventDefault();
            const cLen = computeContentLen(view.state, es.expanded);
            // After collapse, mark occupies [from, from+cLen].
            // ArrowRight → one position past the mark end.
            collapseExpanded(view, es.expanded, es.expanded.from + cLen + 1);
            return true;
          }
        }

        // ArrowLeft at left boundary → collapse + retreat cursor before mark
        if (
          event.key === "ArrowLeft" &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          const selFrom = view.state.selection.from;
          if (selFrom === es.expanded.from) {
            event.preventDefault();
            // After collapse, mark starts at from. One position before = from - 1.
            collapseExpanded(
              view,
              es.expanded,
              Math.max(0, es.expanded.from - 1),
            );
            return true;
          }
        }

        // Backspace at opening delimiter → delete entire expanded content
        if (event.key === "Backspace") {
          const { from: selFrom } = view.state.selection;
          const delimLen = es.expanded.openCheck.length;
          if (selFrom === es.expanded.from + delimLen) {
            event.preventDefault();
            const { tr } = view.state;
            if (es.expanded.kind === "image") {
              // Delete the wrapping paragraph
              tr.delete(es.expanded.from - 1, es.expanded.to + 1);
            } else {
              tr.delete(es.expanded.from, es.expanded.to);
            }
            tr.setMeta(syntaxRevealKey, INACTIVE);
            view.dispatch(tr);
            return true;
          }
        }

        return false;
      },
    },

    // ── Plugin View (auto-expand on cursor entering mark/link) ────
    view() {
      function checkCursorInMark(view: EditorView) {
        const es = syntaxRevealKey.getState(view.state);
        if (es?.expanded) return;

        const { selection } = view.state;
        if (!(selection instanceof TextSelection)) return;

        const $pos = selection.$from;
        const parentNode = $pos.parent;
        if (!parentNode.isTextblock) return;
        const parentPos = $pos.before($pos.depth) + 1;

        // Collect marks: $pos.marks() covers inside + right boundary.
        // At left boundary (textOffset=0), $pos.marks() uses the node BEFORE
        // cursor, which lacks the mark. Also check nodeAfter's marks.
        const marks = $pos.marks();
        const allMarks: Mark[] = [...marks];

        if ($pos.textOffset === 0) {
          const nodeAfter = parentNode.maybeChild($pos.index($pos.depth));
          if (nodeAfter) {
            for (const m of nodeAfter.marks) {
              if (!allMarks.some((existing) => existing.eq(m))) {
                allMarks.push(m);
              }
            }
          }
        }

        for (const mark of allMarks) {
          const delim = MARK_DELIMITERS[mark.type.name];
          if (!delim) continue;

          const range = findMarkRange(
            parentNode,
            parentPos,
            mark.type.name,
            selection.from,
          );
          if (!range) continue;

          expandMark(view, mark, range);
          return; // Only expand one at a time
        }
      }

      function checkCursorInLink(view: EditorView) {
        const es = syntaxRevealKey.getState(view.state);
        if (es?.expanded) return;

        const { selection } = view.state;
        if (!(selection instanceof TextSelection)) return;

        const $pos = selection.$from;
        const parentNode = $pos.parent;
        if (!parentNode.isTextblock) return;
        const parentPos = $pos.before($pos.depth) + 1;

        // Check $pos.marks() + nodeAfter marks for left boundary
        const marks = $pos.marks();
        let linkMark = marks.find((m) => m.type.name === "link");

        if (!linkMark && $pos.textOffset === 0) {
          const nodeAfter = parentNode.maybeChild($pos.index($pos.depth));
          if (nodeAfter) {
            linkMark = nodeAfter.marks.find((m) => m.type.name === "link");
          }
        }

        if (!linkMark) return;

        const range = findMarkRange(
          parentNode,
          parentPos,
          "link",
          selection.from,
        );
        if (!range) return;

        expandLink(view, linkMark, range);
      }

      function checkNodeSelection(view: EditorView) {
        const es = syntaxRevealKey.getState(view.state);
        if (es?.expanded) return;

        const { selection } = view.state;
        if (selection instanceof NodeSelection) {
          const nodeName = selection.node.type.name;
          if (nodeName === "image" || nodeName === "wikilink") {
            if (pendingRaf) cancelAnimationFrame(pendingRaf);

            pendingRaf = requestAnimationFrame(() => {
              pendingRaf = null;
              const { selection: sel } = view.state;
              if (!(sel instanceof NodeSelection)) return;
              if (sel.node.type.name === "image") {
                expandImage(view, sel.node, sel.from);
              } else if (sel.node.type.name === "wikilink") {
                expandWikilink(view, sel.node, sel.from);
              }
            });
          }
        }
      }

      function checkCursorAdjacentToWikilink(view: EditorView) {
        const es = syntaxRevealKey.getState(view.state);
        if (es?.expanded) return;

        const { selection } = view.state;
        if (!(selection instanceof TextSelection)) return;

        const $pos = selection.$from;
        // Check nodeAfter (cursor before wikilink → entering from left)
        if ($pos.nodeAfter?.type.name === "wikilink") {
          expandWikilink(view, $pos.nodeAfter, $pos.pos, "front");
          return;
        }
        // Check nodeBefore (cursor after wikilink → entering from right)
        if ($pos.nodeBefore?.type.name === "wikilink") {
          const wikilinkPos = $pos.pos - $pos.nodeBefore.nodeSize;
          expandWikilink(view, $pos.nodeBefore, wikilinkPos, "back");
        }
      }

      // Track cursor position at last doc change to prevent
      // InputRule/collapse → cursor at mark boundary → immediate re-expand.
      // Expansion is only allowed after the cursor MOVES from this position.
      let cursorAtDocChange: number | null = null;

      return {
        update(view: EditorView, prevState: EditorState) {
          const es = syntaxRevealKey.getState(view.state);
          // If expanded, appendTransaction handles cursor-out collapse.
          if (es?.expanded) return;

          // On doc change, remember cursor position and skip ALL expansion.
          // This prevents InputRule → image node → immediate re-expand cycle
          // (e.g. typing ![text](url) creates image, then SyntaxReveal would
          // immediately expand it back to text with cursor at ![).
          if (view.state.doc !== prevState.doc) {
            cursorAtDocChange = view.state.selection.from;
            return;
          }

          // Skip expansion until cursor moves from the doc-change position
          if (cursorAtDocChange !== null) {
            if (view.state.selection.from === cursorAtDocChange) {
              return;
            }
            cursorAtDocChange = null;
          }

          // Check for node selection (image/wikilink click/arrow-key navigation)
          checkNodeSelection(view);

          // Check cursor adjacent to wikilink
          checkCursorAdjacentToWikilink(view);
          if (syntaxRevealKey.getState(view.state)?.expanded) return;

          // Try link first, then mark
          checkCursorInLink(view);
          if (syntaxRevealKey.getState(view.state)?.expanded) return;

          checkCursorInMark(view);
        },
        destroy() {
          if (pendingRaf) cancelAnimationFrame(pendingRaf);
        },
      };
    },
  });
}

/** Check if SyntaxReveal has an active expansion (used by other plugins to avoid conflicts). */
export function isSyntaxRevealExpanded(state: EditorState): boolean {
  const es = syntaxRevealKey.getState(state);
  return !!es?.expanded;
}

/** Get the active expanded range info (used by wikilink-suggest to replace entire expanded text). */
export function getSyntaxRevealExpanded(state: EditorState): ExpandedRange | null {
  const es = syntaxRevealKey.getState(state);
  return es?.expanded ?? null;
}

/** Get the SyntaxReveal PluginKey (used by other plugins to clear expansion state via meta). */
export { syntaxRevealKey };

/** Force-collapse any active expansion. Call before source mode toggle. */
export function forceCollapseSyntaxReveal(view: EditorView): void {
  const es = syntaxRevealKey.getState(view.state);
  if (!es?.expanded) return;
  collapseExpanded(view, es.expanded);
}

/** Tiptap Extension wrapper */
export const SyntaxReveal = Extension.create({
  name: "syntaxReveal",

  addProseMirrorPlugins() {
    return [createSyntaxRevealPlugin()];
  },
});
