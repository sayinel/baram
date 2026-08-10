// §5.3 Math Block NodeView — selected: textarea + preview, unselected: KaTeX only
// §11.2.3 AI button on hover
import { useCallback, useEffect, useRef, useState } from "react";

import type { Node as PmNode } from "@tiptap/pm/model";

import { NodeSelection } from "@tiptap/pm/state";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Sparkles } from "lucide-react";

import { focusEditorView } from "../../utils/editor/focus-editor-view";
import { preprocessNotionFormula } from "../../utils/export/notion-katex-compat";
import { parseKaTeXError } from "../../utils/katex/katex-error";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import { isWysiwygVimModal, vimPluginKey } from "../plugins/vim/vim-keys";
import { mathBlockEntryKey } from "./math-block";
import { onFirstVisible } from "./views/lazy-visible";
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<null | string>(null);
  const [eqNumber, setEqNumber] = useState(1);

  // §perf-large-file heavy-block windowing (Phase 2): defer KaTeX render until
  // the block nears the viewport, mirroring mermaid/code. A selected block
  // (edit-entry) bypasses the gate so find/nav into an unrendered block works.
  const [isVisible, setIsVisible] = useState(false);
  // §12-⑩ vim modal gate — event-time read via ref (not a reactive dep)
  const vimGateEditorRef = useRef(editor);
  vimGateEditorRef.current = editor;
  // A CLICK is an explicit request to edit and bypasses the modal gate;
  // keyboard traversal does not. Consumed on entry, cleared on deselect.
  const enterByClickRef = useRef(false);
  // §12-⑩ — the editing UI follows ENTRY, not selection. While vim is modal a
  // traversal NodeSelection renders the PREVIEW plus a standby textarea; the
  // session opens when that textarea gains focus (click path or vim's `i`
  // preflight). Ref mirror so event handlers see the current value.
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false);

  // Save-on-deselect fires only after REAL typing in an edit session — a
  // bare attrs-vs-local comparison writes a stale baseline back over attrs
  // updated while unselected (S5/S6 review R2).
  const editDirtyRef = useRef(false);

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
    if (!selected) {
      // Save on deselect
      // CONSUME dirty at every deselect — a completed session's flag must
      // not survive into the next one (S5/S6 review R3).
      const wasDirty = editDirtyRef.current;
      editDirtyRef.current = false;
      if (wasDirty && localFormulaRef.current !== formulaRef.current) {
        updateAttributesRef.current({ formula: localFormulaRef.current });
      }
      enterByClickRef.current = false;
      isEditingRef.current = false;
      setIsEditing(false);
    } else if (
      enterByClickRef.current ||
      !isWysiwygVimModal(vimGateEditorRef.current.state)
    ) {
      // §298 §12-⑩ — selection ALONE must not open the block while vim is
      // modal: j/k traversal lands a NodeSelection on an atom line and that
      // is navigation, not editing (pinned in editor-chrome.test.tsx and in
      // math-block-vim-traversal.test.tsx, which pins the RENDER too — the
      // editing chrome opening on a `j` landing was a live device finding).
      //
      // The explicit entries bypass the gate: a click sets the flag below,
      // and the `i` key is handled by vim's own preflight
      // (adapters/atom-insert.ts), which focuses the STANDBY textarea — it
      // stays mounted (visually hidden) while selected, and its focus event
      // is the entry signal that opens the editing UI.
      enterByClickRef.current = false;
      editDirtyRef.current = false;
      isEditingRef.current = true;
      setIsEditing(true);
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
    }
    // Selection is the only trigger. Everything else is read through refs on
    // purpose — localFormula changes on every keystroke and would re-focus
    // the textarea mid-typing.
  }, [selected]);

  // §12-⑩ — one render path, editing UI keyed on ENTRY, not selection: a
  // traversal NodeSelection keeps the preview (plus PM's selectednode
  // outline), while a click latch, an open session, or a non-modal surface
  // shows the editor. Single path so the textarea element survives the flip —
  // preflight focus must not land on a node React is about to replace.
  // Computed BEFORE the hooks that key on it.
  const editing =
    selected &&
    (isEditing ||
      enterByClickRef.current ||
      !isWysiwygVimModal(vimGateEditorRef.current.state));

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
    const editing = selected && isEditingRef.current;
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
  }, [localFormula, formula, selected, isVisible]);

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

  // §298 Esc stair — while vim owns the surface, Esc returns to the BLOCK as
  // a normal-mode NodeSelection, matching the code block island's contract.
  // exitBlock("down") stays the non-vim path: leaving a block downward on Esc
  // is ordinary editor behavior, but under vim it strands the caret a line
  // below the block the user was just editing (device finding A.3). The
  // selection is already this block's NodeSelection (every entry path sets
  // it), so closing the session and handing focus back is enough — focusout
  // releases vim's suspension and normal mode resumes on the atom line.
  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (
        e.key === "Escape" &&
        vimPluginKey.getState(editorRef.current.state)?.enabled
      ) {
        e.preventDefault();
        e.stopPropagation();
        onSaveBeforeExit();
        enterByClickRef.current = false;
        editDirtyRef.current = false;
        isEditingRef.current = false;
        setIsEditing(false);
        // ATOMIC handoff: entering from SURFACE insert mode (`i` in a
        // paragraph, then a click on the preview) leaves vim in insert — if
        // Esc only closed the React latches, the surface would stay editable
        // over a live NodeSelection and the next keystroke would REPLACE the
        // block (adversarial review, reproduced in the pin). One transaction
        // lands normal mode AND the block's NodeSelection together; setMode
        // also clears count/pending/visual.
        const editorNow = editorRef.current;
        const pos = getPos();
        const tr = editorNow.state.tr;
        if (typeof pos === "number") {
          tr.setSelection(NodeSelection.create(tr.doc, pos));
        }
        tr.setMeta(vimPluginKey, { mode: "normal", type: "setMode" });
        editorNow.view.dispatch(tr);
        focusEditorView(editorNow.view);
        return;
      }
      handleKeyDown(e);
    },
    [getPos, handleKeyDown, onSaveBeforeExit],
  );

  // §12-⑩ entry signal — fires when vim's `i` preflight focuses the standby
  // textarea, and again (idempotently) when the entry effect's own focus
  // lands. Opens the edit session exactly once.
  const handleTextareaFocus = useCallback(() => {
    if (isEditingRef.current) return;
    isEditingRef.current = true;
    editDirtyRef.current = false;
    setLocalFormula(formulaRef.current);
    setIsEditing(true);
  }, []);

  // Click on preview → enter edit
  const handlePreviewClick = useCallback(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    // Set BEFORE the selection change: the focus effect runs on the render
    // this dispatch causes.
    enterByClickRef.current = true;
    editor.commands.setNodeSelection(pos);
    // Already-selected standby block: the selection does not change, so no
    // effect will run — the standby textarea is the entry instead.
    textareaRef.current?.focus();
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
          aria-hidden={editing ? undefined : true}
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
            editDirtyRef.current = true;
            setLocalFormula(e.target.value);
          }}
          onFocus={handleTextareaFocus}
          onKeyDown={handleTextareaKeyDown}
          placeholder="LaTeX formula..."
          ref={textareaRef}
          rows={1}
          spellCheck={false}
          tabIndex={editing ? 0 : -1}
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
