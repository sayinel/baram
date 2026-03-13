// §5.3 Math Block NodeView — selected: textarea + preview, unselected: KaTeX only
import { useCallback, useEffect, useRef, useState } from "react";

import type { Node as PmNode } from "@tiptap/pm/model";

import { TextSelection } from "@tiptap/pm/state";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";

import { parseKaTeXError } from "../../utils/katex-error";
import { preprocessNotionFormula } from "../../utils/notion-katex-compat";
import { mathBlockEntryKey } from "./math-block";

// §perf-large-file: Per-doc cache via WeakMap — avoids cross-tab equation number bleed
const mathPositionCache = new WeakMap<PmNode, Map<number, number>>();

export function MathBlockView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const formula = (node.attrs.formula as string) || "";
  const mathSize = (node.attrs.mathSize as string) || "normal";
  const [localFormula, setLocalFormula] = useState(formula);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<null | string>(null);
  const [eqNumber, setEqNumber] = useState(1);

  // Refs so the selected-change effect can access latest values without listing
  // them as deps (localFormula changes on every keystroke; adding it would
  // re-run the effect — and re-focus the textarea — on every character typed).
  const localFormulaRef = useRef(localFormula);
  localFormulaRef.current = localFormula;
  const formulaRef = useRef(formula);
  formulaRef.current = formula;
  const updateAttributesRef = useRef(updateAttributes);
  updateAttributesRef.current = updateAttributes;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // §perf-large-file: Use shared cache — O(1) per instance, O(n) total per doc change
  useEffect(() => {
    const updateNumber = () => {
      const pos = getPos();
      if (typeof pos !== "number") return;
      setEqNumber(getMathBlockNumber(editor.state.doc, pos));
    };
    updateNumber();
    editor.on("update", updateNumber);
    return () => {
      editor.off("update", updateNumber);
    };
  }, [editor, getPos]);

  // Sync local formula and focus textarea when entering edit mode
  useEffect(() => {
    if (selected) {
      setLocalFormula(formulaRef.current);
      // Read entry direction from ProseMirror plugin state (synchronously computed)
      const entryState = mathBlockEntryKey.getState(editorRef.current.state);
      const enteredFromBelow = entryState?.direction === "below";

      setTimeout(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        if (enteredFromBelow) {
          ta.setSelectionRange(ta.value.length, ta.value.length);
        } else {
          ta.setSelectionRange(0, 0);
        }
      }, 0);
    } else {
      // Save on deselect
      if (localFormulaRef.current !== formulaRef.current) {
        updateAttributesRef.current({ formula: localFormulaRef.current });
      }
    }
  }, [selected]);

  // Auto-resize textarea
  useEffect(() => {
    if (selected && textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }, [localFormula, selected]);

  // Render KaTeX preview
  useEffect(() => {
    if (!previewRef.current) return;
    const f = selected ? localFormula : formula;
    const el = previewRef.current;

    if (!f.trim()) {
      el.textContent = selected ? "" : "Empty math block";
      el.className = "math-block-katex math-block-katex-empty";
      setError(null);
      return;
    }

    const processed = preprocessNotionFormula(f);

    void import("katex").then(({ default: katex }) => {
      if (!el.isConnected) return;
      try {
        katex.render(processed, el, {
          throwOnError: true,
          displayMode: true,
        });
        el.className = "math-block-katex";
        setError(null);
      } catch (err) {
        setError(parseKaTeXError(err));
        try {
          katex.render(processed, el, {
            throwOnError: false,
            displayMode: true,
          });
          el.className = "math-block-katex";
        } catch {
          el.textContent = f;
          el.className = "math-block-katex";
        }
      }
    });
  }, [localFormula, formula, selected]);

  // Delete this math block and move cursor to nearest valid position
  const deleteBlock = useCallback(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const { tr } = editor.state;
    tr.delete(pos, pos + node.nodeSize);
    const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
    tr.setSelection(TextSelection.near($pos, -1));
    editor.view.dispatch(tr);
    editor.view.focus();
  }, [editor, getPos, node.nodeSize]);

  // Exit block: save formula and move focus to target position
  // If exiting downward and no next node exists, insert a new paragraph
  const exitBlock = useCallback(
    (direction: "down" | "up") => {
      const pos = getPos();
      if (typeof pos !== "number") return;

      if (localFormula !== formula) {
        updateAttributes({ formula: localFormula });
      }

      if (direction === "up") {
        editor.chain().setTextSelection(pos).focus().run();
      } else {
        const afterPos = pos + node.nodeSize;
        const { doc } = editor.state;
        // Check if there's a node after this block
        const $after = doc.resolve(afterPos);
        if ($after.parentOffset >= $after.parent.content.size) {
          // No content after — insert a new paragraph, then move into it
          editor
            .chain()
            .insertContentAt(afterPos, { type: "paragraph" })
            .setTextSelection(afterPos + 1)
            .focus()
            .run();
        } else {
          editor.chain().setTextSelection(afterPos).focus().run();
        }
      }
    },
    [editor, getPos, localFormula, formula, updateAttributes, node.nodeSize],
  );

  // Keyboard navigation within textarea
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = textareaRef.current;
      if (!ta) return;

      if (e.key === "Escape") {
        e.preventDefault();
        exitBlock("down");
        return;
      }

      // Backspace on empty formula at cursor position 0 → delete block
      if (
        e.key === "Backspace" &&
        ta.selectionStart === 0 &&
        ta.selectionEnd === 0 &&
        !localFormula
      ) {
        e.preventDefault();
        deleteBlock();
        return;
      }

      if (
        e.key === "ArrowLeft" &&
        ta.selectionStart === 0 &&
        ta.selectionEnd === 0
      ) {
        e.preventDefault();
        exitBlock("up");
        return;
      }

      if (e.key === "ArrowRight" && ta.selectionStart === ta.value.length) {
        e.preventDefault();
        exitBlock("down");
        return;
      }

      if (e.key === "ArrowUp") {
        const before = ta.value.substring(0, ta.selectionStart);
        if (!before.includes("\n")) {
          e.preventDefault();
          exitBlock("up");
          return;
        }
      }

      if (e.key === "ArrowDown") {
        const after = ta.value.substring(ta.selectionStart);
        if (!after.includes("\n")) {
          e.preventDefault();
          exitBlock("down");
          return;
        }
      }
    },
    [exitBlock, deleteBlock, localFormula],
  );

  // Click on preview → enter edit
  const handlePreviewClick = useCallback(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor.commands.setNodeSelection(pos);
  }, [editor, getPos]);

  const eqLabel = `(${eqNumber})`;

  // Non-editing: KaTeX render only
  if (!selected) {
    return (
      <NodeViewWrapper
        className="math-block math-block-preview"
        contentEditable={false}
        data-math-size={mathSize}
        onClick={handlePreviewClick}
        spellCheck={false}
      >
        <div className="math-block-row">
          <div className="math-block-katex" ref={previewRef} />
          <span className="math-block-eq-number">{eqLabel}</span>
        </div>
      </NodeViewWrapper>
    );
  }

  // Editing: textarea + live preview
  return (
    <NodeViewWrapper
      className="math-block math-block-editing"
      contentEditable={false}
      data-math-size={mathSize}
      spellCheck={false}
    >
      <textarea
        autoCapitalize="off"
        autoCorrect="off"
        className="math-block-textarea"
        data-gramm="false"
        onChange={(e) => setLocalFormula(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="LaTeX formula..."
        ref={textareaRef}
        rows={1}
        spellCheck={false}
        value={localFormula}
      />
      <div className="math-block-row">
        <div
          className="math-block-katex"
          contentEditable={false}
          ref={previewRef}
        />
        <span className="math-block-eq-number" contentEditable={false}>
          {eqLabel}
        </span>
      </div>
      {error && (
        <div className="math-block-error" contentEditable={false}>
          {error}
        </div>
      )}
    </NodeViewWrapper>
  );
}

function getMathBlockNumber(doc: PmNode, pos: number): number {
  return getMathPositions(doc).get(pos) ?? 1;
}

function getMathPositions(doc: PmNode): Map<number, number> {
  let positions = mathPositionCache.get(doc);
  if (!positions) {
    positions = new Map();
    let count = 0;
    doc.descendants((n, nPos) => {
      if (n.type.name === "mathBlock") {
        count++;
        positions!.set(nPos, count);
      }
    });
    mathPositionCache.set(doc, positions);
  }
  return positions;
}
