// §5.3 Math Block NodeView — selected: textarea + preview, unselected: KaTeX only
// §11.2.3 AI button on hover
import { useCallback, useEffect, useRef, useState } from "react";

import type { Node as PmNode } from "@tiptap/pm/model";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Sparkles } from "lucide-react";

import { preprocessNotionFormula } from "../../utils/export/notion-katex-compat";
import { parseKaTeXError } from "../../utils/katex/katex-error";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import { mathBlockEntryKey } from "./math-block";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useTextareaAutoResize } from "./views/use-textarea-auto-resize";

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
  useTextareaAutoResize(textareaRef, localFormula, selected);

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

  // Common atom-block behavior: deleteBlock, exitBlock, handleKeyDown
  const onSaveBeforeExit = useCallback(() => {
    if (localFormula !== formula) {
      updateAttributes({ formula: localFormula });
    }
  }, [localFormula, formula, updateAttributes]);

  const isEmpty = useCallback(() => !localFormula, [localFormula]);
  const { handleKeyDown } = useAtomBlockBehavior({
    editor,
    getPos,
    nodeSize: node.nodeSize,
    textareaRef,
    onSaveBeforeExit,
    keyboard: { backspaceOnEmpty: true, horizontalArrowExit: true },
    isEmpty,
  });

  // Click on preview → enter edit
  const handlePreviewClick = useCallback(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor.commands.setNodeSelection(pos);
  }, [editor, getPos]);

  const eqLabel = `(${eqNumber})`;

  // AI button handler
  const handleAIClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const f = formula || localFormula;
      if (!f.trim()) return;
      const pos = getPos();
      if (typeof pos !== "number") return;
      showNodeViewAIMenu(e.currentTarget, "math", f, editor, pos);
    },
    [formula, localFormula, editor, getPos],
  );

  // Native mousedown stop — React onMouseDown fires at root (too late to block PM)
  const aiButtonRef = useCallback((el: HTMLButtonElement | null) => {
    if (el) el.onmousedown = (e) => e.stopPropagation();
  }, []);

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
        {formula.trim() && (
          <button
            className="nodeview-ai-btn"
            contentEditable={false}
            onClick={handleAIClick}
            ref={aiButtonRef}
            title="AI Commands"
          >
            <Sparkles size={14} />
          </button>
        )}
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
