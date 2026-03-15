import type KatexType from "katex";

// §5.3 MathInlineEdit — ProseMirror plugin for inline math editing
// Handles: $ auto-pairing, delimiter decorations, preview overlay,
// confirm/cancel, re-edit (atom → text), block math auto-conversion.
import { Extension } from "@tiptap/core";
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { parseKaTeXError } from "../../utils/katex/katex-error";
import { logger } from "../../utils/logger";

// Lazily loaded katex — populated on first use, null until then
let _katex: null | typeof KatexType = null;
let _katexRetries = 0;
const MAX_KATEX_RETRIES = 3;
function loadKatex(): void {
  void import("katex")
    .then(({ default: k }) => {
      _katex = k;
    })
    .catch((err) => {
      _katexRetries++;
      if (_katexRetries <= MAX_KATEX_RETRIES) {
        logger.error(`Failed to load KaTeX (attempt ${_katexRetries}):`, err);
        setTimeout(loadKatex, 2000 * _katexRetries);
      } else {
        logger.error("KaTeX failed to load after max retries:", err);
      }
    });
}
loadKatex();
import { preprocessNotionFormula } from "../../utils/export/notion-katex-compat";

// ── Plugin state ──────────────────────────────────────────────────────
interface MathEditState {
  active: boolean;
  from: number; // position of opening $
  to: number; // position after closing $
}

const INACTIVE: MathEditState = { active: false, from: 0, to: 0 };
const mathEditKey = new PluginKey<MathEditState>("mathInlineEdit");

// ── Helpers ───────────────────────────────────────────────────────────

function confirmEdit(view: EditorView, es: MathEditState) {
  const formula = getFormula(view.state, es);
  const { tr } = view.state;

  if (!formula.trim()) {
    // Empty → delete both $
    tr.delete(es.from, es.to);
  } else {
    // Replace $formula$ with mathInline atom
    const node = view.state.schema.nodes.mathInline.create({ formula });
    tr.replaceWith(es.from, es.to, node);
  }

  tr.setMeta(mathEditKey, INACTIVE);
  view.dispatch(tr);
}

function createMathEditPlugin(): Plugin<MathEditState> {
  let pendingRaf: null | number = null;

  return new Plugin<MathEditState>({
    key: mathEditKey,

    // ── State management ────────────────────────────────────────────
    state: {
      init(): MathEditState {
        return INACTIVE;
      },

      apply(
        tr: Transaction,
        value: MathEditState,
        _old: EditorState,
        newState: EditorState,
      ): MathEditState {
        const meta = tr.getMeta(mathEditKey) as MathEditState | undefined;
        if (meta !== undefined) return meta;
        if (!value.active) return value;

        // Map positions through the transaction
        const from = tr.mapping.map(value.from, -1);
        const to = tr.mapping.map(value.to, 1);

        // Validate delimiters still exist
        try {
          const fromChar = newState.doc.textBetween(from, from + 1);
          const toChar = newState.doc.textBetween(to - 1, to);
          if (fromChar !== "$" || toChar !== "$") return INACTIVE;
        } catch {
          return INACTIVE;
        }

        return { active: true, from, to };
      },
    },

    // ── Decorations ─────────────────────────────────────────────────
    props: {
      decorations(state) {
        const es = mathEditKey.getState(state);
        if (!es?.active) return DecorationSet.empty;

        return DecorationSet.create(state.doc, [
          Decoration.inline(es.from, es.from + 1, {
            class: "math-delimiter",
          }),
          Decoration.inline(es.to - 1, es.to, {
            class: "math-delimiter",
          }),
        ]);
      },

      // ── $ input handling ────────────────────────────────────────
      handleTextInput(view, from, to, text) {
        if (text !== "$") return false;
        const es = mathEditKey.getState(view.state);

        // Active + empty → cancel inline edit, leave $$ for block math
        if (es?.active) {
          const formula = getFormula(view.state, es);
          if (!formula) {
            const tr = view.state.tr;
            // Move cursor after the $$
            tr.setSelection(TextSelection.create(tr.doc, es.to));
            tr.setMeta(mathEditKey, INACTIVE);
            view.dispatch(tr);
            return true; // Swallow the $ — $$ already exists
          }
          // Non-empty → let $ be typed as formula text
          return false;
        }

        // Don't create inside code/math blocks
        const { $from } = view.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const a = $from.node(d);
          if (a.type.spec.code || a.type.name === "mathBlock") return false;
        }

        // Insert $$ and place cursor between
        const tr = view.state.tr;
        tr.insertText("$$", from, to);
        tr.setSelection(TextSelection.create(tr.doc, from + 1));
        tr.setMeta(mathEditKey, { active: true, from, to: from + 2 });
        view.dispatch(tr);
        return true;
      },

      // ── Keyboard handling ─────────────────────────────────────────
      handleKeyDown(view, event) {
        const es = mathEditKey.getState(view.state);

        // ── Re-edit: character typed on NodeSelection of mathInline ─
        if (!es?.active) {
          const { selection } = view.state;
          if (
            selection instanceof NodeSelection &&
            selection.node.type.name === "mathInline"
          ) {
            // Backspace/Delete: let ProseMirror handle (node deletion)
            if (event.key === "Backspace" || event.key === "Delete")
              return false;

            // Single character (no modifier) → convert atom to text + insert
            if (
              event.key.length === 1 &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey
            ) {
              // Cancel any pending rAF conversion
              if (pendingRaf) {
                cancelAnimationFrame(pendingRaf);
                pendingRaf = null;
              }

              const formula = (selection.node.attrs.formula as string) || "";
              const pos = selection.from;
              const { tr } = view.state;
              const newText = `$${formula}$`;
              tr.replaceWith(
                pos,
                pos + selection.node.nodeSize,
                view.state.schema.text(newText),
              );
              // Cursor at end of formula (before closing $), then insert char
              const cursorPos = pos + 1 + formula.length;
              tr.insertText(event.key, cursorPos);
              const newTo = pos + newText.length + 1; // +1 for inserted char
              tr.setSelection(TextSelection.create(tr.doc, cursorPos + 1));
              tr.setMeta(mathEditKey, { active: true, from: pos, to: newTo });
              view.dispatch(tr);
              return true;
            }
          }
          return false;
        }

        // ── Active editing mode ─────────────────────────────────────

        // Enter / Escape → confirm
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          confirmEdit(view, es);
          return true;
        }

        // Backspace at opening $
        if (event.key === "Backspace") {
          const { from: selFrom } = view.state.selection;
          if (selFrom === es.from + 1) {
            event.preventDefault();
            const formula = getFormula(view.state, es);
            const { tr } = view.state;
            if (!formula) {
              // Empty → delete both $
              tr.delete(es.from, es.to);
            } else {
              // Has content → restore as plain text (remove $ delimiters)
              const text = view.state.schema.text(formula);
              tr.replaceWith(es.from, es.to, text);
              tr.setSelection(TextSelection.create(tr.doc, es.from));
            }
            tr.setMeta(mathEditKey, INACTIVE);
            view.dispatch(tr);
            return true;
          }
        }

        return false;
      },

      // ── Click handling ────────────────────────────────────────────
      handleClick(view, pos, _event) {
        const es = mathEditKey.getState(view.state);

        // Active + click outside range → confirm
        if (es?.active) {
          if (pos <= es.from || pos >= es.to) {
            confirmEdit(view, es);
            return false; // Let ProseMirror also handle the click
          }
          return false;
        }

        // Click on mathInline atom → re-edit
        const $pos = view.state.doc.resolve(pos);
        const nodeAfter = $pos.nodeAfter;
        if (nodeAfter && nodeAfter.type.name === "mathInline") {
          const formula = (nodeAfter.attrs.formula as string) || "";
          const nPos = pos;
          const { tr } = view.state;
          const newText = `$${formula}$`;
          tr.replaceWith(
            nPos,
            nPos + nodeAfter.nodeSize,
            view.state.schema.text(newText),
          );
          const cursorPos = nPos + 1 + formula.length;
          tr.setSelection(TextSelection.create(tr.doc, cursorPos));
          tr.setMeta(mathEditKey, {
            active: true,
            from: nPos,
            to: nPos + newText.length,
          });
          view.dispatch(tr);
          return true;
        }

        return false;
      },
    },

    // ── Plugin View (overlay + cursor-out detection + auto re-edit) ──
    view() {
      // Overlay element
      const overlay = document.createElement("div");
      overlay.className = "math-inline-preview-popover";
      overlay.style.display = "none";
      document.body.appendChild(overlay);

      const previewContent = document.createElement("div");
      previewContent.className = "math-inline-preview-content";
      overlay.appendChild(previewContent);

      const errorEl = document.createElement("div");
      errorEl.className = "math-inline-preview-error";
      errorEl.style.display = "none";
      overlay.appendChild(errorEl);

      function updateOverlay(view: EditorView) {
        const es = mathEditKey.getState(view.state);
        if (!es?.active) {
          overlay.style.display = "none";
          return;
        }

        const formula = getFormula(view.state, es);

        if (!formula.trim()) {
          previewContent.innerHTML = "";
          previewContent.style.color = "#999";
          previewContent.style.fontStyle = "italic";
          previewContent.textContent = "수식을 입력하세요";
          errorEl.style.display = "none";
        } else {
          previewContent.style.color = "";
          previewContent.style.fontStyle = "";

          const processed = preprocessNotionFormula(formula);
          if (!_katex) {
            // katex not yet loaded — show raw formula as fallback
            previewContent.textContent = formula;
            errorEl.style.display = "none";
          } else {
            try {
              _katex.render(processed, previewContent, {
                throwOnError: true,
                displayMode: false,
              });
              errorEl.style.display = "none";
            } catch (err) {
              errorEl.textContent = parseKaTeXError(err);
              errorEl.style.display = "block";
              try {
                _katex.render(processed, previewContent, {
                  throwOnError: false,
                  displayMode: false,
                });
              } catch {
                previewContent.textContent = formula;
              }
            }
          }
        }

        // Position overlay below opening $
        const coords = view.coordsAtPos(es.from);
        overlay.style.display = "block";
        overlay.style.left = `${coords.left}px`;
        overlay.style.top = `${coords.bottom + 4}px`;
      }

      function checkCursorOut(view: EditorView) {
        const es = mathEditKey.getState(view.state);
        if (!es?.active) return;
        const { from } = view.state.selection;
        if (from <= es.from || from >= es.to) {
          confirmEdit(view, es);
        }
      }

      function checkNodeSelection(view: EditorView) {
        const es = mathEditKey.getState(view.state);
        if (es?.active) return;

        const { selection } = view.state;
        if (
          selection instanceof NodeSelection &&
          selection.node.type.name === "mathInline"
        ) {
          // Cancel any previous pending rAF
          if (pendingRaf) cancelAnimationFrame(pendingRaf);

          pendingRaf = requestAnimationFrame(() => {
            pendingRaf = null;
            // Re-check: selection may have changed
            const { selection: sel } = view.state;
            if (
              !(sel instanceof NodeSelection) ||
              sel.node.type.name !== "mathInline"
            )
              return;

            const formula = (sel.node.attrs.formula as string) || "";
            const pos = sel.from;
            const { tr } = view.state;
            const newText = `$${formula}$`;
            tr.replaceWith(
              pos,
              pos + sel.node.nodeSize,
              view.state.schema.text(newText),
            );
            const cursorPos = pos + 1 + formula.length;
            tr.setSelection(TextSelection.create(tr.doc, cursorPos));
            tr.setMeta(mathEditKey, {
              active: true,
              from: pos,
              to: pos + newText.length,
            });
            view.dispatch(tr);
          });
        }
      }

      return {
        update(view: EditorView) {
          checkNodeSelection(view);
          checkCursorOut(view);
          updateOverlay(view);
        },
        destroy() {
          if (pendingRaf) cancelAnimationFrame(pendingRaf);
          overlay.remove();
        },
      };
    },
  });
}

// ── Plugin factory ────────────────────────────────────────────────────

function getFormula(state: EditorState, es: MathEditState): string {
  if (!es.active || es.to - es.from < 2) return "";
  return state.doc.textBetween(es.from + 1, es.to - 1);
}

// ── Tiptap Extension wrapper ──────────────────────────────────────────

export const MathInlineEdit = Extension.create({
  name: "mathInlineEdit",

  addProseMirrorPlugins() {
    return [createMathEditPlugin()];
  },
});
