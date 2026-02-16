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
  kind: "mark" | "link" | "image";
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
    // Use strict < for right boundary: cursor exactly at range.to (mark end)
    // should NOT trigger expansion. This prevents the infinite cycle where
    // InputRule places cursor at mark boundary → expand → collapse → re-expand.
    if (cursorPos >= range.from && cursorPos < range.to) {
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
  const newCursorPos = cursorPos + delim.open.length;

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
  const newCursorPos = cursorPos + openDelim.length;

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

// ── Collapse expanded range ───────────────────────────────────────────

function collapseExpanded(
  view: EditorView,
  expanded: ExpandedRange,
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

  if (kind === "mark" && markName) {
    // ── Collapse mark ──
    const markType = state.schema.marks[markName];
    if (!markType || !closeCheck) {
      tr.setMeta(syntaxRevealKey, INACTIVE);
      view.dispatch(tr);
      return;
    }

    // Validate both delimiters
    try {
      const closeText = state.doc.textBetween(
        to - closeCheck.length,
        to,
      );
      if (closeText !== closeCheck) {
        // Delimiters modified → leave as plain text
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
    const contentLen = contentTo - contentFrom;

    if (contentLen <= 0) {
      // Empty → delete everything
      tr.delete(from, to);
    } else {
      // Get content preserving other marks
      const content = state.doc.slice(contentFrom, contentTo).content;
      tr.replaceWith(from, to, content);
      tr.addMark(from, from + contentLen, markType.create());
    }
  } else if (kind === "link") {
    // ── Collapse link ──
    const fullText = state.doc.textBetween(from, to);
    const linkMatch = fullText.match(
      /^\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/,
    );

    if (linkMatch) {
      const [, , href, title] = linkMatch;
      const bracketIdx = fullText.indexOf("](");

      if (bracketIdx >= 0) {
        const contentFrom = from + 1;
        const contentTo = from + bracketIdx;
        const contentLen = bracketIdx - 1;

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
      }
    }
  } else if (kind === "image") {
    // ── Collapse image ──
    const fullText = state.doc.textBetween(from, to);
    const imgMatch = fullText.match(
      /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/,
    );

    if (imgMatch) {
      const [, alt, src, title] = imgMatch;
      const imageNode = state.schema.nodes.image.create({
        src,
        alt: alt || null,
        title: title || null,
      });
      // Replace the entire paragraph (from-1 to to+1) with image block
      tr.replaceWith(from - 1, to + 1, imageNode);
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

        // Map positions through the transaction
        const from = tr.mapping.map(value.expanded.from, -1);
        const to = tr.mapping.map(value.expanded.to, 1);

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
      handleClick(view, pos, _event) {
        const es = syntaxRevealKey.getState(view.state);

        // Active + click outside range → collapse
        if (es?.expanded) {
          if (pos <= es.expanded.from || pos >= es.expanded.to) {
            collapseExpanded(view, es.expanded);
            return false;
          }
          return false;
        }

        // Click on image atom → expand
        const $pos = view.state.doc.resolve(pos);
        const nodeAfter = $pos.nodeAfter;
        if (nodeAfter && nodeAfter.type.name === "image") {
          expandImage(view, nodeAfter, pos);
          return true;
        }

        return false;
      },

      // ── Keyboard handling ───────────────────────────────────────
      handleKeyDown(view, event) {
        const es = syntaxRevealKey.getState(view.state);

        // ── Re-edit: character typed on NodeSelection of image ──
        if (!es?.expanded) {
          const { selection } = view.state;
          if (
            selection instanceof NodeSelection &&
            selection.node.type.name === "image"
          ) {
            if (event.key === "Backspace" || event.key === "Delete")
              return false;

            if (
              event.key.length === 1 &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey
            ) {
              if (pendingRaf) {
                cancelAnimationFrame(pendingRaf);
                pendingRaf = null;
              }
              expandImage(view, selection.node, selection.from);
              return true;
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

    // ── Plugin View (cursor-out detection + auto-expand) ──────────
    view() {
      function checkCursorOut(view: EditorView) {
        const es = syntaxRevealKey.getState(view.state);
        if (!es?.expanded) return;
        const { from } = view.state.selection;
        if (from <= es.expanded.from || from >= es.expanded.to) {
          collapseExpanded(view, es.expanded);
        }
      }

      function checkCursorInMark(view: EditorView) {
        const es = syntaxRevealKey.getState(view.state);
        if (es?.expanded) return;

        const { selection } = view.state;
        if (!(selection instanceof TextSelection)) return;

        const $pos = selection.$from;
        const parentNode = $pos.parent;
        if (!parentNode.isTextblock) return;
        const parentPos = $pos.before($pos.depth) + 1;
        const marks = $pos.marks();

        for (const mark of marks) {
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
        const marks = $pos.marks();
        const linkMark = marks.find((m) => m.type.name === "link");
        if (!linkMark) return;

        const parentNode = $pos.parent;
        if (!parentNode.isTextblock) return;
        const parentPos = $pos.before($pos.depth) + 1;

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
        if (
          selection instanceof NodeSelection &&
          selection.node.type.name === "image"
        ) {
          if (pendingRaf) cancelAnimationFrame(pendingRaf);

          pendingRaf = requestAnimationFrame(() => {
            pendingRaf = null;
            const { selection: sel } = view.state;
            if (
              !(sel instanceof NodeSelection) ||
              sel.node.type.name !== "image"
            )
              return;
            expandImage(view, sel.node, sel.from);
          });
        }
      }

      return {
        update(view: EditorView) {
          checkNodeSelection(view);

          const es = syntaxRevealKey.getState(view.state);
          if (es?.expanded) {
            checkCursorOut(view);
            return;
          }

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

/** Tiptap Extension wrapper */
export const SyntaxReveal = Extension.create({
  name: "syntaxReveal",

  addProseMirrorPlugins() {
    return [createSyntaxRevealPlugin()];
  },
});
