// §298 vim atom-block edit-session state machine — shared by mermaid/svg/math
// block NodeViews (P0 dedup, split-review-ext.md §1). Consolidates the
// entry-latch refs, dirty tracking, editing-derivation, Esc stair, and
// preview-click handling that all three views carried as separate,
// comment-for-comment identical copies.
//
// entryKey is INJECTED by the caller (mermaidBlockEntryKey / svgBlockEntryKey
// / mathBlockEntryKey) rather than imported here: importing any of those node
// modules from this views/ leaf would create a cycle back into the node
// module that renders the NodeView using this hook. atom-block-entry-plugin.ts
// (the shared factory those keys come from) is safe to import — it only
// depends on @tiptap/pm/state.

import type React from "react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { AtomBlockEntryState } from "../atom-block-entry-plugin";
import type { Editor } from "@tiptap/react";

import { NodeSelection, type PluginKey } from "@tiptap/pm/state";

import { focusEditorView } from "../../../utils/editor/focus-editor-view";
import { isWysiwygVimModal, vimPluginKey } from "../../plugins/vim/vim-keys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseAtomEditSessionParams {
  committedValueRef: RefObject<string>;
  /**
   * Persist the local value to node attrs. Called only when the session was
   * dirty AND the value actually diverged from the committed one
   * (deselect-save; S5/S6 review R2 — a bare value comparison would restore
   * a stale local value over attrs changed externally while the block sat
   * unselected and untouched).
   */
  commitValue: (value: string) => void;
  editor: Editor;
  /**
   * Plugin tracking this node type's entry direction (above/below) —
   * injected by the caller. See the module docblock for why.
   */
  entryKey: PluginKey<AtomBlockEntryState>;

  getPos: () => number | undefined;

  /**
   * Refs mirroring the current local (uncommitted) and committed attr
   * values, updated by the caller every render. Read at event time inside
   * the effect below — never as reactive deps, since the local value changes
   * on every keystroke and would re-run the entry effect (and re-focus the
   * textarea) mid-typing.
   */
  localValueRef: RefObject<string>;
  /**
   * Extra cleanup that runs only on deselect, before the shared latches
   * reset. Preserves the one real per-view difference found in review:
   * mermaid closes its template dropdown here (`setShowTemplates(false)`).
   */
  onDeselect?: () => void;

  /** Non-Escape keydown fallback — useAtomBlockBehavior's handleKeyDown. */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /**
   * Explicit-exit save used by the Esc stair below — the same callback the
   * caller also passes to useAtomBlockBehavior as onSaveBeforeExit.
   */
  onSaveBeforeExit: () => void;

  selected: boolean;
  /** Sync local state from the committed value. Called on session entry
   *  (selection entry AND standby-textarea focus). */
  setLocalValue: (value: string) => void;

  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

interface UseAtomEditSessionReturn {
  /**
   * Clears the dirty flag without saving. Used by a direct-commit exit path
   * (mermaid/svg fullscreen "Close") — a leftover dirty flag would make the
   * next deselect re-save a (by then possibly stale) local value over an
   * Undo or external update (S5/S6 review R4).
   */
  clearDirty: () => void;
  editing: boolean;
  handlePreviewClick: () => void;
  markDirty: () => void;
  /**
   * Mirrors whether an edit session is open, independent of `selected` — for
   * effects that must read it at event/render time without listing it as a
   * dep. math/mermaid's KaTeX/Mermaid render effects key their source
   * (local vs. committed) on this via a ref read for exactly that reason: a
   * reactive dep would double-fire the dynamic `import("katex")` /
   * `import("mermaid")` per selection, which vitest's mocker resolves to the
   * real module on the second call.
   */
  sessionOpenRef: RefObject<boolean>;
  textareaProps: {
    "aria-hidden": true | undefined;
    onFocus: () => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    tabIndex: -1 | 0;
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAtomEditSession({
  editor,
  getPos,
  selected,
  textareaRef,
  entryKey,
  localValueRef,
  committedValueRef,
  setLocalValue,
  commitValue,
  onSaveBeforeExit,
  onKeyDown,
  onDeselect,
}: UseAtomEditSessionParams): UseAtomEditSessionReturn {
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // A CLICK is an explicit request to edit and bypasses the modal gate;
  // keyboard traversal does not. Consumed on entry, cleared on deselect.
  const enterByClickRef = useRef(false);
  // §12-⑩ — the editing UI follows ENTRY, not selection: a traversal
  // NodeSelection renders the PREVIEW plus a standby textarea; the session
  // opens when that textarea gains focus (click path or vim's `i` preflight).
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false);
  // Save-on-deselect fires only after REAL typing in an edit session — a bare
  // attrs-vs-local comparison writes a stale baseline back over attrs updated
  // while unselected (S5/S6 review R2).
  const editDirtyRef = useRef(false);

  // Mirror latest callback params into refs so the selected-effect below can
  // honestly depend on [selected] alone — listing these directly would
  // re-run (and re-focus the textarea) on every keystroke, since the
  // component recreates them each render.
  const setLocalValueRef = useRef(setLocalValue);
  setLocalValueRef.current = setLocalValue;
  const commitValueRef = useRef(commitValue);
  commitValueRef.current = commitValue;
  const onDeselectRef = useRef(onDeselect);
  onDeselectRef.current = onDeselect;

  // Sync local value and focus the textarea when entering edit mode; save on
  // deselect. Selection is the only reactive trigger — everything else is
  // read through refs on purpose (see the ref mirrors above).
  useEffect(() => {
    if (!selected) {
      // CONSUME dirty at every deselect — a completed session's flag must not
      // survive into the next one (S5/S6 review R3).
      const wasDirty = editDirtyRef.current;
      editDirtyRef.current = false;
      if (wasDirty && localValueRef.current !== committedValueRef.current) {
        commitValueRef.current(localValueRef.current);
      }
      onDeselectRef.current?.();
      enterByClickRef.current = false;
      isEditingRef.current = false;
      setIsEditing(false);
    } else if (
      enterByClickRef.current ||
      !isWysiwygVimModal(editorRef.current.state)
    ) {
      // §298 §12-⑩ — selection ALONE must not open the block while vim is
      // modal: j/k traversal lands a NodeSelection on an atom line and that
      // is navigation, not editing (pinned in editor-chrome.test.tsx and in
      // {math,svg,mermaid}-block-vim-traversal.test.tsx, which pin the
      // RENDER too — the editing chrome opening on a `j` landing was a live
      // device finding). The explicit entries bypass the gate: a click sets
      // the flag below, and the `i` key is handled by vim's own preflight
      // (adapters/atom-insert.ts), which focuses the STANDBY textarea — it
      // stays mounted (visually hidden) while selected, and its focus event
      // is the entry signal that opens the editing UI.
      enterByClickRef.current = false;
      editDirtyRef.current = false;
      isEditingRef.current = true;
      setIsEditing(true);
      setLocalValueRef.current(committedValueRef.current);
      // Read entry direction from ProseMirror plugin state (synchronously computed)
      const entryState = entryKey.getState(editorRef.current.state);
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
  }, [selected, entryKey, textareaRef, localValueRef, committedValueRef]);

  // §12-⑩ — one render path, editing UI keyed on ENTRY, not selection: a
  // traversal NodeSelection keeps the preview (plus PM's selectednode
  // outline), while a click latch, an open session, or a non-modal surface
  // shows the editor. Single path so the textarea element survives the flip —
  // preflight focus must not land on a node React is about to replace.
  const editing =
    selected &&
    (isEditing ||
      enterByClickRef.current ||
      !isWysiwygVimModal(editorRef.current.state));

  // §12-⑩ entry signal — fires when vim's `i` preflight focuses the standby
  // textarea, and again (idempotently) when the entry effect's own focus
  // lands. Opens the edit session exactly once.
  const handleTextareaFocus = useCallback(() => {
    if (isEditingRef.current) return;
    isEditingRef.current = true;
    editDirtyRef.current = false;
    setLocalValueRef.current(committedValueRef.current);
    setIsEditing(true);
  }, [committedValueRef]);

  // §298 Esc stair — while vim owns the surface, Esc returns to the BLOCK as
  // a normal-mode NodeSelection, matching the code block island's contract.
  // exitBlock("down") (the non-vim path, via onKeyDown) stays the ordinary
  // exit: leaving a block downward on Esc is normal editor behavior, but
  // under vim it strands the caret a line below the block the user was just
  // editing (device finding A.3). The selection is already this block's
  // NodeSelection (every entry path sets it), so closing the session and
  // handing focus back is enough — focusout releases vim's suspension and
  // normal mode resumes on the atom line.
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
      onKeyDown(e);
    },
    [getPos, onKeyDown, onSaveBeforeExit],
  );

  // Click on preview → enter edit
  const handlePreviewClick = useCallback(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    // §12-⑩ modal click = NAVIGATION (issue 408, UX decision): land the
    // outline exactly like j/k and stop — `i` is the entry. Non-modal (insert
    // mode, vim off) keeps the click entry below.
    if (isWysiwygVimModal(editorRef.current.state)) {
      editorRef.current.commands.setNodeSelection(pos);
      return;
    }
    // Set BEFORE the selection change: the focus effect runs on the render
    // this dispatch causes.
    enterByClickRef.current = true;
    editor.commands.setNodeSelection(pos);
    // Already-selected standby block: the selection does not change, so no
    // effect will run — the standby textarea is the entry instead.
    textareaRef.current?.focus();
  }, [editor, getPos, textareaRef]);

  const markDirty = useCallback(() => {
    editDirtyRef.current = true;
  }, []);

  const clearDirty = useCallback(() => {
    editDirtyRef.current = false;
  }, []);

  const textareaProps: UseAtomEditSessionReturn["textareaProps"] = {
    "aria-hidden": editing ? undefined : true,
    onFocus: handleTextareaFocus,
    onKeyDown: handleTextareaKeyDown,
    tabIndex: editing ? 0 : -1,
  };

  return {
    editing,
    sessionOpenRef: isEditingRef,
    textareaProps,
    handlePreviewClick,
    markDirty,
    clearDirty,
  };
}
