// §5.6 Find/Replace Bar — Inline overlay (top-right of editor area)
// Two modes: Find only (Cmd+F) and Find+Replace (Cmd+H)
//
// Tiptap v3 does NOT re-render for meta-only ProseMirror transactions.
// We use local React state for input values and manually subscribe to
// editor transactions to read match counts from plugin state.

import { useEffect, useRef, useCallback, useState, useReducer } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  findReplacePluginKey,
  dispatchSetSearchTerm,
  dispatchSetReplaceWith,
  dispatchToggleCaseSensitive,
  dispatchToggleRegex,
  dispatchToggleWholeWord,
  dispatchNextMatch,
  dispatchPrevMatch,
  dispatchReplaceCurrent,
  dispatchReplaceAll,
  dispatchClearSearch,
} from "../../extensions/plugins/find-replace";
import type { FindReplaceState } from "../../extensions/plugins/find-replace";

interface FindReplaceBarProps {
  editor: Editor;
  mode: "find" | "replace";
  onClose: () => void;
  onSetMode: (mode: "find" | "replace") => void;
}

export function FindReplaceBar({
  editor,
  mode,
  onClose,
  onSetMode,
}: FindReplaceBarProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Local state for input values — immune to Tiptap v3 re-render optimization
  // Initialize from plugin state if already set (e.g. from Global Search)
  const [localSearchTerm, setLocalSearchTerm] = useState(() => {
    const ps = findReplacePluginKey.getState(editor.state) as FindReplaceState | undefined;
    return ps?.searchTerm ?? "";
  });
  const [localReplaceWith, setLocalReplaceWith] = useState("");

  // Force re-render on editor transactions to update match counts
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const handler = () => forceRender();
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  // Focus search input on mount and mode change
  useEffect(() => {
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [mode]);

  // Read plugin state for match info (reactive via forceRender)
  const pluginState = (
    findReplacePluginKey.getState(editor.state) as FindReplaceState | undefined
  ) ?? {
    searchTerm: "",
    caseSensitive: false,
    useRegex: false,
    wholeWord: false,
    replaceWith: "",
    activeMatchIndex: -1,
    matches: [],
  };

  const { caseSensitive, useRegex, wholeWord, activeMatchIndex, matches } =
    pluginState;

  // Track last selected match to avoid redundant dispatches
  const lastSelectedRef = useRef<{ from: number; to: number } | null>(null);

  // Select active match in editor + scroll to center
  useEffect(() => {
    if (matches.length === 0 || activeMatchIndex < 0) {
      lastSelectedRef.current = null;
      return;
    }
    const match = matches[activeMatchIndex];
    if (!match) return;

    // Skip if this exact match was already selected
    const last = lastSelectedRef.current;
    if (last && last.from === match.from && last.to === match.to) return;
    lastSelectedRef.current = { from: match.from, to: match.to };

    try {
      // Set ProseMirror selection to the match range + scroll into view
      const tr = editor.state.tr
        .setSelection(
          TextSelection.create(editor.state.doc, match.from, match.to),
        )
        .scrollIntoView();
      editor.view.dispatch(tr);

      // DOM-level scroll fallback — ensures .editor-area scroll container works
      requestAnimationFrame(() => {
        try {
          const domInfo = editor.view.domAtPos(match.from);
          const el =
            domInfo.node instanceof HTMLElement
              ? domInfo.node
              : domInfo.node.parentElement;
          el?.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch {
          // ignore
        }
        // Re-focus Find input (editor dispatch may steal focus)
        searchInputRef.current?.focus();
      });
    } catch {
      // ignore invalid position
    }
  }, [activeMatchIndex, matches, editor]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setLocalSearchTerm(val);
      dispatchSetSearchTerm(editor.view, val);
    },
    [editor],
  );

  const handleReplaceChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setLocalReplaceWith(val);
      dispatchSetReplaceWith(editor.view, val);
    },
    [editor],
  );

  const handleClose = useCallback(() => {
    dispatchClearSearch(editor.view);
    setLocalSearchTerm("");
    setLocalReplaceWith("");
    lastSelectedRef.current = null;
    onClose();
  }, [editor, onClose]);

  // Replace current match — sync local replaceWith to plugin state first
  const handleReplaceCurrent = useCallback(() => {
    // Ensure plugin state has the latest replaceWith before replacing
    dispatchSetReplaceWith(editor.view, localReplaceWith);
    // Need to re-read state after the sync dispatch
    requestAnimationFrame(() => {
      dispatchReplaceCurrent(editor.view);
      // Clear lastSelectedRef so the next match selection fires
      lastSelectedRef.current = null;
    });
  }, [editor, localReplaceWith]);

  // Replace all matches
  const handleReplaceAll = useCallback(() => {
    dispatchSetReplaceWith(editor.view, localReplaceWith);
    requestAnimationFrame(() => {
      dispatchReplaceAll(editor.view);
      lastSelectedRef.current = null;
    });
  }, [editor, localReplaceWith]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        // Clear ref so the next/prev match selection triggers scroll
        lastSelectedRef.current = null;
        if (e.shiftKey) {
          dispatchPrevMatch(editor.view);
        } else {
          dispatchNextMatch(editor.view);
        }
        return;
      }
      // Cmd+H switches to replace mode
      if ((e.metaKey || e.ctrlKey) && e.key === "h") {
        e.preventDefault();
        onSetMode("replace");
        return;
      }
    },
    [editor, handleClose, onSetMode],
  );

  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleReplaceCurrent();
        return;
      }
    },
    [handleClose, handleReplaceCurrent],
  );

  // ▲▼ navigation buttons also need to clear the ref
  const handlePrevMatch = useCallback(() => {
    lastSelectedRef.current = null;
    dispatchPrevMatch(editor.view);
  }, [editor]);

  const handleNextMatch = useCallback(() => {
    lastSelectedRef.current = null;
    dispatchNextMatch(editor.view);
  }, [editor]);

  const matchCountText =
    matches.length === 0
      ? localSearchTerm
        ? "No results"
        : ""
      : `${activeMatchIndex + 1} of ${matches.length}`;

  return (
    <div className="find-replace-bar" role="search" aria-label="Find and replace">
      {/* Search row */}
      <div className="find-replace-row">
        <input
          ref={searchInputRef}
          className="find-replace-input"
          type="text"
          placeholder="Find..."
          value={localSearchTerm}
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          aria-label="Search"
        />

        <div className="find-replace-toggles">
          <button
            className={`find-replace-toggle${caseSensitive ? " active" : ""}`}
            onClick={() => dispatchToggleCaseSensitive(editor.view)}
            title="Case Sensitive (Aa)"
            aria-pressed={caseSensitive}
          >
            Aa
          </button>
          <button
            className={`find-replace-toggle${useRegex ? " active" : ""}`}
            onClick={() => dispatchToggleRegex(editor.view)}
            title="Regular Expression (.*)"
            aria-pressed={useRegex}
          >
            .*
          </button>
          <button
            className={`find-replace-toggle${wholeWord ? " active" : ""}`}
            onClick={() => dispatchToggleWholeWord(editor.view)}
            title="Whole Word"
            aria-pressed={wholeWord}
          >
            W
          </button>
        </div>

        {matchCountText && (
          <span className="find-replace-count">{matchCountText}</span>
        )}

        <div className="find-replace-actions">
          <button
            className="find-replace-nav-btn"
            onClick={handlePrevMatch}
            disabled={matches.length === 0}
            title="Previous Match (Shift+Enter)"
            aria-label="Previous match"
          >
            &#9650;
          </button>
          <button
            className="find-replace-nav-btn"
            onClick={handleNextMatch}
            disabled={matches.length === 0}
            title="Next Match (Enter)"
            aria-label="Next match"
          >
            &#9660;
          </button>
          <button
            className={`find-replace-toggle-replace${mode === "replace" ? " active" : ""}`}
            onClick={() => onSetMode(mode === "replace" ? "find" : "replace")}
            title={mode === "replace" ? "Hide Replace" : "Show Replace (Cmd+H)"}
            aria-label={mode === "replace" ? "Hide replace" : "Show replace"}
            aria-expanded={mode === "replace"}
          >
            &#8644;
          </button>
          <button
            className="find-replace-close-btn"
            onClick={handleClose}
            title="Close (Escape)"
            aria-label="Close find"
          >
            &#10005;
          </button>
        </div>
      </div>

      {/* Replace row (only in replace mode) */}
      {mode === "replace" && (
        <div className="find-replace-row">
          <input
            ref={replaceInputRef}
            className="find-replace-input"
            type="text"
            placeholder="Replace..."
            value={localReplaceWith}
            onChange={handleReplaceChange}
            onKeyDown={handleReplaceKeyDown}
            aria-label="Replace"
          />
          <div className="find-replace-actions">
            <button
              className="find-replace-action-btn"
              onClick={handleReplaceCurrent}
              disabled={matches.length === 0}
              title="Replace Current"
            >
              Replace
            </button>
            <button
              className="find-replace-action-btn"
              onClick={handleReplaceAll}
              disabled={matches.length === 0}
              title="Replace All"
            >
              All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
