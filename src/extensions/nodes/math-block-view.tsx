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
import { onFirstVisible } from "./views/lazy-visible";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useAtomEditSession } from "./views/use-atom-edit-session";
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<null | string>(null);
  const [eqNumber, setEqNumber] = useState(1);

  // §perf-large-file heavy-block windowing (Phase 2): defer KaTeX render until
  // the block nears the viewport, mirroring mermaid/code. A selected block
  // (edit-entry) bypasses the gate so find/nav into an unrendered block works.
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    return onFirstVisible(el, () => setIsVisible(true));
  }, []);

  // Refs so the selected-change effect can access latest values without listing
  // them as deps (localFormula changes on every keystroke; adding it would
  // re-run the effect — and re-focus the textarea — on every character typed).
  const localFormulaRef = useRef(localFormula);
  localFormulaRef.current = localFormula;
  const formulaRef = useRef(formula);
  formulaRef.current = formula;
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

  // §298 vim entry-session state machine (entry latches, dirty tracking,
  // editing derivation, Esc stair, preview click) — shared with mermaid/svg
  // block views, see use-atom-edit-session.ts.
  const {
    editing,
    sessionOpenRef,
    textareaProps,
    handlePreviewClick,
    markDirty,
  } = useAtomEditSession({
    editor,
    getPos,
    selected,
    textareaRef,
    entryKey: mathBlockEntryKey,
    localValueRef: localFormulaRef,
    committedValueRef: formulaRef,
    setLocalValue: setLocalFormula,
    commitValue: (value) => updateAttributes({ formula: value }),
    onSaveBeforeExit,
    onKeyDown: handleKeyDown,
  });

  // Auto-resize textarea — keyed on `editing`, NOT `selected`: the standby
  // element is 1px wide, so a measurement there writes an inflated inline
  // height that would survive into the editing render (opening the session
  // changes neither `selected` nor the content). Entry flips this flag, which
  // re-runs the hook at the real width (adversarial review finding).
  useTextareaAutoResize(textareaRef, localFormula, editing);

  // Render KaTeX preview
  useEffect(() => {
    if (!previewRef.current) return;
    // Lazy gate: skip KaTeX while off-screen and not being edited.
    if (!isVisible && !selected) return;
    // localFormula belongs to an edit SESSION — a traversal selection never
    // opened one, so its preview must keep rendering the attribute. Read
    // through the ref, NOT as a dep: the entry effect above sets it in the
    // same commit, and at session start localFormula === formula anyway (the
    // divergence — typing — already re-runs this via the localFormula dep).
    // A dep here double-fires the dynamic import("katex") per selection,
    // which vitest's mocker resolves to the REAL module on the second call.
    const editing = selected && sessionOpenRef.current;
    const f = editing ? localFormula : formula;
    const el = previewRef.current;

    if (!f.trim()) {
      el.textContent = editing ? "" : "Empty math block";
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
    // sessionOpenRef is a stable ref object (see use-atom-edit-session.ts) —
    // listing it is safe and never re-triggers this effect; only a change to
    // one of the OTHER deps does that.
  }, [localFormula, formula, selected, isVisible, sessionOpenRef]);

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

  return (
    <NodeViewWrapper
      className={
        editing
          ? "math-block math-block-editing"
          : "math-block math-block-preview"
      }
      contentEditable={false}
      data-math-size={mathSize}
      onClick={editing ? undefined : handlePreviewClick}
      ref={wrapperRef}
      spellCheck={false}
    >
      {selected && (
        <textarea
          // Standby must not be a Tab stop nor AT-visible: a native textarea
          // defaults into sequential focus, vim does not consume Tab, and an
          // invisible control opening an edit session on stray focus is the
          // §12-⑩ violation again. Programmatic .focus() (the preflight)
          // works regardless of tabIndex -1.
          {...textareaProps}
          autoCapitalize="off"
          autoCorrect="off"
          className={
            editing
              ? "math-block-textarea"
              : "math-block-textarea math-block-textarea-standby"
          }
          data-gramm="false"
          data-vim-suspend=""
          onChange={(e) => {
            markDirty();
            setLocalFormula(e.target.value);
          }}
          placeholder="LaTeX formula..."
          ref={textareaRef}
          rows={1}
          spellCheck={false}
          value={localFormula}
        />
      )}
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
      {editing
        ? error && (
            <div className="math-block-error" contentEditable={false}>
              {error}
            </div>
          )
        : formula.trim() && (
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
