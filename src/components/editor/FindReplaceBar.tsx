// §5.6 Find/Replace Bar — Inline overlay (top-right of editor area)
// Two modes: Find only (Cmd+F) and Find+Replace (Cmd+H)
//
// Tiptap v3 does NOT re-render for meta-only ProseMirror transactions.
// We use local React state for input values and manually subscribe to
// editor transactions to read match counts from plugin state.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { FindReplaceState } from "../../extensions/plugins/find-replace";
import type { Editor } from "@tiptap/react";

import { TextSelection } from "@tiptap/pm/state";

import {
  dispatchClearSearch,
  dispatchNextMatch,
  dispatchPrevMatch,
  dispatchReplaceAll,
  dispatchReplaceCurrent,
  dispatchSetReplaceWith,
  dispatchSetSearchTerm,
  dispatchToggleCaseSensitive,
  dispatchToggleRegex,
  dispatchToggleWholeWord,
  findReplacePluginKey,
} from "../../extensions/plugins/find-replace";

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
    const ps = findReplacePluginKey.getState(editor.state) as
      | FindReplaceState
      | undefined;
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
  const pluginState = (findReplacePluginKey.getState(editor.state) as
    | FindReplaceState
    | undefined) ?? {
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

  // Sync localSearchTerm when changed externally (e.g. Global Search dispatch)
  useEffect(() => {
    if (pluginState.searchTerm && pluginState.searchTerm !== localSearchTerm) {
      setLocalSearchTerm(pluginState.searchTerm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginState.searchTerm]);

  // Track last selected match to avoid redundant dispatches
  const lastSelectedRef = useRef<null | { from: number; to: number }>(null);

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
    <div
      aria-label="Find and replace"
      className="find-replace-bar"
      role="search"
    >
      {/* Search row */}
      <div className="find-replace-row">
        <input
          aria-label="Search"
          className="find-replace-input"
          onChange={handleSearchChange}
          onKeyDown={handleSearchKeyDown}
          placeholder="Find..."
          ref={searchInputRef}
          type="text"
          value={localSearchTerm}
        />

        <div className="find-replace-toggles">
          <button
            aria-pressed={caseSensitive}
            className={`find-replace-toggle${caseSensitive ? "active" : ""}`}
            onClick={() => dispatchToggleCaseSensitive(editor.view)}
            title="Case Sensitive (Aa)"
          >
            Aa
          </button>
          <button
            aria-pressed={useRegex}
            className={`find-replace-toggle${useRegex ? "active" : ""}`}
            onClick={() => dispatchToggleRegex(editor.view)}
            title="Regular Expression (.*)"
          >
            .*
          </button>
          <button
            aria-pressed={wholeWord}
            className={`find-replace-toggle${wholeWord ? "active" : ""}`}
            onClick={() => dispatchToggleWholeWord(editor.view)}
            title="Whole Word"
          >
            W
          </button>
        </div>

        {matchCountText && (
          <span className="find-replace-count">{matchCountText}</span>
        )}

        <div className="find-replace-actions">
          <button
            aria-label="Previous match"
            className="find-replace-nav-btn"
            disabled={matches.length === 0}
            onClick={handlePrevMatch}
            title="Previous Match (Shift+Enter)"
          >
            &#9650;
          </button>
          <button
            aria-label="Next match"
            className="find-replace-nav-btn"
            disabled={matches.length === 0}
            onClick={handleNextMatch}
            title="Next Match (Enter)"
          >
            &#9660;
          </button>
          <button
            aria-expanded={mode === "replace"}
            aria-label={mode === "replace" ? "Hide replace" : "Show replace"}
            className={`find-replace-toggle-replace${mode === "replace" ? "active" : ""}`}
            onClick={() => onSetMode(mode === "replace" ? "find" : "replace")}
            title={mode === "replace" ? "Hide Replace" : "Show Replace (Cmd+H)"}
          >
            &#8644;
          </button>
          <button
            aria-label="Close find"
            className="find-replace-close-btn icon-btn"
            onClick={handleClose}
            title="Close (Escape)"
          >
            &#10005;
          </button>
        </div>
      </div>

      {/* Replace row (only in replace mode) */}
      {mode === "replace" && (
        <div className="find-replace-row">
          <input
            aria-label="Replace"
            className="find-replace-input"
            onChange={handleReplaceChange}
            onKeyDown={handleReplaceKeyDown}
            placeholder="Replace..."
            ref={replaceInputRef}
            type="text"
            value={localReplaceWith}
          />
          <div className="find-replace-actions">
            <button
              className="find-replace-action-btn"
              disabled={matches.length === 0}
              onClick={handleReplaceCurrent}
              title="Replace Current"
            >
              Replace
            </button>
            <button
              className="find-replace-action-btn"
              disabled={matches.length === 0}
              onClick={handleReplaceAll}
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
