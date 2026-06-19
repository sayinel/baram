import type { Mark } from "@tiptap/pm/model";

// §5.1 + §3.3 Syntax Reveal — Typora-style focus-based syntax exposure
// Expansion-based: When cursor enters a mark/link/image range, the markdown
// delimiters are inserted as real editable text. When cursor leaves, they
// collapse back to marks/nodes. Follows the math-inline-edit pattern (§5.3).
import { Extension } from "@tiptap/core";
import {
  type EditorState,
  NodeSelection,
  Plugin,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { DecorationSet, type EditorView } from "@tiptap/pm/view";

import { collapseExpanded } from "./syntax-reveal-collapse";
import { buildExpandedDecorations } from "./syntax-reveal-decorations";
import {
  expandImage,
  expandLink,
  expandMark,
  expandWikilink,
} from "./syntax-reveal-expand";
import {
  computeContentLen,
  type ExpandedRange,
  findMarkRange,
  INACTIVE,
  MARK_DELIMITERS,
  syntaxRevealKey,
  type SyntaxRevealState,
} from "./syntax-reveal-state";

// ── Public API re-exports ─────────────────────────────────────────────

/** Get the SyntaxReveal PluginKey (used by other plugins to clear expansion state via meta). */
export { syntaxRevealKey };

/** Force-collapse any active expansion. Call before source mode toggle. */
export function forceCollapseSyntaxReveal(view: EditorView): void {
  const es = syntaxRevealKey.getState(view.state);
  if (!es?.expanded) return;
  const exp = es.expanded;

  // Preserve the caret's logical position through the collapse. Without an
  // explicit target, ProseMirror's default mapping for `replaceWith(from, to,
  // content)` pushes a caret that sits inside the expanded range to the END of
  // the collapsed mark — which surfaced as the cursor drifting to after a bold
  // word on source-mode toggle. Map the caret from the expanded delimiter text
  // back onto the collapsed content for marks (other kinds collapse to atoms
  // where the default mapping is already correct).
  let cursorTarget: number | undefined;
  if (exp.kind === "mark" && exp.closeCheck) {
    const contentFrom = exp.from + exp.openCheck.length;
    const contentTo = exp.to - exp.closeCheck.length;
    const contentLen = Math.max(0, contentTo - contentFrom);
    const caret = view.state.selection.from;
    if (caret <= contentFrom) {
      cursorTarget = exp.from; // at/before opening delimiter → mark start
    } else if (caret >= contentTo) {
      cursorTarget = exp.from + contentLen; // at/after closing delimiter → mark end
    } else {
      cursorTarget = exp.from + (caret - contentFrom); // inside → preserve offset
    }
  }

  collapseExpanded(view, exp, cursorTarget);
}

/** Get the active expanded range info (used by wikilink-suggest to replace entire expanded text). */
export function getSyntaxRevealExpanded(
  state: EditorState,
): ExpandedRange | null {
  const es = syntaxRevealKey.getState(state);
  return es?.expanded ?? null;
}

// ── Plugin factory ────────────────────────────────────────────────────

function createSyntaxRevealPlugin(): Plugin<SyntaxRevealState> {
  let pendingRaf: null | number = null;

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
        const openText = newState.doc.textBetween(
          from,
          from + openCheck.length,
        );
        if (openText !== openCheck) {
          tr.setMeta(syntaxRevealKey, INACTIVE);
          return tr;
        }
      } catch {
        tr.setMeta(syntaxRevealKey, INACTIVE);
        return tr;
      }

      if (kind === "mark" && markName && closeCheck) {
        const markType = newState.schema.marks[markName];
        if (!markType) {
          tr.setMeta(syntaxRevealKey, INACTIVE);
          return tr;
        }

        try {
          const closeText = newState.doc.textBetween(
            to - closeCheck.length,
            to,
          );
          if (closeText !== closeCheck) {
            tr.setMeta(syntaxRevealKey, INACTIVE);
            return tr;
          }
        } catch {
          tr.setMeta(syntaxRevealKey, INACTIVE);
          return tr;
        }

        const contentFrom = from + openCheck.length;
        const contentTo = to - closeCheck.length;
        const contentLen = contentTo - contentFrom;

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
        if (!linkMatch) {
          tr.setMeta(syntaxRevealKey, INACTIVE);
          return tr;
        }

        const [, , href, title] = linkMatch;
        const bracketIdx = fullText.indexOf("](");
        if (bracketIdx < 0) {
          tr.setMeta(syntaxRevealKey, INACTIVE);
          return tr;
        }

        const contentLen = bracketIdx - 1;
        const linkMark = newState.schema.marks.link.create({
          href,
          title: title || null,
        });

        if (contentLen <= 0) {
          tr.delete(from, to);
        } else {
          const content = newState.doc.slice(
            from + 1,
            from + bracketIdx,
          ).content;
          tr.replaceWith(from, to, content);
          tr.addMark(from, from + contentLen, linkMark);
        }
      } else if (kind === "image") {
        const fullText = newState.doc.textBetween(from, to);
        const imgMatch = fullText.match(
          /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/,
        );
        if (!imgMatch) {
          tr.setMeta(syntaxRevealKey, INACTIVE);
          return tr;
        }

        const [, alt, src, title2] = imgMatch;
        const imageNode = newState.schema.nodes.image.create({
          src,
          alt: alt || null,
          title: title2 || null,
        });
        tr.replaceWith(from - 1, to + 1, imageNode);
      } else if (kind === "wikilink") {
        const fullText = newState.doc.textBetween(from, to);
        // §87 Regex includes optional alias:: prefix for cross-vault wikilinks
        const wlMatch = fullText.match(
          /^\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]$/,
        );
        if (!wlMatch) {
          tr.setMeta(syntaxRevealKey, INACTIVE);
          return tr;
        }

        const [, wlAlias, wlTarget, wlHeading, wlBlockId, wlDisplay] = wlMatch;
        const wikilinkNode = newState.schema.nodes.wikilink.create({
          target: wlTarget,
          heading: wlHeading || null,
          blockId: wlBlockId || null,
          display: wlDisplay || null,
          vaultAlias: wlAlias || null,
        });
        tr.replaceWith(from, to, wikilinkNode);
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
      let cursorAtDocChange: null | number = null;

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

/** Tiptap Extension wrapper */
export const SyntaxReveal = Extension.create({
  name: "syntaxReveal",

  addProseMirrorPlugins() {
    return [createSyntaxRevealPlugin()];
  },
});
